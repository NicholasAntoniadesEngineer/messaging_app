/**
 * Field Locking Service
 * Handles field-level locking to prevent concurrent edits
 * Provides real-time lock updates via Supabase subscriptions
 */

const FieldLockingService = {
    lockSubscriptions: {},
    lockCleanupInterval: null,
    LOCK_DURATION_MINUTES: 5,
    LOCK_EXTENSION_MINUTES: 2,
    CLEANUP_INTERVAL_MS: 60000,
    
    /**
     * Get database service (requires config)
     * @returns {Object} Database service
     * @throws {Error} If DatabaseConfigHelper is not available or database service is not configured
     */
    _getDatabaseService() {
        if (typeof DatabaseConfigHelper === 'undefined') {
            throw new Error('DatabaseConfigHelper not available. Ensure database-config-helper.js is loaded and DatabaseModule.initialize() has been called.');
        }
        return DatabaseConfigHelper.getDatabaseService(this);
    },
    
    /**
     * Get auth service (requires config)
     * @returns {Object} Auth service
     * @throws {Error} If DatabaseConfigHelper is not available or auth service is not configured
     */
    _getAuthService() {
        if (typeof DatabaseConfigHelper === 'undefined') {
            throw new Error('DatabaseConfigHelper not available. Ensure database-config-helper.js is loaded and DatabaseModule.initialize() has been called.');
        }
        return DatabaseConfigHelper.getAuthService(this);
    },
    
    /**
     * Get table name (requires config)
     * @param {string} tableKey - Table key
     * @returns {string} Table name
     * @throws {Error} If DatabaseConfigHelper is not available or table name is not configured
     */
    _getTableName(tableKey) {
        if (typeof DatabaseConfigHelper === 'undefined') {
            throw new Error('DatabaseConfigHelper not available. Ensure database-config-helper.js is loaded and DatabaseModule.initialize() has been called.');
        }
        return DatabaseConfigHelper.getTableName(this, tableKey);
    },
    
    /**
     * Acquire a lock on a field
     * @param {string} resourceType - Type of resource: 'month', 'pot', or 'setting'
     * @param {string} resourceId - Resource identifier (month key, pot id, or 'settings')
     * @param {string} fieldPath - Path to the field (e.g., 'variable_costs[0].actualAmount')
     * @param {string} ownerUserId - User ID of the data owner
     * @returns {Promise<{success: boolean, lock: Object|null, error: string|null, isLockedByOther: boolean}>}
     */
    async acquireFieldLock(resourceType, resourceId, fieldPath, ownerUserId) {
        try {
            const databaseService = this._getDatabaseService();
            const authService = this._getAuthService();
            
            if (!databaseService || !authService) {
                throw new Error('DatabaseService or AuthService not available');
            }
            
            const currentUserId = await databaseService._getCurrentUserId();
            if (!currentUserId) {
                return {
                    success: false,
                    lock: null,
                    error: 'User not authenticated',
                    isLockedByOther: false
                };
            }
            
            const existingLock = await this.getFieldLock(resourceType, resourceId, fieldPath);
            if (existingLock.success && existingLock.lock) {
                if (existingLock.lock.locked_by_user_id !== currentUserId) {
                    const expiresAt = new Date(existingLock.lock.expires_at);
                    if (expiresAt > new Date()) {
                        return {
                            success: false,
                            lock: existingLock.lock,
                            error: 'Field is locked by another user',
                            isLockedByOther: true
                        };
                    }
                }
            }
            
            const tableName = this._getTableName('fieldLocks');
            const lockData = {
                resource_type: resourceType,
                resource_id: resourceId,
                field_path: fieldPath,
                locked_by_user_id: currentUserId,
                owner_user_id: ownerUserId,
                expires_at: new Date(Date.now() + this.LOCK_DURATION_MINUTES * 60 * 1000).toISOString()
            };
            
            const result = await databaseService.queryUpsert(tableName, lockData, {
                onConflict: 'resource_type,resource_id,field_path',
                conflictColumns: ['resource_type', 'resource_id', 'field_path']
            });
            
            if (result.error) {
                console.error('[FieldLockingService] Error acquiring lock:', result.error);
                return {
                    success: false,
                    lock: null,
                    error: result.error.message || 'Failed to acquire lock',
                    isLockedByOther: false
                };
            }
            
            const lock = result.data && result.data.length > 0 ? result.data[0] : null;
            
            return {
                success: true,
                lock: lock,
                error: null,
                isLockedByOther: false
            };
        } catch (error) {
            console.error('[FieldLockingService] Exception acquiring lock:', error);
            return {
                success: false,
                lock: null,
                error: error.message || 'An unexpected error occurred',
                isLockedByOther: false
            };
        }
    },
    
    /**
     * Release a specific lock
     * @param {number} lockId - Lock ID to release
     * @returns {Promise<{success: boolean, error: string|null}>}
     */
    async releaseFieldLock(lockId) {
        try {
            const databaseService = this._getDatabaseService();
            const authService = this._getAuthService();
            
            if (!databaseService || !authService) {
                throw new Error('DatabaseService or AuthService not available');
            }
            
            const currentUserId = await databaseService._getCurrentUserId();
            if (!currentUserId) {
                return {
                    success: false,
                    error: 'User not authenticated'
                };
            }
            
            const tableName = this._getTableName('fieldLocks');
            const result = await databaseService.queryDelete(tableName, {
                filter: {
                    id: lockId,
                    locked_by_user_id: currentUserId
                }
            });
            
            if (result.error) {
                console.error('[FieldLockingService] Error releasing lock:', result.error);
                return {
                    success: false,
                    error: result.error.message || 'Failed to release lock'
                };
            }
            
            return {
                success: true,
                error: null
            };
        } catch (error) {
            console.error('[FieldLockingService] Exception releasing lock:', error);
            return {
                success: false,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Release all locks for the current user
     * Called on logout or disconnect
     * @returns {Promise<{success: boolean, releasedCount: number, error: string|null}>}
     */
    async releaseAllLocksForUser() {
        try {
            const databaseService = this._getDatabaseService();
            const authService = this._getAuthService();
            
            if (!databaseService || !authService) {
                throw new Error('DatabaseService or AuthService not available');
            }
            
            const currentUserId = await databaseService._getCurrentUserId();
            if (!currentUserId) {
                return {
                    success: false,
                    releasedCount: 0,
                    error: 'User not authenticated'
                };
            }
            
            const tableName = this._getTableName('fieldLocks');
            const result = await databaseService.queryDelete(tableName, {
                filter: {
                    locked_by_user_id: currentUserId
                }
            });
            
            if (result.error) {
                console.error('[FieldLockingService] Error releasing all locks:', result.error);
                return {
                    success: false,
                    releasedCount: 0,
                    error: result.error.message || 'Failed to release locks'
                };
            }
            
            const releasedCount = result.data ? result.data.length : 0;
            
            return {
                success: true,
                releasedCount: releasedCount,
                error: null
            };
        } catch (error) {
            console.error('[FieldLockingService] Exception releasing all locks:', error);
            return {
                success: false,
                releasedCount: 0,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Get current lock status for a field
     * @param {string} resourceType - Type of resource: 'month', 'pot', or 'setting'
     * @param {string} resourceId - Resource identifier
     * @param {string} fieldPath - Path to the field
     * @returns {Promise<{success: boolean, lock: Object|null, error: string|null}>}
     */
    async getFieldLock(resourceType, resourceId, fieldPath) {
        try {
            const databaseService = this._getDatabaseService();
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }
            
            const tableName = this._getTableName('fieldLocks');
            const result = await databaseService.querySelect(tableName, {
                filter: {
                    resource_type: resourceType,
                    resource_id: resourceId,
                    field_path: fieldPath
                },
                limit: 1
            });
            
            if (result.error) {
                console.error('[FieldLockingService] Error getting lock:', result.error);
                return {
                    success: false,
                    lock: null,
                    error: result.error.message || 'Failed to get lock'
                };
            }
            
            const lock = result.data && result.data.length > 0 ? result.data[0] : null;
            
            if (lock) {
                const expiresAt = new Date(lock.expires_at);
                if (expiresAt <= new Date()) {
                    await this.cleanupExpiredLocks();
                    return {
                        success: true,
                        lock: null,
                        error: null
                    };
                }
            }
            
            return {
                success: true,
                lock: lock,
                error: null
            };
        } catch (error) {
            console.error('[FieldLockingService] Exception getting lock:', error);
            return {
                success: false,
                lock: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Get all locks for a resource
     * @param {string} resourceType - Type of resource: 'month', 'pot', or 'setting'
     * @param {string} resourceId - Resource identifier
     * @returns {Promise<{success: boolean, locks: Array|null, error: string|null}>}
     */
    async getAllLocksForResource(resourceType, resourceId) {
        try {
            const databaseService = this._getDatabaseService();
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }
            
            const tableName = this._getTableName('fieldLocks');
            const result = await databaseService.querySelect(tableName, {
                filter: {
                    resource_type: resourceType,
                    resource_id: resourceId
                }
            });
            
            if (result.error) {
                console.error('[FieldLockingService] Error getting locks:', result.error);
                return {
                    success: false,
                    locks: null,
                    error: result.error.message || 'Failed to get locks'
                };
            }
            
            const locks = result.data || [];
            const validLocks = locks.filter(lock => {
                const expiresAt = new Date(lock.expires_at);
                return expiresAt > new Date();
            });
            
            return {
                success: true,
                locks: validLocks,
                error: null
            };
        } catch (error) {
            console.error('[FieldLockingService] Exception getting locks:', error);
            return {
                success: false,
                locks: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Extend lock expiration (called while user is actively editing)
     * @param {number} lockId - Lock ID to extend
     * @returns {Promise<{success: boolean, lock: Object|null, error: string|null}>}
     */
    async extendLock(lockId) {
        try {
            const databaseService = this._getDatabaseService();
            const authService = this._getAuthService();
            
            if (!databaseService || !authService) {
                throw new Error('DatabaseService or AuthService not available');
            }
            
            const currentUserId = await databaseService._getCurrentUserId();
            if (!currentUserId) {
                return {
                    success: false,
                    lock: null,
                    error: 'User not authenticated'
                };
            }
            
            const tableName = this._getTableName('fieldLocks');
            const updateData = {
                expires_at: new Date(Date.now() + this.LOCK_EXTENSION_MINUTES * 60 * 1000).toISOString()
            };
            
            const result = await databaseService.queryUpdate(tableName, lockId, updateData, {
                filter: {
                    locked_by_user_id: currentUserId
                }
            });
            
            if (result.error) {
                console.error('[FieldLockingService] Error extending lock:', result.error);
                return {
                    success: false,
                    lock: null,
                    error: result.error.message || 'Failed to extend lock'
                };
            }
            
            const lock = result.data && result.data.length > 0 ? result.data[0] : null;
            
            return {
                success: true,
                lock: lock,
                error: null
            };
        } catch (error) {
            console.error('[FieldLockingService] Exception extending lock:', error);
            return {
                success: false,
                lock: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Clean up expired locks
     * @returns {Promise<{success: boolean, deletedCount: number, error: string|null}>}
     */
    async cleanupExpiredLocks() {
        try {
            const databaseService = this._getDatabaseService();
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }
            
            const tableName = this._getTableName('fieldLocks');
            const result = await databaseService.queryDelete(tableName, {
                filter: {
                    expires_at: { lt: new Date().toISOString() }
                }
            });
            
            if (result.error) {
                console.error('[FieldLockingService] Error cleaning up expired locks:', result.error);
                return {
                    success: false,
                    deletedCount: 0,
                    error: result.error.message || 'Failed to cleanup expired locks'
                };
            }
            
            const deletedCount = result.data ? result.data.length : 0;
            
            return {
                success: true,
                deletedCount: deletedCount,
                error: null
            };
        } catch (error) {
            console.error('[FieldLockingService] Exception cleaning up expired locks:', error);
            return {
                success: false,
                deletedCount: 0,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Subscribe to lock changes for a resource
     * @param {string} resourceType - Type of resource
     * @param {string} resourceId - Resource identifier
     * @param {Function} callback - Callback function called when locks change
     * @returns {Promise<{success: boolean, subscription: Object|null, error: string|null}>}
     */
    async subscribeToLocks(resourceType, resourceId, callback) {
        try {
            const databaseService = this._getDatabaseService();
            if (!databaseService || !databaseService.client) {
                throw new Error('DatabaseService or client not available');
            }
            
            const tableName = this._getTableName('fieldLocks');
            const subscriptionKey = `${resourceType}:${resourceId}`;
            
            if (this.lockSubscriptions[subscriptionKey]) {
                this.unsubscribeFromLocks(resourceType, resourceId);
            }
            
            const channel = databaseService.client.channel(`locks:${subscriptionKey}`)
                .on('postgres_changes', {
                    event: '*',
                    schema: 'public',
                    table: tableName,
                    filter: `resource_type=eq.${resourceType} AND resource_id=eq.${resourceId}`
                }, (payload) => {
                    callback(payload);
                })
                .subscribe();
            
            this.lockSubscriptions[subscriptionKey] = channel;
            
            return {
                success: true,
                subscription: channel,
                error: null
            };
        } catch (error) {
            console.error('[FieldLockingService] Exception subscribing to locks:', error);
            return {
                success: false,
                subscription: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Unsubscribe from lock changes for a resource
     * @param {string} resourceType - Type of resource
     * @param {string} resourceId - Resource identifier
     * @returns {Promise<{success: boolean, error: string|null}>}
     */
    async unsubscribeFromLocks(resourceType, resourceId) {
        try {
            const subscriptionKey = `${resourceType}:${resourceId}`;
            const channel = this.lockSubscriptions[subscriptionKey];
            
            if (channel) {
                await channel.unsubscribe();
                delete this.lockSubscriptions[subscriptionKey];
            }
            
            return {
                success: true,
                error: null
            };
        } catch (error) {
            console.error('[FieldLockingService] Exception unsubscribing from locks:', error);
            return {
                success: false,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Start periodic cleanup of expired locks
     */
    startLockCleanup() {
        if (this.lockCleanupInterval) {
            return;
        }
        
        this.lockCleanupInterval = setInterval(() => {
            this.cleanupExpiredLocks().catch(error => {
                console.error('[FieldLockingService] Error in periodic cleanup:', error);
            });
        }, this.CLEANUP_INTERVAL_MS);
    },
    
    /**
     * Stop periodic cleanup of expired locks
     */
    stopLockCleanup() {
        if (this.lockCleanupInterval) {
            clearInterval(this.lockCleanupInterval);
            this.lockCleanupInterval = null;
        }
    },
    
    /**
     * Cleanup all subscriptions and intervals
     * Called on logout or page unload
     */
    cleanup() {
        this.stopLockCleanup();
        
        for (const [key, channel] of Object.entries(this.lockSubscriptions)) {
            try {
                channel.unsubscribe();
            } catch (error) {
                console.error(`[FieldLockingService] Error unsubscribing from ${key}:`, error);
            }
        }
        
        this.lockSubscriptions = {};
    }
};

if (typeof window !== 'undefined') {
    window.FieldLockingService = FieldLockingService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FieldLockingService;
}

