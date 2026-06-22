/**
 * Key Storage Service
 *
 * Manages local key storage using IndexedDB.
 * Stores:
 * - Identity keys (public + secret key pair)
 * - Session keys (per conversation + epoch)
 * - Historical public keys (for decrypting old messages)
 */

const KeyStorageService = {
    /**
     * The IndexedDB database instance
     */
    db: null,

    /**
     * Whether the service is initialized
     */
    initialized: false,

    /**
     * Configuration (set during initialize)
     */
    _config: null,

    /**
     * Initialize the service and open IndexedDB
     * @param {Object} config - Encryption config object
     */
    async initialize(config) {
        this._config = config;

        const dbName = config?.indexedDB?.name || 'MoneyTrackerEncryption';
        const dbVersion = config?.indexedDB?.version || 1;

        console.log(`[KeyStorageService] Opening IndexedDB: ${dbName} v${dbVersion}`);

        this.db = await this._openDatabase(dbName, dbVersion);
        this.initialized = true;

        console.log('[KeyStorageService] Initialized');
    },

    /**
     * Open the IndexedDB database
     * @private
     * @param {string} name - Database name
     * @param {number} version - Database version
     * @returns {Promise<IDBDatabase>}
     */
    _openDatabase(name, version) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(name, version);

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to open database:', request.error);
                reject(request.error);
            };

            request.onsuccess = () => {
                console.log('[KeyStorageService] Database opened successfully');
                resolve(request.result);
            };

            request.onupgradeneeded = (event) => {
                console.log('[KeyStorageService] Upgrading database schema...');
                const db = event.target.result;

                // Identity keys store
                if (!db.objectStoreNames.contains('identity_keys')) {
                    db.createObjectStore('identity_keys', { keyPath: 'userId' });
                    console.log('[KeyStorageService] Created identity_keys store');
                }

                // Session keys store (compound key: conversationId + epoch)
                if (!db.objectStoreNames.contains('session_keys')) {
                    const sessionStore = db.createObjectStore('session_keys', {
                        keyPath: ['conversationId', 'epoch']
                    });
                    sessionStore.createIndex('conversationId', 'conversationId', { unique: false });
                    sessionStore.createIndex('epoch', 'epoch', { unique: false });
                    console.log('[KeyStorageService] Created session_keys store');
                }

                // Historical keys store (compound key: userId + epoch)
                if (!db.objectStoreNames.contains('historical_keys')) {
                    const historyStore = db.createObjectStore('historical_keys', {
                        keyPath: ['userId', 'epoch']
                    });
                    historyStore.createIndex('userId', 'userId', { unique: false });
                    console.log('[KeyStorageService] Created historical_keys store');
                }

                console.log('[KeyStorageService] Database schema upgrade complete');
            };
        });
    },

    /**
     * Ensure the service is initialized
     * @private
     */
    _ensureInitialized() {
        if (!this.initialized || !this.db) {
            throw new Error('[KeyStorageService] Service not initialized. Call initialize() first.');
        }
    },

    // ==================== Identity Keys ====================

    /**
     * Store identity keys for a user
     * @param {string} userId - User ID
     * @param {Object} keys - { publicKey: Uint8Array, secretKey: Uint8Array }
     */
    async storeIdentityKeys(userId, keys) {
        this._ensureInitialized();

        const serialized = {
            userId,
            publicKey: CryptoPrimitivesService.serializeKey(keys.publicKey),
            secretKey: CryptoPrimitivesService.serializeKey(keys.secretKey),
            createdAt: new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('identity_keys', 'readwrite');
            const store = tx.objectStore('identity_keys');
            const request = store.put(serialized);

            request.onsuccess = () => {
                console.log('[KeyStorageService] Identity keys stored');
                resolve();
            };

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to store identity keys:', request.error);
                reject(request.error);
            };
        });
    },

    /**
     * Get identity keys for a user
     * @param {string} userId - User ID
     * @returns {Promise<Object|null>} { publicKey: Uint8Array, secretKey: Uint8Array } or null
     */
    async getIdentityKeys(userId) {
        this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('identity_keys', 'readonly');
            const store = tx.objectStore('identity_keys');
            const request = store.get(userId);

            request.onsuccess = () => {
                const result = request.result;
                if (!result) {
                    resolve(null);
                    return;
                }

                resolve({
                    publicKey: CryptoPrimitivesService.deserializeKey(result.publicKey),
                    secretKey: CryptoPrimitivesService.deserializeKey(result.secretKey),
                    createdAt: result.createdAt
                });
            };

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to get identity keys:', request.error);
                reject(request.error);
            };
        });
    },

    /**
     * Delete identity keys for a user
     * @param {string} userId - User ID
     */
    async deleteIdentityKeys(userId) {
        this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('identity_keys', 'readwrite');
            const store = tx.objectStore('identity_keys');
            const request = store.delete(userId);

            request.onsuccess = () => {
                console.log('[KeyStorageService] Identity keys deleted');
                resolve();
            };

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to delete identity keys:', request.error);
                reject(request.error);
            };
        });
    },

    // ==================== Session Keys ====================

    /**
     * Store a session key for a conversation
     * @param {number|string} conversationId - Conversation ID
     * @param {number} epoch - Key epoch
     * @param {Uint8Array} sessionKey - The session key
     * @param {number} counter - Message counter (default 0)
     */
    async storeSessionKey(conversationId, epoch, sessionKey, counter = 0) {
        this._ensureInitialized();

        const serialized = {
            conversationId: String(conversationId),
            epoch,
            sessionKey: CryptoPrimitivesService.serializeKey(sessionKey),
            counter,
            createdAt: new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('session_keys', 'readwrite');
            const store = tx.objectStore('session_keys');
            const request = store.put(serialized);

            request.onsuccess = () => {
                console.log(`[KeyStorageService] Session key stored: conv=${conversationId}, epoch=${epoch}`);
                resolve();
            };

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to store session key:', request.error);
                reject(request.error);
            };
        });
    },

    /**
     * Get a session key for a conversation and epoch
     * @param {number|string} conversationId - Conversation ID
     * @param {number} epoch - Key epoch
     * @returns {Promise<Object|null>} { sessionKey: Uint8Array, counter: number } or null
     */
    async getSessionKey(conversationId, epoch) {
        this._ensureInitialized();

        // Validate inputs to prevent IndexedDB errors
        if (conversationId === undefined || conversationId === null) {
            console.error('[KeyStorageService] getSessionKey: conversationId is required');
            return null;
        }
        if (epoch === undefined || epoch === null || typeof epoch !== 'number') {
            console.error('[KeyStorageService] getSessionKey: epoch must be a number, got:', typeof epoch, epoch);
            return null;
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('session_keys', 'readonly');
            const store = tx.objectStore('session_keys');
            const request = store.get([String(conversationId), epoch]);

            request.onsuccess = () => {
                const result = request.result;
                if (!result) {
                    resolve(null);
                    return;
                }

                resolve({
                    sessionKey: CryptoPrimitivesService.deserializeKey(result.sessionKey),
                    counter: result.counter,
                    epoch: result.epoch
                });
            };

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to get session key:', request.error);
                reject(request.error);
            };
        });
    },

    /**
     * Get all session keys for a conversation
     * @param {number|string} conversationId - Conversation ID
     * @returns {Promise<Array>} Array of session key objects
     */
    async getSessionKeysForConversation(conversationId) {
        this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('session_keys', 'readonly');
            const store = tx.objectStore('session_keys');
            const index = store.index('conversationId');
            const request = index.getAll(String(conversationId));

            request.onsuccess = () => {
                const results = request.result.map(r => ({
                    sessionKey: CryptoPrimitivesService.deserializeKey(r.sessionKey),
                    counter: r.counter,
                    epoch: r.epoch
                }));
                resolve(results);
            };

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to get session keys:', request.error);
                reject(request.error);
            };
        });
    },

    /**
     * Increment the message counter for a session
     * @param {number|string} conversationId - Conversation ID
     * @param {number} epoch - Key epoch
     * @returns {Promise<number>} The new counter value
     */
    async incrementCounter(conversationId, epoch) {
        this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('session_keys', 'readwrite');
            const store = tx.objectStore('session_keys');
            const getRequest = store.get([String(conversationId), epoch]);

            getRequest.onsuccess = () => {
                const result = getRequest.result;
                if (!result) {
                    reject(new Error(`No session key found for conv=${conversationId}, epoch=${epoch}`));
                    return;
                }

                result.counter++;
                const putRequest = store.put(result);

                putRequest.onsuccess = () => {
                    resolve(result.counter);
                };

                putRequest.onerror = () => {
                    reject(putRequest.error);
                };
            };

            getRequest.onerror = () => {
                reject(getRequest.error);
            };
        });
    },

    /**
     * Delete all session keys for a conversation
     * @param {number|string} conversationId - Conversation ID
     */
    async deleteSessionKeysForConversation(conversationId) {
        this._ensureInitialized();

        const sessions = await this.getSessionKeysForConversation(conversationId);

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('session_keys', 'readwrite');
            const store = tx.objectStore('session_keys');

            let deleted = 0;
            sessions.forEach(s => {
                const request = store.delete([String(conversationId), s.epoch]);
                request.onsuccess = () => {
                    deleted++;
                    if (deleted === sessions.length) {
                        resolve();
                    }
                };
            });

            if (sessions.length === 0) {
                resolve();
            }

            tx.onerror = () => {
                reject(tx.error);
            };
        });
    },

    // ==================== Historical Keys ====================

    /**
     * Store a historical public key
     * @param {string} userId - User ID
     * @param {string} publicKeyB64 - Base64-encoded public key
     * @param {number} epoch - Key epoch
     */
    async storeHistoricalKey(userId, publicKeyB64, epoch) {
        this._ensureInitialized();

        const data = {
            userId,
            epoch,
            publicKey: publicKeyB64,
            createdAt: new Date().toISOString()
        };

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('historical_keys', 'readwrite');
            const store = tx.objectStore('historical_keys');
            const request = store.put(data);

            request.onsuccess = () => {
                console.log(`[KeyStorageService] Historical key stored: user=${userId.slice(0, 8)}..., epoch=${epoch}`);
                resolve();
            };

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to store historical key:', request.error);
                reject(request.error);
            };
        });
    },

    /**
     * Get a historical public key for a user at a specific epoch
     * @param {string} userId - User ID
     * @param {number} epoch - Key epoch
     * @returns {Promise<string|null>} Base64-encoded public key or null
     */
    async getHistoricalKey(userId, epoch) {
        this._ensureInitialized();

        // Validate inputs to prevent IndexedDB errors
        if (!userId || typeof userId !== 'string') {
            console.error('[KeyStorageService] getHistoricalKey: userId must be a string');
            return null;
        }
        if (epoch === undefined || epoch === null || typeof epoch !== 'number') {
            console.error('[KeyStorageService] getHistoricalKey: epoch must be a number, got:', typeof epoch, epoch);
            return null;
        }

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('historical_keys', 'readonly');
            const store = tx.objectStore('historical_keys');
            const request = store.get([userId, epoch]);

            request.onsuccess = () => {
                const result = request.result;
                resolve(result ? result.publicKey : null);
            };

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to get historical key:', request.error);
                reject(request.error);
            };
        });
    },

    /**
     * Get all historical keys for a user
     * @param {string} userId - User ID
     * @returns {Promise<Array>} Array of { epoch, publicKey } objects
     */
    async getHistoricalKeysForUser(userId) {
        this._ensureInitialized();

        return new Promise((resolve, reject) => {
            const tx = this.db.transaction('historical_keys', 'readonly');
            const store = tx.objectStore('historical_keys');
            const index = store.index('userId');
            const request = index.getAll(userId);

            request.onsuccess = () => {
                const results = request.result.map(r => ({
                    epoch: r.epoch,
                    publicKey: r.publicKey
                }));
                resolve(results);
            };

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to get historical keys:', request.error);
                reject(request.error);
            };
        });
    },

    // ==================== Database Management ====================

    /**
     * Clear all data from all stores
     */
    async clearAll() {
        this._ensureInitialized();

        const stores = ['identity_keys', 'session_keys', 'historical_keys'];

        for (const storeName of stores) {
            await new Promise((resolve, reject) => {
                const tx = this.db.transaction(storeName, 'readwrite');
                const store = tx.objectStore(storeName);
                const request = store.clear();

                request.onsuccess = () => {
                    console.log(`[KeyStorageService] Cleared ${storeName}`);
                    resolve();
                };

                request.onerror = () => {
                    reject(request.error);
                };
            });
        }

        console.log('[KeyStorageService] All stores cleared');
    },

    /**
     * Delete the entire database
     */
    async deleteDatabase() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }

        const dbName = this._config?.indexedDB?.name || 'MoneyTrackerEncryption';

        return new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);

            request.onsuccess = () => {
                console.log('[KeyStorageService] Database deleted');
                this.initialized = false;
                resolve();
            };

            request.onerror = () => {
                console.error('[KeyStorageService] Failed to delete database:', request.error);
                reject(request.error);
            };

            request.onblocked = () => {
                console.warn('[KeyStorageService] Database deletion blocked - close all connections');
            };
        });
    },

    /**
     * Check if IndexedDB is available
     * @returns {boolean}
     */
    isAvailable() {
        return typeof indexedDB !== 'undefined';
    }
};

if (typeof window !== 'undefined') {
    window.KeyStorageService = KeyStorageService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = KeyStorageService;
}
