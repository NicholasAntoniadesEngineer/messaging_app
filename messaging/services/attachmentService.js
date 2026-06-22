/**
 * Attachment Service
 *
 * Handles file attachments for encrypted messaging.
 * Files are encrypted client-side before upload and stored in Supabase Storage.
 * Files auto-expire after 24 hours.
 *
 * Premium feature - requires messaging.attachments permission.
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

        if (!window.PermissionService) {
            console.warn('[AttachmentService] PermissionService not available');
            return { allowed: false, maxSizeBytes: 0, reason: 'Permission service unavailable' };
        }

        const access = await window.PermissionService.canAccess('messaging.attachments');
        if (!access.allowed) {
            return { allowed: false, maxSizeBytes: 0, reason: access.reason };
        }

        const settings = await window.PermissionService.getFileAttachmentSettings();
        return {
            allowed: true,
            maxSizeBytes: settings.maxSizeBytes,
            reason: null
        };
    },

    /**
     * Validate a file before upload
     * @param {File} file - File to validate
     * @returns {Promise<{valid: boolean, reason: string|null}>}
     */
    async validateFile(file) {
        const canUploadCheck = await this.canUpload();
        if (!canUploadCheck.allowed) {
            return { valid: false, reason: canUploadCheck.reason };
        }

        // Check file size only - any file type is allowed since we encrypt everything
        if (file.size > canUploadCheck.maxSizeBytes) {
            const maxMB = Math.round(canUploadCheck.maxSizeBytes / (1024 * 1024));
            const fileMB = (file.size / (1024 * 1024)).toFixed(1);
            return { valid: false, reason: `File size (${fileMB}MB) exceeds limit of ${maxMB}MB` };
        }

        return { valid: true, reason: null };
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

            // Check if expired
            if (new Date(attachment.expires_at) < new Date()) {
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

            // Update download count
            await client
                .from('message_attachments')
                .update({ downloaded_count: attachment.downloaded_count + 1 })
                .eq('id', attachmentId);

            console.log('[AttachmentService] ✓ Downloaded:', attachment.file_name);

            return {
                success: true,
                data: new Blob([decryptedData], { type: attachment.mime_type }),
                fileName: attachment.file_name
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

            return data || [];
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
