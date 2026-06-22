/**
 * Data Sharing Service
 * Handles permission checking for shared data access
 * Provides methods to check if users can read, write, or delete shared resources
 */

const DataSharingService = {
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
     * Check if current user has permission for a specific operation on shared data
     * @param {string} ownerUserId - User ID of the data owner
     * @param {string} resourceType - Type of resource: 'month', 'pot', or 'setting'
     * @param {string} resourceId - Resource identifier (month key, pot id, or 'settings')
     * @param {string} operation - Operation: 'read', 'write', or 'delete'
     * @param {Object} resourceData - Optional resource data for month-specific checks (year, month)
     * @returns {Promise<{hasPermission: boolean, accessLevel: string|null, error: string|null}>}
     */
    async checkSharePermission(ownerUserId, resourceType, resourceId, operation, resourceData = null) {
        try {
            const databaseService = this._getDatabaseService();
            const authService = this._getAuthService();
            
            if (!databaseService || !authService) {
                throw new Error('DatabaseService or AuthService not available');
            }
            
            const currentUserId = await databaseService._getCurrentUserId();
            if (!currentUserId) {
                return {
                    hasPermission: false,
                    accessLevel: null,
                    error: 'User not authenticated'
                };
            }
            
            if (currentUserId === ownerUserId) {
                return {
                    hasPermission: true,
                    accessLevel: 'owner',
                    error: null
                };
            }
            
            const tableName = this._getTableName('dataShares');
            const result = await databaseService.querySelect(tableName, {
                filter: {
                    owner_user_id: ownerUserId,
                    shared_with_user_id: currentUserId
                },
                limit: 1
            });
            
            if (result.error) {
                console.error('[DataSharingService] Error checking share permission:', result.error);
                return {
                    hasPermission: false,
                    accessLevel: null,
                    error: result.error.message || 'Failed to check share permission'
                };
            }
            
            const share = result.data && result.data.length > 0 ? result.data[0] : null;
            if (!share) {
                return {
                    hasPermission: false,
                    accessLevel: null,
                    error: null
                };
            }

            if (share.status !== 'accepted') {
                return {
                    hasPermission: false,
                    accessLevel: null,
                    error: null
                };
            }
            
            // Parse shared_months if it's a string (JSONB from database)
            if (share.shared_months && typeof share.shared_months === 'string') {
                try {
                    share.shared_months = JSON.parse(share.shared_months);
                } catch (e) {
                    console.warn('[DataSharingService] Failed to parse shared_months:', e);
                    share.shared_months = [];
                }
            }
            
            // Check share_all_data (handle both snake_case and camelCase)
            const shareAllData = share.share_all_data || share.shareAllData || false;
            
            console.log('[DataSharingService] Checking permission:', {
                resourceType,
                operation,
                shareAllData,
                accessLevel: share.access_level,
                sharedMonths: share.shared_months,
                resourceData
            });
            
            if (resourceType === 'month' && resourceData) {
                // Check if share_all_data is true - if so, all months are shared
                if (!shareAllData) {
                    // Only check specific months if share_all_data is false
                    const isMonthShared = this._isMonthInSharedList(resourceData.year, resourceData.month, share.shared_months || []);
                    if (!isMonthShared) {
                        console.log('[DataSharingService] Month not in shared list:', {
                            year: resourceData.year,
                            month: resourceData.month,
                            sharedMonths: share.shared_months
                        });
                        return {
                            hasPermission: false,
                            accessLevel: null,
                            error: null
                        };
                    }
                }
                // If share_all_data is true, skip the month check and proceed
            } else if (resourceType === 'pot' && !shareAllData && !share.shared_pots) {
                return {
                    hasPermission: false,
                    accessLevel: null,
                    error: null
                };
            } else if (resourceType === 'setting' && !share.share_all_data && !share.shared_settings) {
                return {
                    hasPermission: false,
                    accessLevel: null,
                    error: null
                };
            }
            
            let hasPermission = false;
            if (operation === 'read') {
                hasPermission = true;
            } else if (operation === 'write') {
                hasPermission = share.access_level === 'read_write' || share.access_level === 'read_write_delete';
            } else if (operation === 'delete') {
                hasPermission = share.access_level === 'read_write_delete';
            }
            
            return {
                hasPermission: hasPermission,
                accessLevel: share.access_level,
                error: null
            };
        } catch (error) {
            console.error('[DataSharingService] Exception checking share permission:', error);
            return {
                hasPermission: false,
                accessLevel: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Check if current user can read a resource
     * @param {string} ownerUserId - User ID of the data owner
     * @param {string} resourceType - Type of resource: 'month', 'pot', or 'setting'
     * @param {string} resourceId - Resource identifier
     * @param {Object} resourceData - Optional resource data for month-specific checks
     * @returns {Promise<boolean>} True if user can read
     */
    async canRead(ownerUserId, resourceType, resourceId, resourceData = null) {
        const result = await this.checkSharePermission(ownerUserId, resourceType, resourceId, 'read', resourceData);
        return result.hasPermission;
    },
    
    /**
     * Check if current user can write to a resource
     * @param {string} ownerUserId - User ID of the data owner
     * @param {string} resourceType - Type of resource: 'month', 'pot', or 'setting'
     * @param {string} resourceId - Resource identifier
     * @param {Object} resourceData - Optional resource data for month-specific checks
     * @returns {Promise<boolean>} True if user can write
     */
    async canWrite(ownerUserId, resourceType, resourceId, resourceData = null) {
        const result = await this.checkSharePermission(ownerUserId, resourceType, resourceId, 'write', resourceData);
        return result.hasPermission;
    },
    
    /**
     * Check if current user can delete a resource
     * @param {string} ownerUserId - User ID of the data owner
     * @param {string} resourceType - Type of resource: 'month', 'pot', or 'setting'
     * @param {string} resourceId - Resource identifier
     * @param {Object} resourceData - Optional resource data for month-specific checks
     * @returns {Promise<boolean>} True if user can delete
     */
    async canDelete(ownerUserId, resourceType, resourceId, resourceData = null) {
        const result = await this.checkSharePermission(ownerUserId, resourceType, resourceId, 'delete', resourceData);
        return result.hasPermission;
    },
    
    /**
     * Get access level for a share between two users
     * @param {string} ownerUserId - User ID of the data owner
     * @param {string} sharedWithUserId - User ID of the shared user
     * @returns {Promise<{success: boolean, accessLevel: string|null, share: Object|null, error: string|null}>}
     */
    async getAccessLevel(ownerUserId, sharedWithUserId) {
        try {
            const databaseService = this._getDatabaseService();
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }
            
            const tableName = this._getTableName('dataShares');
            const result = await databaseService.querySelect(tableName, {
                filter: {
                    owner_user_id: ownerUserId,
                    shared_with_user_id: sharedWithUserId
                },
                limit: 1
            });
            
            if (result.error) {
                console.error('[DataSharingService] Error getting access level:', result.error);
                return {
                    success: false,
                    accessLevel: null,
                    share: null,
                    error: result.error.message || 'Failed to get access level'
                };
            }
            
            const share = result.data && result.data.length > 0 ? result.data[0] : null;
            
            return {
                success: true,
                accessLevel: share ? share.access_level : null,
                share: share,
                error: null
            };
        } catch (error) {
            console.error('[DataSharingService] Exception getting access level:', error);
            return {
                success: false,
                accessLevel: null,
                share: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Check if a month is in the shared months list
     * Supports both individual months and date ranges
     * @param {number} year - Year to check
     * @param {number} month - Month to check (1-12)
     * @param {Array} sharedMonths - Array of shared month objects or date ranges
     * @returns {boolean} True if month is shared
     */
    _isMonthInSharedList(year, month, sharedMonths) {
        if (!Array.isArray(sharedMonths) || sharedMonths.length === 0) {
            return false;
        }
        
        for (const monthEntry of sharedMonths) {
            if (monthEntry.type === 'range') {
                const startYear = parseInt(monthEntry.startYear, 10);
                const endYear = parseInt(monthEntry.endYear, 10);
                const startMonth = parseInt(monthEntry.startMonth, 10);
                const endMonth = parseInt(monthEntry.endMonth, 10);
                
                if (year < startYear || year > endYear) {
                    continue;
                }
                
                if (year === startYear && month < startMonth) {
                    continue;
                }
                
                if (year === endYear && month > endMonth) {
                    continue;
                }
                
                return true;
            } else {
                const entryYear = parseInt(monthEntry.year, 10);
                const entryMonth = parseInt(monthEntry.month, 10);
                
                if (entryYear === year && entryMonth === month) {
                    return true;
                }
            }
        }
        
        return false;
    },

    /**
     * Check if a user is blocked by another user
     * @param {string} ownerUserId - User ID of the data owner
     * @param {string} sharedWithUserId - User ID to check if blocked
     * @returns {Promise<{isBlocked: boolean, error: string|null}>}
     */
    async checkIfBlocked(ownerUserId, sharedWithUserId) {
        try {
            console.log('[DataSharingService] checkIfBlocked() called', { ownerUserId, sharedWithUserId });

            const databaseService = this._getDatabaseService();
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }

            const tableName = this._getTableName('blockedUsers');
            if (!tableName) {
                throw new Error('blockedUsers table name not configured');
            }

            const result = await databaseService.querySelect(tableName, {
                filter: {
                    user_id: sharedWithUserId,
                    blocked_user_id: ownerUserId
                },
                limit: 1
            });

            if (result.error) {
                console.error('[DataSharingService] Error checking if blocked:', result.error);
                return {
                    isBlocked: false,
                    error: result.error.message || 'Failed to check if blocked'
                };
            }

            const isBlocked = result.data && result.data.length > 0;

            return {
                isBlocked: isBlocked,
                error: null
            };
        } catch (error) {
            console.error('[DataSharingService] Exception checking if blocked:', error);
            return {
                isBlocked: false,
                error: error.message || 'An unexpected error occurred'
            };
        }
    }
};

if (typeof window !== 'undefined') {
    window.DataSharingService = DataSharingService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DataSharingService;
}

