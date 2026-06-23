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
     * W3-4: generate the unguessable storage-path component using the project's
     * CSPRNG seam (NOT Math.random). 8 hex-ish chars of base36 from random bytes.
     * @returns {string}
     */
    _randomPathId() {
        const bytes = window.CryptoPrimitivesService.randomBytes(8);
        let s = '';
        for (let i = 0; i < bytes.length; i++) {
            s += bytes[i].toString(36).padStart(2, '0');
        }
        return s.substring(0, 10);
    },

    /**
     * H-6: round a byte count UP to a coarse bucket so the server never sees the
     * exact size. Granularity scales with magnitude (1KB up to 64KB, then 64KB up
     * to 1MB, then 1MB). The EXACT size lives only in the encrypted metadata blob.
     * @param {number} bytes
     * @returns {number} coarse bucket (>= bytes)
     */
    _bucketFileSize(bytes) {
        const n = (typeof bytes === 'number' && bytes > 0) ? bytes : 0;
        let g;
        if (n <= 64 * 1024) {
            g = 1024;                 // <=64KB -> round to 1KB
        } else if (n <= 1024 * 1024) {
            g = 64 * 1024;            // <=1MB  -> round to 64KB
        } else {
            g = 1024 * 1024;          // >1MB   -> round to 1MB
        }
        return Math.max(g, Math.ceil(n / g) * g);
    },

    /**
     * H-6: seal an attachment's metadata ({file_name, mime_type, file_size}) under
     * the conversation's invariant, context-bound attachment KEK (W3-2). The blob is
     * what replaces the former plaintext columns; the server only ever sees ciphertext.
     * @param {{file_name:string, mime_type:string, file_size:number}} meta
     * @param {number|string} conversationId
     * @param {string} attachmentPath - storage_path (context binding)
     * @returns {Promise<{encryptedMetadata:string, metadataNonce:string}>}
     */
    async _encryptMetadata(meta, conversationId, attachmentPath) {
        const key = await window.KeyManagementService.getSessionKey(
            conversationId, { attachmentPath }
        );
        if (!(key instanceof Uint8Array)) {
            throw new Error('No attachment key available for metadata encryption');
        }
        const plaintext = window.CryptoPrimitivesService.encodeUTF8(JSON.stringify({
            file_name: meta.file_name,
            mime_type: meta.mime_type,
            file_size: meta.file_size
        }));
        const { ciphertext, nonce } = window.CryptoPrimitivesService.encryptBytes(plaintext, key);
        return {
            encryptedMetadata: btoa(String.fromCharCode(...ciphertext)),
            metadataNonce: btoa(String.fromCharCode(...nonce))
        };
    },

    /**
     * H-6: decrypt a metadata blob sealed by _encryptMetadata. Tries the bound KEK
     * first; throws if it cannot authenticate (caller falls back to legacy columns).
     * @param {string} encryptedMetadataB64
     * @param {string} metadataNonceB64
     * @param {number|string} conversationId
     * @param {string} attachmentPath - storage_path (context binding)
     * @returns {Promise<{file_name:string, mime_type:string, file_size:number}>}
     */
    async _decryptMetadata(encryptedMetadataB64, metadataNonceB64, conversationId, attachmentPath) {
        const key = await window.KeyManagementService.getSessionKey(
            conversationId, { attachmentPath }
        );
        if (!(key instanceof Uint8Array)) {
            throw new Error('No attachment key available for metadata decryption');
        }
        const ciphertext = Uint8Array.from(atob(encryptedMetadataB64), c => c.charCodeAt(0));
        const nonce = Uint8Array.from(atob(metadataNonceB64), c => c.charCodeAt(0));
        const plaintext = window.CryptoPrimitivesService.decryptBytes(ciphertext, nonce, key);
        const json = window.CryptoPrimitivesService.decodeUTF8
            ? window.CryptoPrimitivesService.decodeUTF8(plaintext)
            : new TextDecoder().decode(plaintext);
        return JSON.parse(json);
    },

    /**
     * H-6: resolve an attachment row's display metadata (fileName/mimeType/fileSize)
     * from whatever is available, in priority order:
     *   1) the encrypted_metadata blob (new H-6 rows) — the private path;
     *   2) the legacy plaintext columns (pre-H-6 rows) — back-compat;
     *   3) a neutral fallback + coarse bucket size — degrade gracefully.
     * Never throws.
     * @param {Object} att - attachment row (DB shape)
     * @returns {Promise<{fileName:string, mimeType:string, fileSize:number}>}
     */
    async _resolveMetadata(att) {
        if (att && att.encrypted_metadata && att.metadata_nonce) {
            try {
                const m = await this._decryptMetadata(
                    att.encrypted_metadata,
                    att.metadata_nonce,
                    att.conversation_id,
                    att.storage_path
                );
                return {
                    fileName: m.file_name || 'Attachment',
                    mimeType: m.mime_type || 'application/octet-stream',
                    fileSize: (typeof m.file_size === 'number') ? m.file_size : (att.file_size_bucket || 0)
                };
            } catch (e) {
                console.warn('[AttachmentService] metadata decrypt failed, falling back:', e?.message);
            }
        }
        // Legacy plaintext columns (pre-H-6) or graceful fallback.
        return {
            fileName: att?.file_name || 'Attachment',
            mimeType: att?.mime_type || 'application/octet-stream',
            fileSize: (typeof att?.file_size === 'number' ? att.file_size : null) ?? att?.file_size_bucket ?? 0
        };
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
     * Encrypt the file key with the conversation attachment KEK.
     *
     * W3-2: the KEK is derived from the conversation's INVARIANT attachment root
     * (AK0) — NOT the advancing ratchet root — and is BOUND to this attachment via
     * its storage path (folded into the HKDF info inside KeyManagementService). This
     * makes the wrap ratchet-invariant (still decryptable after any number of DH
     * ratchet steps) and non-transferable to another attachment row.
     *
     * @param {Uint8Array} fileKey - The file's encryption key
     * @param {number|string} conversationId - Conversation ID
     * @param {string} attachmentPath - The attachment's storage_path (context binding)
     * @returns {Promise<{encryptedKey: string, nonce: string}>}
     */
    async _encryptFileKey(fileKey, conversationId, attachmentPath) {
        console.log('[AttachmentService] _encryptFileKey: Getting session key for conversation', conversationId);

        // Validate inputs
        if (!fileKey || !(fileKey instanceof Uint8Array)) {
            throw new Error('Invalid file key - must be Uint8Array');
        }
        if (!conversationId) {
            throw new Error('Conversation ID is required');
        }
        if (!attachmentPath) {
            throw new Error('Attachment storage path is required for key binding');
        }

        // W3-2: get the invariant, context-bound attachment KEK for this row.
        const sessionKey = await window.KeyManagementService.getSessionKey(
            conversationId, { attachmentPath }
        );
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
     * Decrypt the file key using the conversation attachment KEK.
     *
     * W3-2 + BACK-COMPAT: new rows are wrapped under the invariant, context-bound
     * KEK (AK0 + storage path). Pre-W3-2 rows were wrapped under the legacy
     * RK-rooted, unbound key. We therefore try the bound key FIRST and, only if that
     * authentication fails, fall back to the legacy key — so both old and new
     * attachments decrypt. Because the bound key is ratchet-invariant, the new path
     * no longer breaks after a DH-ratchet step (the original W3-2 defect).
     *
     * @param {string} encryptedKeyBase64 - Base64 encrypted file key
     * @param {string} nonceBase64 - Base64 nonce
     * @param {number|string} conversationId - Conversation ID
     * @param {string} attachmentPath - The attachment's storage_path (context binding)
     * @returns {Promise<Uint8Array>} Decrypted file key
     */
    async _decryptFileKey(encryptedKeyBase64, nonceBase64, conversationId, attachmentPath) {
        console.log('[AttachmentService] _decryptFileKey: Getting session key for conversation', conversationId);

        // Decode from base64 once.
        const ciphertext = Uint8Array.from(atob(encryptedKeyBase64), c => c.charCodeAt(0));
        const nonce = Uint8Array.from(atob(nonceBase64), c => c.charCodeAt(0));

        // 1) W3-2 path: invariant, context-bound KEK (requires a storage path).
        if (attachmentPath) {
            const boundKey = await window.KeyManagementService.getSessionKey(
                conversationId, { attachmentPath }
            );
            if (boundKey instanceof Uint8Array) {
                try {
                    return window.CryptoPrimitivesService.decryptBytes(ciphertext, nonce, boundKey);
                } catch (e) {
                    // Not wrapped under the bound key (e.g. a pre-W3-2 row) — fall back.
                    console.log('[AttachmentService] _decryptFileKey: bound key failed, trying legacy key');
                }
            }
        }

        // 2) Legacy/back-compat path: original RK-rooted, unbound key (no context).
        const legacyKey = await window.KeyManagementService.getSessionKey(conversationId);
        if (!(legacyKey instanceof Uint8Array)) {
            console.error('[AttachmentService] _decryptFileKey: No session key for conversation', conversationId);
            throw new Error('No session key available for conversation');
        }
        return window.CryptoPrimitivesService.decryptBytes(ciphertext, nonce, legacyKey);
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

            // Generate unique storage path FIRST — it is the context the attachment
            // KEK and the metadata blob are bound to (W3-2). Use the CSPRNG seam, not
            // Math.random (W3-4), for the unguessable path component.
            const timestamp = Date.now();
            const randomId = this._randomPathId();
            const storagePath = `${conversationId}/${timestamp}-${randomId}`;

            console.log('[AttachmentService] uploadAttachment: Encrypting file key with attachment KEK');

            // W3-2: wrap the file key under the invariant, context-bound attachment KEK.
            const { encryptedKey, nonce: keyNonce } = await this._encryptFileKey(
                fileKey, conversationId, storagePath
            );

            // H-6: seal file_name + mime_type + EXACT file_size into a client-encrypted
            // metadata blob (same invariant, context-bound KEK). The plaintext columns
            // are no longer written; the server only ever sees a COARSE size bucket.
            const { encryptedMetadata, metadataNonce } = await this._encryptMetadata(
                { file_name: file.name, mime_type: file.type, file_size: file.size },
                conversationId, storagePath
            );
            const fileSizeBucket = this._bucketFileSize(file.size);

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

            // Create attachment record in database.
            // H-6: NO plaintext file_name / mime_type / exact file_size. Only the
            // client-encrypted metadata blob and a coarse size bucket are stored, so a
            // curious server learns neither the filename/type nor the exact byte count.
            const attachmentRecord = {
                message_id: messageId,
                conversation_id: conversationId,
                uploader_id: userId,
                file_size_bucket: fileSizeBucket,
                encrypted_metadata: encryptedMetadata,
                metadata_nonce: metadataNonce,
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

            // H-6: the plaintext metadata is no longer stored, so surface the values
            // the uploader already holds locally rather than reading them back.
            return {
                success: true,
                attachment: {
                    id: attachment.id,
                    fileName: file.name,
                    fileSize: file.size,
                    mimeType: file.type,
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

            // Decrypt file. W3-2: pass storage_path so the file key is unwrapped under
            // the context-bound, ratchet-invariant KEK (with legacy fallback inside).
            const encryptedData = new Uint8Array(await fileData.arrayBuffer());
            const fileKey = await this._decryptFileKey(
                attachment.encrypted_file_key,
                attachment.file_key_nonce,
                attachment.conversation_id,
                attachment.storage_path
            );

            // Extract nonce (first 24 bytes) and ciphertext
            const nonce = encryptedData.slice(0, 24);
            const ciphertext = encryptedData.slice(24);
            const decryptedData = this._decryptFile(ciphertext, nonce, fileKey);

            // H-6: recover file_name + mime_type from the client-encrypted metadata
            // blob (legacy rows fall back to any surviving plaintext columns).
            const meta = await this._resolveMetadata(attachment);

            // Update download count via SECURITY DEFINER RPC. The message_attachments
            // table is immutable under the hardened RLS (no UPDATE policy), so the only
            // permitted mutation is this counter bump. Best-effort: never block a download.
            try {
                await client.rpc('increment_attachment_download_count', { p_attachment_id: attachmentId });
            } catch (e) {
                console.warn('[AttachmentService] download-count bump skipped:', e?.message);
            }

            console.log('[AttachmentService] ✓ Downloaded:', meta.fileName);

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
                    type: this._safeDownloadType(meta.mimeType, meta.fileName)
                }),
                fileName: this._sanitizeFileName(meta.fileName)
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

            // H-6: select the ENCRYPTED metadata blob + coarse size bucket plus the
            // conversation/storage path needed to decrypt it. Legacy plaintext columns
            // (file_name/file_size/mime_type) are also selected for back-compat reads
            // of pre-H-6 rows; new rows leave them NULL.
            const { data, error } = await client
                .from('message_attachments')
                .select('id, conversation_id, storage_path, encrypted_metadata, metadata_nonce, file_size_bucket, file_name, file_size, mime_type, expires_at, created_at')
                .eq('message_id', messageId)
                .order('created_at', { ascending: true });

            if (error) {
                console.error('[AttachmentService] Error fetching attachments:', error);
                return [];
            }

            // W2-1: the row `id` is server-controlled (the compromised-server threat
            // model controls the JSON body regardless of the BIGSERIAL column type),
            // and it reaches a JS/HTML render sink in the controller. Validate it at
            // the *render* boundary, not only at query boundaries: coerce to a number
            // and DROP any row whose id is not a positive integer. This guarantees the
            // controller only ever sees a safe numeric id.
            // SM-29: flag expired attachments so the UI shows "expired" and
            // does not attempt a (refused) download. Server cleanup deletes them.
            const rows = (data || [])
                .map(att => ({
                    ...att,
                    id: Number(att.id),
                    expired: this._isExpired(att.expires_at)
                }))
                .filter(att => Number.isInteger(att.id) && att.id > 0);

            // H-6: decrypt each row's metadata so the renderer keeps receiving
            // fileName/mimeType/fileSize. Non-expired rows are decrypted (expired ones
            // are not downloadable anyway). Decryption failures degrade gracefully to a
            // neutral label + the coarse bucket size rather than throwing.
            for (const att of rows) {
                if (att.expired) continue;
                const meta = await this._resolveMetadata(att);
                att.fileName = meta.fileName;
                att.mimeType = meta.mimeType;
                att.fileSize = meta.fileSize;
            }
            return rows;
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
