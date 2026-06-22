/**
 * Null Encryption Facade
 *
 * No-op implementation of the encryption interface.
 * Used by free users who don't have encryption enabled.
 *
 * Messages are sent as plaintext.
 */

const NullEncryptionFacade = {
    /**
     * Initialize (no-op)
     * @param {Object} config - Encryption config object
     * @param {string} userId - User ID
     * @returns {Promise<Object>}
     */
    async initialize(config, userId) {
        console.log('[NullEncryptionFacade] Encryption disabled for this user');
        return { success: true };
    },

    /**
     * Setup encryption (returns upgrade prompt)
     * @returns {Promise<Object>}
     */
    async setupEncryption() {
        return {
            success: false,
            error: 'Encryption is a premium feature. Please upgrade to enable end-to-end encryption.'
        };
    },

    /**
     * Restore from password (not available)
     * @returns {Promise<Object>}
     */
    async restoreFromPassword() {
        return {
            success: false,
            error: 'Encryption is not enabled for your account'
        };
    },

    /**
     * Restore from recovery key (not available)
     * @returns {Promise<Object>}
     */
    async restoreFromRecoveryKey() {
        return {
            success: false,
            error: 'Encryption is not enabled for your account'
        };
    },

    /**
     * "Encrypt" a message (returns plaintext)
     * @param {number|string} conversationId - Conversation ID
     * @param {string} plaintext - Message
     * @param {string} recipientId - Recipient's user ID
     * @returns {Promise<Object>}
     */
    async encryptMessage(conversationId, plaintext, recipientId) {
        return {
            content: plaintext,
            isEncrypted: false
        };
    },

    /**
     * "Decrypt" a message (returns content as-is)
     * @param {number|string} conversationId - Conversation ID
     * @param {Object} data - Message data (plaintext content)
     * @param {string} senderId - Sender's user ID
     * @returns {Promise<string>}
     */
    async decryptMessage(conversationId, data, senderId) {
        // For plaintext messages, content is passed directly
        return data.content || data;
    },

    /**
     * Get safety number (not available)
     * @returns {Promise<Object>}
     */
    async getSafetyNumber() {
        return {
            error: 'Encryption is not enabled - upgrade to premium for end-to-end encryption'
        };
    },

    /**
     * Regenerate keys (not available)
     * @returns {Promise<Object>}
     */
    async regenerateKeys() {
        return {
            success: false,
            error: 'Encryption is not enabled for your account'
        };
    },

    /**
     * Get fingerprint (not available)
     * @returns {Promise<null>}
     */
    async getOurFingerprint() {
        return null;
    },

    /**
     * Get current epoch (always 0)
     * @returns {number}
     */
    getCurrentEpoch() {
        return 0;
    },

    /**
     * Check if encryption is enabled
     * @returns {boolean}
     */
    isEncryptionEnabled() {
        return false;
    },

    /**
     * Check if encryption is set up
     * @returns {boolean}
     */
    isSetUp() {
        return false;
    },

    /**
     * Clear local data (no-op)
     */
    async clearLocalData() {
        // Nothing to clear
    },

    /**
     * Get encryption status
     * @returns {Object}
     */
    getStatus() {
        return {
            enabled: false,
            initialized: true,
            keysExist: false,
            epoch: 0,
            message: 'Upgrade to premium for end-to-end encryption'
        };
    }
};

if (typeof window !== 'undefined') {
    window.NullEncryptionFacade = NullEncryptionFacade;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NullEncryptionFacade;
}
