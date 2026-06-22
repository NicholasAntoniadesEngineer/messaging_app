/**
 * Permission Service
 *
 * Centralized permission management for all features across subscription tiers.
 * This is the single source of truth for what each tier can access.
 *
 * TIERS:
 * - 'free': Basic access, limited features
 * - 'trial': Same as premium, time-limited (30 days)
 * - 'premium': Full access to all features
 *
 * To add a new feature gate:
 * 1. Add to FEATURE_PERMISSIONS below
 * 2. Use PermissionService.canAccess('feature_name') in code
 */

const PermissionService = {
    /**
     * Tier hierarchy - higher number = more access
     */
    TIER_LEVELS: {
        'free': 0,
        'trial': 2,      // Trial gets premium features
        'premium': 2,
        'basic': 0       // Alias for free
    },

    /**
     * Feature permissions configuration
     *
     * IMPORTANT: This must reflect ACTUALLY IMPLEMENTED features only.
     *
     * Each feature defines:
     * - requiredTier: minimum tier needed
     * - limit: optional numeric limit (null = unlimited)
     * - description: human-readable description
     */
    FEATURE_PERMISSIONS: {
        // ============================================================
        // BUDGET DATA - Core feature
        // ============================================================
        'months.create': {
            free: { allowed: true, limit: 2 },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'Number of months of budget data'
        },
        'months.view': {
            free: { allowed: true, limit: 2 },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'View historical months'
        },

        // ============================================================
        // DATA SHARING - Implemented via DataSharingService
        // ============================================================
        'sharing.create': {
            free: { allowed: false },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'Create data shares with others'
        },
        'sharing.receive': {
            free: { allowed: true, limit: null },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'Receive shared data from others'
        },

        // ============================================================
        // MESSAGING - E2E encrypted messaging via MessagingService
        // ============================================================
        'messaging.send': {
            free: { allowed: false },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'Send encrypted messages'
        },
        'messaging.receive': {
            free: { allowed: true, limit: null },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'Receive messages'
        },
        // File attachments - encrypted client-side, 24hr retention
        'messaging.attachments': {
            free: { allowed: false, maxSizeBytes: 0 },
            trial: { allowed: true, maxSizeBytes: 1 * 1024 * 1024 },  // 1MB
            premium: { allowed: true, maxSizeBytes: 1 * 1024 * 1024 }, // 1MB
            description: 'Send file attachments in messages',
            fileRetentionHours: 24  // Files auto-deleted after 24 hours
        },

        // ============================================================
        // DEVICE PAIRING - Multi-device sync via DevicePairingService
        // ============================================================
        'devices.pair': {
            free: { allowed: true, limit: 1 },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'Number of paired devices'
        },

        // ============================================================
        // POTS - Savings goals within monthly budgets
        // ============================================================
        'pots.create': {
            free: { allowed: true, limit: 3 },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'Number of savings pots'
        },

        // ============================================================
        // EXPORT - JSON, CSV, HTML export via ExportService
        // ============================================================
        'export.json': {
            free: { allowed: true, limit: null },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'Export data to JSON'
        },
        'export.csv': {
            free: { allowed: true, limit: null },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'Export data to CSV'
        },
        'export.html': {
            free: { allowed: true, limit: null },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'Export printable HTML reports'
        },

        // ============================================================
        // NOTIFICATIONS - In-app notifications (email/push NOT implemented)
        // ============================================================
        'notifications.inapp': {
            free: { allowed: true, limit: null },
            trial: { allowed: true, limit: null },
            premium: { allowed: true, limit: null },
            description: 'In-app notifications'
        }
    },

    /**
     * Current user's tier (cached)
     */
    _currentTier: null,
    _subscriptionStatus: null,
    _lastCheck: null,
    _checkInterval: 60000, // Re-check every 60 seconds

    /**
     * Initialize the permission service
     */
    async initialize() {
        console.log('[PermissionService] Initializing...');
        await this.refreshTier();
        console.log('[PermissionService] Initialized with tier:', this._currentTier);
        return true;
    },

    /**
     * Refresh the user's tier from subscription service
     */
    async refreshTier() {
        try {
            if (!window.SubscriptionChecker) {
                console.warn('[PermissionService] SubscriptionChecker not available, defaulting to free');
                this._currentTier = 'free';
                this._subscriptionStatus = 'unknown';
                return;
            }

            const accessCheck = await window.SubscriptionChecker.checkAccess();
            console.log('[PermissionService] Access check result:', accessCheck);

            if (accessCheck.hasAccess) {
                this._currentTier = accessCheck.tier || 'premium';
                this._subscriptionStatus = accessCheck.status;
            } else {
                // Map status to tier for non-access cases
                if (accessCheck.status === 'trial_expired' ||
                    accessCheck.status === 'subscription_expired' ||
                    accessCheck.status === 'cancelled') {
                    this._currentTier = 'free';
                } else {
                    this._currentTier = 'free';
                }
                this._subscriptionStatus = accessCheck.status;
            }

            this._lastCheck = Date.now();
            console.log('[PermissionService] Tier set to:', this._currentTier, 'Status:', this._subscriptionStatus);
        } catch (error) {
            console.error('[PermissionService] Error refreshing tier:', error);
            this._currentTier = 'free';
            this._subscriptionStatus = 'error';
        }
    },

    /**
     * Get current tier (with auto-refresh if stale)
     */
    async getCurrentTier() {
        const now = Date.now();
        if (!this._currentTier || !this._lastCheck || (now - this._lastCheck > this._checkInterval)) {
            await this.refreshTier();
        }
        return this._currentTier;
    },

    /**
     * Get current subscription status
     */
    getSubscriptionStatus() {
        return this._subscriptionStatus;
    },

    /**
     * Check if user can access a feature
     * @param {string} feature - Feature key from FEATURE_PERMISSIONS
     * @returns {Promise<{allowed: boolean, limit: number|null, reason: string|null}>}
     */
    async canAccess(feature) {
        const tier = await this.getCurrentTier();
        return this.canAccessSync(feature, tier);
    },

    /**
     * Synchronous version - use when tier is already known
     * @param {string} feature - Feature key
     * @param {string} tier - User's tier
     */
    canAccessSync(feature, tier) {
        const featureConfig = this.FEATURE_PERMISSIONS[feature];

        if (!featureConfig) {
            console.warn('[PermissionService] Unknown feature:', feature);
            return { allowed: false, limit: null, reason: 'Unknown feature' };
        }

        // Normalize tier (handle 'basic' as 'free')
        const normalizedTier = tier === 'basic' ? 'free' : tier;
        const tierConfig = featureConfig[normalizedTier];

        if (!tierConfig) {
            console.warn('[PermissionService] No config for tier:', normalizedTier, 'feature:', feature);
            return { allowed: false, limit: null, reason: 'Tier not configured' };
        }

        if (!tierConfig.allowed) {
            return {
                allowed: false,
                limit: null,
                reason: `${featureConfig.description} requires ${this.getUpgradeTierName(feature)}`
            };
        }

        return {
            allowed: true,
            limit: tierConfig.limit,
            reason: null
        };
    },

    /**
     * Check if user has reached their limit for a feature
     * @param {string} feature - Feature key
     * @param {number} currentCount - Current usage count
     */
    async hasReachedLimit(feature, currentCount) {
        const access = await this.canAccess(feature);

        if (!access.allowed) {
            return {
                reachedLimit: true,
                limit: 0,
                currentCount,
                reason: access.reason
            };
        }

        if (access.limit === null) {
            return {
                reachedLimit: false,
                limit: null,
                currentCount,
                reason: null
            };
        }

        const reachedLimit = currentCount >= access.limit;
        return {
            reachedLimit,
            limit: access.limit,
            currentCount,
            reason: reachedLimit ? `You've reached the limit of ${access.limit} for your plan` : null
        };
    },

    /**
     * Get the tier name needed to unlock a feature
     */
    getUpgradeTierName(feature) {
        const featureConfig = this.FEATURE_PERMISSIONS[feature];
        if (!featureConfig) return 'Premium';

        // Find the lowest tier that allows this feature
        if (featureConfig.trial?.allowed) return 'Premium';
        if (featureConfig.premium?.allowed) return 'Premium';
        return 'Premium';
    },

    /**
     * Check if a file can be attached (size check)
     * @param {number} fileSizeBytes - File size in bytes
     * @returns {Promise<{allowed: boolean, maxSizeBytes: number, reason: string|null}>}
     */
    async canAttachFile(fileSizeBytes) {
        const tier = await this.getCurrentTier();
        const featureConfig = this.FEATURE_PERMISSIONS['messaging.attachments'];
        const normalizedTier = tier === 'basic' ? 'free' : tier;
        const tierConfig = featureConfig[normalizedTier];

        if (!tierConfig || !tierConfig.allowed) {
            return {
                allowed: false,
                maxSizeBytes: 0,
                reason: 'File attachments require Premium'
            };
        }

        const maxSize = tierConfig.maxSizeBytes || 0;
        if (fileSizeBytes > maxSize) {
            const maxSizeMB = Math.round(maxSize / (1024 * 1024));
            const fileSizeMB = (fileSizeBytes / (1024 * 1024)).toFixed(1);
            return {
                allowed: false,
                maxSizeBytes: maxSize,
                reason: `File size (${fileSizeMB}MB) exceeds limit of ${maxSizeMB}MB`
            };
        }

        return {
            allowed: true,
            maxSizeBytes: maxSize,
            reason: null
        };
    },

    /**
     * Get file attachment settings for current tier
     */
    async getFileAttachmentSettings() {
        const tier = await this.getCurrentTier();
        const featureConfig = this.FEATURE_PERMISSIONS['messaging.attachments'];
        const normalizedTier = tier === 'basic' ? 'free' : tier;
        const tierConfig = featureConfig[normalizedTier];

        return {
            allowed: tierConfig?.allowed || false,
            maxSizeBytes: tierConfig?.maxSizeBytes || 0,
            maxSizeMB: tierConfig?.maxSizeBytes ? Math.round(tierConfig.maxSizeBytes / (1024 * 1024)) : 0,
            retentionHours: featureConfig.fileRetentionHours || 24
        };
    },

    /**
     * Get all features and their access status for current user
     */
    async getAllFeatureAccess() {
        const tier = await this.getCurrentTier();
        const features = {};

        for (const [key, config] of Object.entries(this.FEATURE_PERMISSIONS)) {
            features[key] = {
                ...this.canAccessSync(key, tier),
                description: config.description
            };
        }

        return features;
    },

    /**
     * Get human-readable tier name
     */
    getTierDisplayName(tier) {
        const names = {
            'free': 'Free',
            'basic': 'Free',
            'trial': 'Premium Trial',
            'premium': 'Premium'
        };
        return names[tier] || tier;
    },

    /**
     * Check if user is on a trial
     */
    async isOnTrial() {
        const tier = await this.getCurrentTier();
        return tier === 'trial';
    },

    /**
     * Check if user is premium (paid or trial)
     */
    async isPremium() {
        const tier = await this.getCurrentTier();
        return tier === 'premium' || tier === 'trial';
    },

    /**
     * Check if user is on free tier
     */
    async isFree() {
        const tier = await this.getCurrentTier();
        return tier === 'free' || tier === 'basic';
    },

    /**
     * Get upgrade prompt message for a feature
     */
    getUpgradeMessage(feature) {
        const featureConfig = this.FEATURE_PERMISSIONS[feature];
        if (!featureConfig) {
            return 'Upgrade to Premium to unlock this feature';
        }

        const freeLimit = featureConfig.free?.limit;
        if (freeLimit !== undefined && freeLimit !== null) {
            return `Free plan allows ${freeLimit} ${featureConfig.description.toLowerCase()}. Upgrade to Premium for unlimited access.`;
        }

        return `${featureConfig.description} requires Premium. Upgrade to unlock.`;
    },

    /**
     * Log current permission state (for debugging)
     */
    async logState() {
        const tier = await this.getCurrentTier();
        const features = await this.getAllFeatureAccess();

        console.log('[PermissionService] === Current State ===');
        console.log('[PermissionService] Tier:', tier);
        console.log('[PermissionService] Status:', this._subscriptionStatus);
        console.log('[PermissionService] Features:', features);
        console.log('[PermissionService] ========================');
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.PermissionService = PermissionService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PermissionService;
}
