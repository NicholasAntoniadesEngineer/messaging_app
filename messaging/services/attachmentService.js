/**
 * Attachment Service
 *
 * Handles file attachments for encrypted messaging.
 * Files are encrypted client-side before upload and stored in Supabase Storage.
 * Files auto-expire after 24 hours.
 *
 * Premium feature — gated via PermissionService ('messaging.attachments').
 * Requires a configured Supabase Storage bucket.
 */

const AttachmentService = {
    /**
     * Storage bucket name for attachments
     */
    BUCKET_NAME: 'message-attachments',

    /**
     * Max file size (from PermissionService)
     */
    MAX_FILE_SIZE: 1 * 1024 * 1024, // 1MB default

    /**
     * SM-28: content types that can render/execute inline in the app origin
     * (HTML, SVG, XHTML, scripts). Uploads with these declared types are
     * rejected, and on DOWNLOAD the Blob is always built with a neutral
     * application/octet-stream type so the browser cannot render them inline.
     */
    DANGEROUS_MIME_TYPES: [
        'text/html',
        'application/xhtml+xml',
        'image/svg+xml',
        'text/xml',
        'application/xml',
        'application/javascript',
        'text/javascript',
        'application/x-javascript',
        'application/ecmascript',
        'text/ecmascript'
    ],

    /**
     * SM-28: file extensions whose content the browser may treat as
     * active/renderable regardless of the declared MIME type.
     */
    DANGEROUS_EXTENSIONS: [
        'html', 'htm', 'xhtml', 'shtml', 'svg', 'js', 'mjs', 'xml', 'xht'
    ],

    /**
     * SM-28: decide whether an attachment's declared type/name is risky to
     * render inline. Used both at upload (reject) and download (force a safe
     * blob type). Conservative: matches by MIME and by file extension.
     * @param {string} mimeType - declared MIME type
     * @param {string} fileName - original file name
     * @returns {boolean} true when the attachment must not render inline
     */
    _isDangerousType(mimeType, fileName) {
        const type = (mimeType || '').toLowerCase().split(';')[0].trim();
        if (type && this.DANGEROUS_MIME_TYPES.includes(type)) {
            return true;
        }
        const name = (fileName || '').toLowerCase();
        const dot = name.lastIndexOf('.');
        if (dot !== -1) {
            const ext = name.slice(dot + 1);
            if (this.DANGEROUS_EXTENSIONS.includes(ext)) {
                return true;
            }
        }
        return false;
    },

    /**
     * SM-28: pick the content type to use when building the download Blob.
     * Risky types are coerced to application/octet-stream so a malicious
     * attachment cannot render inline in the origin; images/pdf/normal docs
     * keep their original type so they still preview/open as expected.
     * @param {string} mimeType - stored MIME type
     * @param {string} fileName - stored file name
     * @returns {string} safe content type for the Blob
     */
    _safeDownloadType(mimeType, fileName) {
        if (this._isDangerousType(mimeType, fileName)) {
            return 'application/octet-stream';
        }
        return mimeType || 'application/octet-stream';
    },

    /**
     * MSG-05: sanitize an uploader-controlled file name before it is used as the
     * `<a download>` save name. The stored name is attacker-controlled, so a
     * crafted value can spoof its apparent type via Unicode bidi-override
     * characters (e.g. "exe‮gpj.txt" rendering as a .jpg) or via path
     * separators / leading dots. We use a DENYLIST so international/UTF-8 names
     * are preserved (an allowlist would mangle legitimate non-Latin names):
     *   - strip ASCII control chars (U+0000–U+001F, U+007F)
     *   - strip Unicode bidi-override / isolate chars (U+202A–U+202E, U+2066–U+2069)
     *   - strip path separators (/ and \)
     *   - strip leading dots (no ".."/dotfile traversal in the save name)
     * Collapses to a safe fallback if nothing usable remains.
     * @param {string} name - Raw, uploader-controlled file name
     * @returns {string} Sanitized save name (never empty)
     */
    _sanitizeFileName(name) {
        const fallback = 'download';
        if (typeof name !== 'string') {
            return fallback;
        }
        const cleaned = name
            // ASCII control characters (U+0000-U+001F, U+007F)
            .replace(/[\u0000-\u001F\u007F]/g, '')
            // Unicode bidi overrides (U+202A-U+202E) + isolates (U+2066-U+2069)
            .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
            // path separators
            .replace(/[\/\\]/g, '')
            // leading dots (dotfiles / traversal)
            .replace(/^\.+/, '')
            .trim();
        return cleaned.length > 0 ? cleaned : fallback;
    },

    /**
     * Whether the storage bucket is available
     */
    _bucketAvailable: null,

    /**
     * Get database service
     */
    _getDatabaseService() {
        return window.DatabaseService;
    },

    /**
     * Get Supabase client
     */
    _getClient() {
        const db = this._getDatabaseService();
        return db?.client;
    },

    /**
     * Check if storage bucket exists and is accessible
     * @returns {Promise<boolean>}
     */
    async checkBucketAvailable() {
        if (this._bucketAvailable !== null) {
            return this._bucketAvailable;
        }

        try {
            const client = this._getClient();
            if (!client) {
                console.warn('[AttachmentService] Database client not available for bucket check');
                this._bucketAvailable = false;
                return false;
            }

            // Try to list files in the bucket (will fail if bucket doesn't exist)
            const { data, error } = await client.storage
                .from(this.BUCKET_NAME)
                .list('', { limit: 1 });

            if (error) {
                console.error('[AttachmentService] ✗ Storage bucket check failed:', error.message);
                console.error('[AttachmentService] ✗ Bucket "' + this.BUCKET_NAME + '" not found or not accessible');
                console.error('[AttachmentService] ✗ File attachments will be disabled');
                console.error('[AttachmentService] ✗ See database/setup/supabase-storage-setup.md for setup instructions');
                this._bucketAvailable = false;
                return false;
            }

            console.log('[AttachmentService] ✓ Storage bucket "' + this.BUCKET_NAME + '" is accessible');
            this._bucketAvailable = true;
            return true;
        } catch (err) {
            console.error('[AttachmentService] ✗ Error checking storage bucket:', err);
            this._bucketAvailable = false;
            return false;
        }
    },

    /**
     * Check if user can upload attachments
     * @returns {Promise<{allowed: boolean, maxSizeBytes: number, reason: string|null}>}
     */
    async canUpload() {
        // Check if storage bucket is available
        const bucketOk = await this.checkBucketAvailable();
        if (!bucketOk) {
            return { allowed: false, maxSizeBytes: 0, reason: 'Storage not configured' };
        }

        // Subscription/permission gate (Premium feature). If PermissionService is
        // unavailable we fail OPEN to a local size policy (business gate, not security).
        if (window.PermissionService) {
            try {
                const access = await window.PermissionService.canAccess('messaging.attachments');
                if (!access.allowed) {
                    return { allowed: false, maxSizeBytes: 0, reason: access.reason || 'Attachments require a subscription' };
                }
                const settings = await window.PermissionService.getFileAttachmentSettings();
                return { allowed: true, maxSizeBytes: settings.maxSizeBytes || this.MAX_FILE_SIZE, reason: null };
            } catch (e) {
                console.warn('[AttachmentService] Permission check failed; using local policy:', e?.message);
            }
        }
        return { allowed: true, maxSizeBytes: this.MAX_FILE_SIZE, reason: null };
    },

    /**
     * Validate a file before upload
     * @param {File} file - File to validate
     * @returns {Promise<{valid: boolean, reason: string|null}>}
     */
    async validateFile(file) {
        // SM-43: validate the input is actually a file before anything else.
        if (!file || typeof file.size !== 'number' || typeof file.name !== 'string') {
            return { valid: false, reason: 'No valid file selected' };
        }

        const canUploadCheck = await this.canUpload();
        if (!canUploadCheck.allowed) {
            return { valid: false, reason: canUploadCheck.reason };
        }

        // SM-33: reject empty files (nothing to encrypt/upload).
        if (file.size <= 0) {
            return { valid: false, reason: 'File is empty' };
        }

        // SM-33: enforce the size limit strictly BEFORE any encrypt/upload work.
        const maxSizeBytes = canUploadCheck.maxSizeBytes || this.MAX_FILE_SIZE;
        if (file.size > maxSizeBytes) {
            const maxMB = Math.round(maxSizeBytes / (1024 * 1024));
            const fileMB = (file.size / (1024 * 1024)).toFixed(1);
            return { valid: false, reason: `File size (${fileMB}MB) exceeds limit of ${maxMB}MB` };
        }

        // SM-28: reject content types that can render/execute inline in the
        // origin (HTML, SVG, XHTML, scripts). Everything else (images, pdf,
        // normal docs, archives) is still allowed since we encrypt the bytes.
        if (this._isDangerousType(file.type, file.name)) {
            return {
                valid: false,
                reason: 'This file type is not allowed for security reasons (HTML, SVG, XML, or script files).'
            };
        }

        return { valid: true, reason: null };
    },

    /**
     * SM-43: validate an attachment/message id is a positive integer (or a
     * numeric string for one). Ids come from the DOM/realtime payloads.
     * @param {number|string} id
     * @returns {boolean}
     */
    _isValidId(id) {
        if (typeof id === 'number') {
            return Number.isInteger(id) && id > 0;
        }
        if (typeof id === 'string' && /^\d+$/.test(id)) {
            return parseInt(id, 10) > 0;
        }
        return false;
    },

    /**
     * SM-29: treat an attachment as expired once it is past expires_at.
     * Missing/invalid timestamps are treated as NOT expired (fail open to
     * normal handling; server cleanup is the source of truth for deletion).
     * @param {string} expiresAt - ISO timestamp
     * @returns {boolean}
     */
    _isExpired(expiresAt) {
        if (!expiresAt) return false;
        const t = new Date(expiresAt).getTime();
        if (Number.isNaN(t)) return false;
        return t < Date.now();
    },

    /**
     * Generate a random encryption key for a file
     * @returns {Uint8Array} 32-byte key
     */
    _generateFileKey() {
        return window.CryptoPrimitivesService.randomBytes(32);
    },

    /**
     * Encrypt a file using XSalsa20-Poly1305
     * @param {ArrayBuffer} fileData - File data to encrypt
     * @param {Uint8Array} key - 32-byte encryption key
     * @returns {{ciphertext: Uint8Array, nonce: Uint8Array}}
     */
    _encryptFile(fileData, key) {
        const plaintext = new Uint8Array(fileData);
        // Use encryptBytes for binary data (files)
        return window.CryptoPrimitivesService.encryptBytes(plaintext, key);
    },

    /**
     * Decrypt a file
     * @param {Uint8Array} ciphertext - Encrypted file data
     * @param {Uint8Array} nonce - 24-byte nonce
     * @param {Uint8Array} key - 32-byte key
     * @returns {Uint8Array} Decrypted file data
     */
    _decryptFile(ciphertext, nonce, key) {
        // Use decryptBytes for binary data (files)
        return window.CryptoPrimitivesService.decryptBytes(ciphertext, nonce, key);
    },

    /**
     * Encrypt the file key with the conversation session key
     * @param {Uint8Array} fileKey - The file's encryption key
     * @param {number|string} conversationId - Conversation ID
     * @returns {Promise<{encryptedKey: string, nonce: string}>}
     */
    async _encryptFileKey(fileKey, conversationId) {
        console.log('[AttachmentService] _encryptFileKey: Getting session key for conversation', conversationId);

        // Validate inputs
        if (!fileKey || !(fileKey instanceof Uint8Array)) {
            throw new Error('Invalid file key - must be Uint8Array');
        }
        if (!conversationId) {
            throw new Error('Conversation ID is required');
        }

        // Get session key for conversation
        const sessionKey = await window.KeyManagementService.getSessionKey(conversationId);
        if (!sessionKey) {
            console.error('[AttachmentService] _encryptFileKey: No session key returned for conversation', conversationId);
            throw new Error('No session key available for conversation - ensure encryption is set up');
        }

        if (!(sessionKey instanceof Uint8Array)) {
            console.error('[AttachmentService] _encryptFileKey: Session key is not Uint8Array, got:', typeof sessionKey);
            throw new Error('Invalid session key type');
        }

        console.log('[AttachmentService] _encryptFileKey: Session key retrieved, encrypting file key');

        // Encrypt file key with session key using encryptBytes (for binary data)
        const { ciphertext, nonce } = window.CryptoPrimitivesService.encryptBytes(fileKey, sessionKey);

        // Base64 encode for storage
        return {
            encryptedKey: btoa(String.fromCharCode(...ciphertext)),
            nonce: btoa(String.fromCharCode(...nonce))
        };
    },

    /**
     * Decrypt the file key using conversation session key
     * @param {string} encryptedKeyBase64 - Base64 encrypted file key
     * @param {string} nonceBase64 - Base64 nonce
     * @param {number|string} conversationId - Conversation ID
     * @returns {Promise<Uint8Array>} Decrypted file key
     */
    async _decryptFileKey(encryptedKeyBase64, nonceBase64, conversationId) {
        console.log('[AttachmentService] _decryptFileKey: Getting session key for conversation', conversationId);

        // Get session key
        const sessionKey = await window.KeyManagementService.getSessionKey(conversationId);
        if (!sessionKey) {
            console.error('[AttachmentService] _decryptFileKey: No session key for conversation', conversationId);
            throw new Error('No session key available for conversation');
        }

        if (!(sessionKey instanceof Uint8Array)) {
            console.error('[AttachmentService] _decryptFileKey: Session key is not Uint8Array');
            throw new Error('Invalid session key type');
        }

        // Decode from base64
        const ciphertext = Uint8Array.from(atob(encryptedKeyBase64), c => c.charCodeAt(0));
        const nonce = Uint8Array.from(atob(nonceBase64), c => c.charCodeAt(0));

        console.log('[AttachmentService] _decryptFileKey: Decrypting file key');

        // Decrypt using decryptBytes (for binary data)
        return window.CryptoPrimitivesService.decryptBytes(ciphertext, nonce, sessionKey);
    },

    /**
     * Upload a file attachment
     * @param {File} file - File to upload
     * @param {number|string} messageId - Message ID this attachment belongs to
     * @param {number|string} conversationId - Conversation ID
     * @returns {Promise<{success: boolean, attachment?: Object, error?: string}>}
     */
    async uploadAttachment(file, messageId, conversationId) {
        console.log('[AttachmentService] uploadAttachment: Starting upload', {
            fileName: file?.name,
            fileSize: file?.size,
            messageId,
            conversationId
        });

        try {
            // Validate file
            const validation = await this.validateFile(file);
            if (!validation.valid) {
                console.error('[AttachmentService] uploadAttachment: Validation failed:', validation.reason);
                return { success: false, error: validation.reason };
            }

            const client = this._getClient();
            if (!client) {
                throw new Error('Database client not available');
            }

            // Get current user
            const userId = await this._getDatabaseService()._getCurrentUserId();
            if (!userId) {
                throw new Error('User not authenticated');
            }

            console.log('[AttachmentService] uploadAttachment: Reading file data');

            // Read file data
            const fileData = await file.arrayBuffer();

            console.log('[AttachmentService] uploadAttachment: Encrypting file');

            // Encrypt file with random key
            const fileKey = this._generateFileKey();
            const { ciphertext, nonce } = this._encryptFile(fileData, fileKey);

            // Prepend nonce to ciphertext for storage
            const dataWithNonce = new Uint8Array(24 + ciphertext.length);
            dataWithNonce.set(nonce, 0);
            dataWithNonce.set(ciphertext, 24);

            console.log('[AttachmentService] uploadAttachment: Encrypting file key with session key');

            // Encrypt file key with conversation session key
            const { encryptedKey, nonce: keyNonce } = await this._encryptFileKey(fileKey, conversationId);

            // Generate unique storage path
            const timestamp = Date.now();
            const randomId = Math.random().toString(36).substring(2, 10);
            const storagePath = `${conversationId}/${timestamp}-${randomId}`;

            // Upload encrypted file
            const encryptedBlob = new Blob([dataWithNonce], { type: 'application/octet-stream' });

            const { data: uploadData, error: uploadError } = await client.storage
                .from(this.BUCKET_NAME)
                .upload(storagePath, encryptedBlob, {
                    contentType: 'application/octet-stream',
                    upsert: false
                });

            if (uploadError) {
                console.error('[AttachmentService] Upload failed:', uploadError.message);
                throw new Error(`Upload failed: ${uploadError.message || 'Unknown error'}`);
            }

            // Create attachment record in database
            const attachmentRecord = {
                message_id: messageId,
                conversation_id: conversationId,
                uploader_id: userId,
                file_name: file.name,
                file_size: file.size,
                mime_type: file.type,
                storage_path: storagePath,
                encrypted_file_key: encryptedKey,
                file_key_nonce: keyNonce
            };

            const { data: attachment, error: dbError } = await client
                .from('message_attachments')
                .insert(attachmentRecord)
                .select()
                .single();

            if (dbError) {
                console.error('[AttachmentService] Database insert failed:', dbError.message);
                await client.storage.from(this.BUCKET_NAME).remove([storagePath]);
                throw new Error(`Database error: ${dbError.message}`);
            }

            console.log('[AttachmentService] ✓ Uploaded:', file.name, '(' + this.formatFileSize(file.size) + ')');

            return {
                success: true,
                attachment: {
                    id: attachment.id,
                    fileName: attachment.file_name,
                    fileSize: attachment.file_size,
                    mimeType: attachment.mime_type,
                    expiresAt: attachment.expires_at
                }
            };
        } catch (error) {
            console.error('[AttachmentService] Upload failed:', error.message);
            return { success: false, error: error.message };
        }
    },

    /**
     * Download and decrypt an attachment
     * @param {number|string} attachmentId - Attachment ID
     * @returns {Promise<{success: boolean, data?: Blob, fileName?: string, error?: string}>}
     */
    async downloadAttachment(attachmentId) {
        try {
            // SM-43: validate the id at the service boundary.
            if (!this._isValidId(attachmentId)) {
                return { success: false, error: 'Invalid attachment id' };
            }

            const client = this._getClient();
            if (!client) {
                throw new Error('Database client not available');
            }

            // Get attachment record
            const { data: attachment, error: dbError } = await client
                .from('message_attachments')
                .select('*')
                .eq('id', attachmentId)
                .single();

            if (dbError || !attachment) {
                throw new Error('Attachment not found');
            }

            // SM-29: never download an attachment past its expiry. Server
            // cleanup handles deletion; here we just refuse to fetch it.
            if (this._isExpired(attachment.expires_at)) {
                throw new Error('Attachment has expired');
            }

            // Download encrypted file from storage
            const { data: fileData, error: downloadError } = await client.storage
                .from(this.BUCKET_NAME)
                .download(attachment.storage_path);

            if (downloadError) {
                throw new Error(`Download failed: ${downloadError.message}`);
            }

            // Decrypt file
            const encryptedData = new Uint8Array(await fileData.arrayBuffer());
            const fileKey = await this._decryptFileKey(
                attachment.encrypted_file_key,
                attachment.file_key_nonce,
                attachment.conversation_id
            );

            // Extract nonce (first 24 bytes) and ciphertext
            const nonce = encryptedData.slice(0, 24);
            const ciphertext = encryptedData.slice(24);
            const decryptedData = this._decryptFile(ciphertext, nonce, fileKey);

            // Update download count via SECURITY DEFINER RPC. The message_attachments
            // table is immutable under the hardened RLS (no UPDATE policy), so the only
            // permitted mutation is this counter bump. Best-effort: never block a download.
            try {
                await client.rpc('increment_attachment_download_count', { p_attachment_id: attachmentId });
            } catch (e) {
                console.warn('[AttachmentService] download-count bump skipped:', e?.message);
            }

            console.log('[AttachmentService] ✓ Downloaded:', attachment.file_name);

            // SM-28: build the Blob with a SAFE content type. Risky types
            // (html/svg/xhtml/xml/js, by MIME or extension) are coerced to
            // application/octet-stream so they cannot render inline in the
            // origin; images/pdf/normal docs keep their real type.
            // MSG-05: sanitize the uploader-controlled name ONCE here before it
            // becomes the <a download> save name. _safeDownloadType still inspects
            // the original name/MIME for dangerous-type coercion.
            return {
                success: true,
                data: new Blob([decryptedData], {
                    type: this._safeDownloadType(attachment.mime_type, attachment.file_name)
                }),
                fileName: this._sanitizeFileName(attachment.file_name)
            };
        } catch (error) {
            console.error('[AttachmentService] Download error:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Get attachments for a message
     * @param {number|string} messageId - Message ID
     * @returns {Promise<Array>}
     */
    async getMessageAttachments(messageId) {
        try {
            // SM-43: validate the id before building the query.
            if (!this._isValidId(messageId)) {
                console.warn('[AttachmentService] getMessageAttachments: invalid message id');
                return [];
            }

            const client = this._getClient();
            if (!client) return [];

            const { data, error } = await client
                .from('message_attachments')
                .select('id, file_name, file_size, mime_type, expires_at, created_at')
                .eq('message_id', messageId)
                .order('created_at', { ascending: true });

            if (error) {
                console.error('[AttachmentService] Error fetching attachments:', error);
                return [];
            }

            // SM-29: flag expired attachments so the UI shows "expired" and
            // does not attempt a (refused) download. Server cleanup deletes them.
            return (data || []).map(att => ({
                ...att,
                expired: this._isExpired(att.expires_at)
            }));
        } catch (error) {
            console.error('[AttachmentService] Error:', error);
            return [];
        }
    },

    /**
     * Delete an attachment (uploader only)
     * @param {number|string} attachmentId - Attachment ID
     * @returns {Promise<{success: boolean, error?: string}>}
     */
    async deleteAttachment(attachmentId) {
        try {
            // SM-43: validate the id at the service boundary.
            if (!this._isValidId(attachmentId)) {
                return { success: false, error: 'Invalid attachment id' };
            }

            const client = this._getClient();
            if (!client) {
                throw new Error('Database client not available');
            }

            // Get attachment to find storage path
            const { data: attachment, error: fetchError } = await client
                .from('message_attachments')
                .select('storage_path')
                .eq('id', attachmentId)
                .single();

            if (fetchError || !attachment) {
                throw new Error('Attachment not found');
            }

            // Delete from storage
            const { error: storageError } = await client.storage
                .from(this.BUCKET_NAME)
                .remove([attachment.storage_path]);

            if (storageError) {
                console.warn('[AttachmentService] Storage delete error:', storageError);
            }

            // Delete record
            const { error: dbError } = await client
                .from('message_attachments')
                .delete()
                .eq('id', attachmentId);

            if (dbError) {
                throw new Error(`Delete failed: ${dbError.message}`);
            }

            console.log('[AttachmentService] Attachment deleted:', attachmentId);
            return { success: true };
        } catch (error) {
            console.error('[AttachmentService] Delete error:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * Format file size for display
     * @param {number} bytes - File size in bytes
     * @returns {string} Formatted size (e.g., "1.5 MB")
     */
    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    },

    /**
     * Get file icon class based on MIME type
     * @param {string} mimeType - MIME type
     * @returns {string} Font Awesome icon class
     */
    getFileIcon(mimeType) {
        if (mimeType.startsWith('image/')) return 'fa-image';
        if (mimeType === 'application/pdf') return 'fa-file-pdf';
        if (mimeType.includes('word')) return 'fa-file-word';
        if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return 'fa-file-excel';
        if (mimeType === 'text/plain') return 'fa-file-alt';
        if (mimeType === 'text/csv') return 'fa-file-csv';
        if (mimeType === 'application/zip') return 'fa-file-archive';
        return 'fa-file';
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.AttachmentService = AttachmentService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = AttachmentService;
}
