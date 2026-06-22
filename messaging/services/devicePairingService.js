/**
 * Device Pairing Service
 *
 * Handles multi-device key synchronization via pairing codes
 * Primary device generates a code and shares encrypted keys
 * Secondary device enters code to receive and decrypt keys
 */

const DevicePairingService = {
    CODE_EXPIRY_MS: 5 * 60 * 1000, // 5 minutes
    CODE_LENGTH: 6,

    /**
     * Generate a 6-digit pairing code
     * @returns {string} 6-digit numeric code
     */
    generatePairingCode() {
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        console.log('[DevicePairingService] Generated pairing code:', code);
        return code;
    },

    /**
     * Create device pairing request (primary device)
     * Stores encrypted keys with pairing code in database
     * @param {string} userId - Current user ID
     * @param {Object} keys - User's identity keys {publicKey, secretKey}
     * @returns {Promise<{success: boolean, code: string|null, expiresAt: Date|null, error: string|null}>}
     */
    async createPairingRequest(userId, keys) {
        console.log('[DevicePairingService] Creating pairing request for user:', userId);

        try {
            // Generate pairing code
            const code = this.generatePairingCode();
            const expiresAt = new Date(Date.now() + this.CODE_EXPIRY_MS);

            // Encrypt the secret key for storage
            // Use a derived key from the pairing code to encrypt
            const encryptionKey = await this._derivePairingKey(code, userId);
            const encryptedKeys = await this._encryptKeys(keys, encryptionKey);

            // Store pairing request in device_keys table temporarily
            const deviceId = `pairing_${code}_${Date.now()}`;
            const deviceName = 'Pairing Request';

            const databaseService = window.DatabaseService;
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }

            const tableName = databaseService._getTableName('deviceKeys');

            const insertResult = await databaseService.queryInsert(tableName, {
                user_id: userId,
                device_id: deviceId,
                device_name: deviceName,
                public_key: encryptedKeys.publicKey,
                encrypted_secret_key: encryptedKeys.encryptedSecretKey,
                encryption_nonce: encryptedKeys.nonce,
                pairing_code: code,
                expires_at: expiresAt.toISOString(),
                is_primary: false
            });

            if (insertResult.error) {
                throw new Error('Failed to store pairing request: ' + insertResult.error.message);
            }

            console.log('[DevicePairingService] Pairing request created with code:', code);

            return {
                success: true,
                code,
                expiresAt,
                error: null
            };

        } catch (error) {
            console.error('[DevicePairingService] Error creating pairing request:', error);
            return {
                success: false,
                code: null,
                expiresAt: null,
                error: error.message || 'Failed to create pairing request'
            };
        }
    },

    /**
     * Verify and retrieve pairing request (secondary device)
     * @param {string} userId - Current user ID
     * @param {string} code - 6-digit pairing code
     * @returns {Promise<{success: boolean, keys: Object|null, error: string|null}>}
     */
    async verifyPairingCode(userId, code) {
        console.log('[DevicePairingService] Verifying pairing code for user:', userId);

        try {
            if (!code || code.length !== this.CODE_LENGTH) {
                throw new Error('Invalid pairing code format');
            }

            const databaseService = window.DatabaseService;
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }

            const tableName = databaseService._getTableName('deviceKeys');

            // Find pairing request with matching code
            const queryResult = await databaseService.querySelect(tableName, {
                filter: {
                    user_id: userId,
                    pairing_code: code
                },
                limit: 1
            });

            if (queryResult.error || !queryResult.data || queryResult.data.length === 0) {
                throw new Error('Invalid or expired pairing code');
            }

            const pairingRequest = queryResult.data[0];

            // Check if code has expired
            const expiresAt = new Date(pairingRequest.expires_at);
            if (expiresAt < new Date()) {
                // Delete expired pairing request
                await databaseService.queryDelete(tableName, pairingRequest.id);
                throw new Error('Pairing code has expired');
            }

            // Decrypt the keys using the pairing code
            const encryptionKey = await this._derivePairingKey(code, userId);
            const decryptedKeys = await this._decryptKeys({
                publicKey: pairingRequest.public_key,
                encryptedSecretKey: pairingRequest.encrypted_secret_key,
                nonce: pairingRequest.encryption_nonce
            }, encryptionKey);

            // Delete the pairing request (single use)
            await databaseService.queryDelete(tableName, pairingRequest.id);

            console.log('[DevicePairingService] Pairing code verified and keys retrieved');

            return {
                success: true,
                keys: decryptedKeys,
                error: null
            };

        } catch (error) {
            console.error('[DevicePairingService] Error verifying pairing code:', error);
            return {
                success: false,
                keys: null,
                error: error.message || 'Failed to verify pairing code'
            };
        }
    },

    /**
     * Register current device after successful pairing
     * @param {string} userId - User ID
     * @param {string} deviceName - Human-readable device name
     * @param {boolean} isPrimary - Whether this is the primary device
     * @returns {Promise<{success: boolean, error: string|null}>}
     */
    async registerDevice(userId, deviceName, isPrimary = false) {
        console.log('[DevicePairingService] Registering device:', deviceName);

        try {
            const databaseService = window.DatabaseService;
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }

            const deviceId = this._generateDeviceId();
            const tableName = databaseService._getTableName('deviceKeys');

            // Get user's public key
            const publicKey = await window.KeyStorageService.getPublicKey(userId);
            if (!publicKey) {
                throw new Error('No public key found for user');
            }

            const publicKeyB64 = window.CryptoService.serializePublicKey(publicKey);

            const insertResult = await databaseService.queryInsert(tableName, {
                user_id: userId,
                device_id: deviceId,
                device_name: deviceName,
                public_key: publicKeyB64,
                is_primary: isPrimary
            });

            if (insertResult.error) {
                throw new Error('Failed to register device: ' + insertResult.error.message);
            }

            // Store device ID in localStorage
            localStorage.setItem('device_id', deviceId);

            console.log('[DevicePairingService] Device registered successfully');

            return {
                success: true,
                error: null
            };

        } catch (error) {
            console.error('[DevicePairingService] Error registering device:', error);
            return {
                success: false,
                error: error.message || 'Failed to register device'
            };
        }
    },

    /**
     * Clean up expired pairing requests
     * @param {string} userId - User ID
     * @returns {Promise<void>}
     */
    async cleanupExpiredRequests(userId) {
        try {
            const databaseService = window.DatabaseService;
            if (!databaseService) return;

            const tableName = databaseService._getTableName('deviceKeys');

            // Get all pairing requests for user
            const queryResult = await databaseService.querySelect(tableName, {
                filter: {
                    user_id: userId,
                    device_name: 'Pairing Request'
                }
            });

            if (!queryResult.error && queryResult.data) {
                const now = new Date();
                for (const request of queryResult.data) {
                    if (request.expires_at && new Date(request.expires_at) < now) {
                        await databaseService.queryDelete(tableName, request.id);
                    }
                }
            }

        } catch (error) {
            console.warn('[DevicePairingService] Error cleaning up expired requests:', error);
        }
    },

    /**
     * Generate unique device ID
     * @private
     * @returns {string} Device ID
     */
    _generateDeviceId() {
        return `device_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    },

    /**
     * Derive encryption key from pairing code and user ID
     * @private
     * @param {string} code - Pairing code
     * @param {string} userId - User ID
     * @returns {Promise<Uint8Array>} Derived key
     */
    async _derivePairingKey(code, userId) {
        // Combine code and userId for additional security
        const input = `${code}:${userId}`;
        const encoder = new TextEncoder();
        const data = encoder.encode(input);

        // Hash to create a 32-byte key
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return new Uint8Array(hashBuffer);
    },

    /**
     * Encrypt keys for pairing using XSalsa20-Poly1305
     * @private
     * @param {Object} keys - Keys to encrypt { publicKey: Uint8Array, secretKey: Uint8Array }
     * @param {Uint8Array} encryptionKey - 32-byte encryption key derived from pairing code
     * @returns {Promise<Object>} { publicKey: string, encryptedSecretKey: string, nonce: string }
     */
    async _encryptKeys(keys, encryptionKey) {
        // Ensure CryptoPrimitivesService is available and initialized
        if (!window.CryptoPrimitivesService || !window.CryptoPrimitivesService.initialized) {
            throw new Error('CryptoPrimitivesService not available or not initialized');
        }

        const cryptoService = window.CryptoPrimitivesService;

        // Serialize the public key (stored unencrypted - it's public)
        const publicKeyB64 = cryptoService.serializeKey(keys.publicKey);

        // Serialize the secret key to base64 first
        const secretKeyB64 = cryptoService.serializeKey(keys.secretKey);

        // Encrypt the secret key using XSalsa20-Poly1305 authenticated encryption
        const encrypted = cryptoService.encrypt(secretKeyB64, encryptionKey);

        return {
            publicKey: publicKeyB64,
            encryptedSecretKey: encrypted.ciphertext,
            nonce: encrypted.nonce
        };
    },

    /**
     * Decrypt keys from pairing using XSalsa20-Poly1305
     * @private
     * @param {Object} encryptedKeys - { publicKey: string, encryptedSecretKey: string, nonce: string }
     * @param {Uint8Array} encryptionKey - 32-byte decryption key derived from pairing code
     * @returns {Promise<Object>} { publicKey: Uint8Array, secretKey: Uint8Array }
     */
    async _decryptKeys(encryptedKeys, encryptionKey) {
        // Ensure CryptoPrimitivesService is available and initialized
        if (!window.CryptoPrimitivesService || !window.CryptoPrimitivesService.initialized) {
            throw new Error('CryptoPrimitivesService not available or not initialized');
        }

        const cryptoService = window.CryptoPrimitivesService;

        // Public key is stored unencrypted
        const publicKey = cryptoService.deserializeKey(encryptedKeys.publicKey);

        // Decrypt the secret key
        const secretKeyB64 = cryptoService.decrypt(
            encryptedKeys.encryptedSecretKey,
            encryptedKeys.nonce,
            encryptionKey
        );

        const secretKey = cryptoService.deserializeKey(secretKeyB64);

        return { publicKey, secretKey };
    },

    /**
     * Get device name (browser + OS)
     * @returns {string} Device name
     */
    getDeviceName() {
        const userAgent = navigator.userAgent;
        let browser = 'Unknown Browser';
        let os = 'Unknown OS';

        // Detect browser
        if (userAgent.includes('Chrome')) browser = 'Chrome';
        else if (userAgent.includes('Safari')) browser = 'Safari';
        else if (userAgent.includes('Firefox')) browser = 'Firefox';
        else if (userAgent.includes('Edge')) browser = 'Edge';

        // Detect OS
        if (userAgent.includes('Win')) os = 'Windows';
        else if (userAgent.includes('Mac')) os = 'macOS';
        else if (userAgent.includes('Linux')) os = 'Linux';
        else if (userAgent.includes('Android')) os = 'Android';
        else if (userAgent.includes('iOS')) os = 'iOS';

        return `${browser} on ${os}`;
    }
};

// Make available globally
window.DevicePairingService = DevicePairingService;

console.log('[DevicePairingService] Service loaded');
