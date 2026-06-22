/**
 * Subscription Guard Utility
 * Provides easy-to-use functions for pages to check subscription tiers
 * and conditionally load content based on subscription level
 * 
 * USAGE:
 *   // Check if user has premium access
 *   const hasPremium = await SubscriptionGuard.hasTier('premium');
 *   if (hasPremium) {
 *       // Load premium features
 *   }
 * 
 *   // Conditionally load content
 *   await SubscriptionGuard.loadIfTier('premium', () => {
 *       // This code only runs if user has premium tier
 *   });
 */

const SubscriptionGuard = {
    /**
     * Check if user has access to a specific tier
     * @param {string} requiredTier - Required tier: 'trial', 'basic', or 'premium'
     * @returns {Promise<boolean>} True if user has access to the tier
     */
    async hasTier(requiredTier) {
        try {
            if (!window.SubscriptionChecker) {
                console.warn('[SubscriptionGuard] SubscriptionChecker not available');
                return false;
            }
            
            const result = await window.SubscriptionChecker.checkTierAccess(requiredTier);
            return result.hasAccess;
        } catch (error) {
            console.error('[SubscriptionGuard] Error checking tier:', error);
            return false;
        }
    },
    
    /**
     * Get current subscription tier
     * @returns {Promise<string>} Current tier: 'trial', 'basic', 'premium', or 'none'
     */
    async getCurrentTier() {
        try {
            if (!window.SubscriptionChecker) {
                console.warn('[SubscriptionGuard] SubscriptionChecker not available');
                return 'none';
            }
            
            const accessResult = await window.SubscriptionChecker.checkAccess();
            return accessResult.tier || 'none';
        } catch (error) {
            console.error('[SubscriptionGuard] Error getting current tier:', error);
            return 'none';
        }
    },
    
    /**
     * Conditionally execute code based on tier access
     * @param {string} requiredTier - Required tier: 'trial', 'basic', or 'premium'
     * @param {Function} callback - Function to execute if user has access
     * @param {Function} fallback - Optional function to execute if user doesn't have access
     * @returns {Promise<void>}
     */
    async loadIfTier(requiredTier, callback, fallback = null) {
        const hasAccess = await this.hasTier(requiredTier);
        
        if (hasAccess) {
            if (typeof callback === 'function') {
                try {
                    await callback();
                } catch (error) {
                    console.error(`[SubscriptionGuard] Error executing callback for tier ${requiredTier}:`, error);
                }
            }
        } else {
            if (typeof fallback === 'function') {
                try {
                    await fallback();
                } catch (error) {
                    console.error(`[SubscriptionGuard] Error executing fallback for tier ${requiredTier}:`, error);
                }
            } else {
                console.log(`[SubscriptionGuard] User does not have ${requiredTier} tier access`);
            }
        }
    },
    
    /**
     * Show upgrade prompt if user doesn't have required tier
     * @param {string} requiredTier - Required tier: 'trial', 'basic', or 'premium'
     * @param {string} featureName - Name of the feature (for display)
     * @returns {Promise<boolean>} True if user has access, false if upgrade needed
     */
    async requireTier(requiredTier, featureName = 'this feature') {
        const hasAccess = await this.hasTier(requiredTier);
        
        if (!hasAccess) {
            const currentTier = await this.getCurrentTier();
            const tierName = window.SubscriptionChecker?.getTierName(requiredTier) || requiredTier;
            
            const message = `${featureName} requires a ${tierName} subscription. ` +
                          `You currently have a ${window.SubscriptionChecker?.getTierName(currentTier) || currentTier} subscription. ` +
                          `Would you like to upgrade?`;
            
            if (confirm(message)) {
                // Redirect to upgrade page
                const baseUrl = window.location.origin;
                const currentPath = window.location.pathname;
                const pathParts = currentPath.split('/').filter(p => p && p !== 'index.html');

                // Get all module names from registry
                const modules = window.ModuleRegistry?.getAllModuleNames() || [];

                let basePathParts = [];
                for (let i = 0; i < pathParts.length; i++) {
                    if (pathParts[i] === 'ui' || modules.includes(pathParts[i])) {
                        break;
                    }
                    basePathParts.push(pathParts[i]);
                }

                const basePath = basePathParts.length > 0 ? basePathParts.join('/') + '/' : '';
                const upgradeUrl = `${baseUrl}/${basePath}payments/views/subscription.html`;
                window.location.href = upgradeUrl;
            }
        }
        
        return hasAccess;
    },
    
    /**
     * Get subscription information for display
     * @returns {Promise<{tier: string, tierName: string, status: string, hasAccess: boolean}>}
     */
    async getSubscriptionInfo() {
        try {
            if (!window.SubscriptionChecker) {
                return {
                    tier: 'none',
                    tierName: 'None',
                    status: 'unknown',
                    hasAccess: false
                };
            }
            
            const accessResult = await window.SubscriptionChecker.checkAccess();
            const tier = accessResult.tier || 'none';
            const tierName = window.SubscriptionChecker.getTierName(tier);
            
            return {
                tier: tier,
                tierName: tierName,
                status: accessResult.status,
                hasAccess: accessResult.hasAccess,
                details: accessResult.details
            };
        } catch (error) {
            console.error('[SubscriptionGuard] Error getting subscription info:', error);
            return {
                tier: 'unknown',
                tierName: 'Unknown',
                status: 'error',
                hasAccess: false
            };
        }
    }
};

if (typeof window !== 'undefined') {
    window.SubscriptionGuard = SubscriptionGuard;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SubscriptionGuard;
}

