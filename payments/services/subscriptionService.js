/**
 * Subscription Service
 * Manages subscription lifecycle, trials, and status
 * Supports subscription tiers: trial, basic, premium
 */

const SubscriptionService = {
    /**
     * Get database service (requires config)
     * @returns {Object} Database service
     * @throws {Error} If ConfigHelper is not available or database service is not configured
     */
    _getDatabaseService() {
        if (typeof ConfigHelper === 'undefined') {
            throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
        }
        return ConfigHelper.getDatabaseService(this);
    },
    
    /**
     * Get auth service (requires config)
     * @returns {Object} Auth service
     * @throws {Error} If ConfigHelper is not available or auth service is not configured
     */
    _getAuthService() {
        if (typeof ConfigHelper === 'undefined') {
            throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
        }
        return ConfigHelper.getAuthService(this);
    },
    
    /**
     * Get table name (requires config)
     * @param {string} tableKey - Table key
     * @returns {string} Table name
     * @throws {Error} If ConfigHelper is not available or table name is not configured
     */
    _getTableName(tableKey) {
        if (typeof ConfigHelper === 'undefined') {
            throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
        }
        return ConfigHelper.getTableName(this, tableKey);
    },
    
    /**
     * Get subscription config (requires config)
     * @returns {Object} Subscription config
     * @throws {Error} If ConfigHelper is not available or subscription config is not configured
     */
    _getSubscriptionConfig() {
        if (typeof ConfigHelper === 'undefined') {
            throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
        }
        return ConfigHelper.getSubscriptionConfig(this);
    },
    
    /**
     * Subscription tier mapping
     * Maps plan names to subscription tiers
     * Note: This is used as fallback. Config-based tier mapping takes precedence.
     */
    TIER_MAPPING: {
        // Trial tier (no payment required)
        'trial': 'trial',
        // Basic tier plans (free tier)
        'Free': 'basic',
        'Monthly Subscription': 'basic',
        'Basic Subscription': 'basic',
        // Premium tier plans
        'Premium': 'premium',
        'Premium Subscription': 'premium'
    },
    
    /**
     * Get subscription tier from plan name and status
     * Matches the SQL helper function get_subscription_type()
     * @param {string|null|undefined} planName - Plan name from database
     * @param {string} status - 'trial', 'active', 'canceled', etc.
     * @param {number|null} planId - Plan ID to check if Free plan
     * @returns {string} Tier: 'trial', 'basic', or 'premium'
     */
    getSubscriptionTier(planName, status = 'trial', planId = null) {
        // If status is 'trial', always return 'trial' tier (matches SQL helper)
        if (status === 'trial') {
            return 'trial';
        }

        // Check if Free plan using plan name
        if (planName && planName.toLowerCase() === 'free') {
            return 'basic';
        }

        // For paid subscriptions, map plan name to tier
        if (!planName) {
            // Default to basic if no plan name
            return 'basic';
        }

        // Get tier mapping from config if available
        const subscriptionConfig = this._getSubscriptionConfig();
        const tierMapping = subscriptionConfig.tierMapping || this.TIER_MAPPING;

        // Check tier mapping (case-insensitive)
        const planNameLower = planName.toLowerCase();
        for (const [key, tier] of Object.entries(tierMapping)) {
            if (planNameLower === key.toLowerCase()) {
                return tier;
            }
        }

        // Default to basic if plan not found in mapping
        console.warn('[SubscriptionService] Plan name not in tier mapping, defaulting to basic:', planName);
        return 'basic';
    },
    
    /**
     * Check if user has access to a specific tier
     * @param {string} requiredTier - Required tier: 'trial', 'basic', or 'premium'
     * @param {string} userTier - User's current tier
     * @returns {boolean} True if user has access
     */
    hasTierAccess(requiredTier, userTier) {
        const subscriptionConfig = this._getSubscriptionConfig();
        const tierHierarchy = subscriptionConfig.tierHierarchy || {
            'trial': 0,
            'basic': 1,
            'premium': 2
        };
        
        const requiredLevel = tierHierarchy[requiredTier] ?? 0;
        const userLevel = tierHierarchy[userTier] ?? 0;
        
        return userLevel >= requiredLevel;
    },
    /**
     * Get default subscription plan from database
     * @returns {Promise<{success: boolean, plan: Object|null, error: string|null}>}
     */
    async getDefaultPlan() {
        try {
            const databaseService = this._getDatabaseService();
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }
            
            const tableName = this._getTableName('subscriptionPlans');
            const result = await databaseService.querySelect(tableName, {
                filter: { is_active: true },
                order: [{ column: 'id', ascending: true }],
                limit: 1
            });
            
            if (result.error) {
                console.error('[SubscriptionService] Error getting default plan:', result.error);
                return {
                    success: false,
                    plan: null,
                    error: result.error.message || 'Failed to get default plan'
                };
            }
            
            const plan = result.data && result.data.length > 0 ? result.data[0] : null;
            
            return {
                success: true,
                plan: plan,
                error: null
            };
        } catch (error) {
            console.error('[SubscriptionService] Exception getting default plan:', error);
            return {
                success: false,
                plan: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Create a 30-day Premium trial subscription for a user
     * NOTE: This is normally handled by the database trigger on signup.
     * This function is a fallback for edge cases where the trigger didn't fire.
     * @param {string} userId - User ID from Supabase
     * @returns {Promise<{success: boolean, subscription: Object|null, error: string|null}>}
     */
    async createTrialSubscription(userId) {
        try {
            const databaseService = this._getDatabaseService();
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }

            console.log('[SubscriptionService] Creating trial subscription for user:', userId);

            // Get Premium plan from database (trial is for Premium features)
            const tableName = this._getTableName('subscriptionPlans');
            const planResult = await databaseService.querySelect(tableName, {
                filter: { name: 'Premium' },
                limit: 1
            });

            if (planResult.error || !planResult.data || planResult.data.length === 0) {
                console.error('[SubscriptionService] Premium plan not found in database');
                return {
                    success: false,
                    subscription: null,
                    error: 'Premium plan not found in database'
                };
            }

            const plan = planResult.data[0];
            const trialPeriodDays = plan.trial_period_days || 30;
            const now = new Date();
            const trialEnd = new Date(now);
            trialEnd.setDate(trialEnd.getDate() + trialPeriodDays);

            // New optimal schema - much simpler!
            const subscriptionData = {
                user_id: userId,
                plan_id: plan.id,
                status: 'trial',
                trial_end: trialEnd.toISOString(),
                stripe_customer_id: null,
                stripe_subscription_id: null,
                stripe_price_id: null,
                current_period_start: null,
                current_period_end: null,
                cancel_at_period_end: false,
                canceled_at: null,
                pending_plan_id: null,
                pending_change_at: null
            };

            const subscriptionsTableName = this._getTableName('subscriptions');
            const result = await databaseService.queryUpsert(subscriptionsTableName, subscriptionData, {
                identifier: 'user_id',
                identifierValue: userId
            });

            if (result.error) {
                console.error('[SubscriptionService] Error creating trial subscription:', result.error);
                return {
                    success: false,
                    subscription: null,
                    error: result.error.message || 'Failed to create trial subscription'
                };
            }

            const subscription = result.data && result.data.length > 0 ? result.data[0] : null;

            console.log('[SubscriptionService] Trial subscription created successfully:', {
                userId: userId,
                planId: plan.id,
                planName: plan.name,
                trialEnd: trialEnd.toISOString()
            });

            return {
                success: true,
                subscription: subscription,
                error: null
            };
        } catch (error) {
            console.error('[SubscriptionService] Exception creating trial subscription:', error);
            return {
                success: false,
                subscription: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Get subscription for current user with plan details
     * Fetches subscription and related plan from database
     * @returns {Promise<{success: boolean, subscription: Object|null, plan: Object|null, error: string|null}>}
     */
    async getCurrentUserSubscription() {
        const methodStartTime = Date.now();
        console.log('[SubscriptionService] ========== getCurrentUserSubscription() CALLED ==========');
        console.log('[SubscriptionService] getCurrentUserSubscription - call stack:', new Error().stack?.split('\n').slice(1, 6).join('\n'));
        
        try {
            const databaseService = this._getDatabaseService();
            const authService = this._getAuthService();
            
            console.log('[SubscriptionService] getCurrentUserSubscription - checking services availability...');
            if (!databaseService) {
                const error = new Error('DatabaseService not available');
                console.error('[SubscriptionService] ❌ getCurrentUserSubscription error:', error);
                throw error;
            }
            
            if (!authService) {
                const error = new Error('AuthService not available');
                console.error('[SubscriptionService] ❌ getCurrentUserSubscription error:', error);
                throw error;
            }
            
            console.log('[SubscriptionService] getCurrentUserSubscription - services available');
            console.log('[SubscriptionService] getCurrentUserSubscription - DatabaseService.client state:', {
                hasDatabaseService: !!databaseService,
                hasClient: !!databaseService.client,
                clientType: databaseService.client?.constructor?.name,
                hasSupabaseUrl: !!databaseService.client?.supabaseUrl,
                clientIsNull: databaseService.client === null,
                clientIsUndefined: databaseService.client === undefined
            });
            
            // Ensure DatabaseService is initialized before using it
            if (!databaseService.client) {
                console.log('[SubscriptionService] ⚠️ DatabaseService not initialized, initializing...');
                const initStartTime = Date.now();
                try {
                    await databaseService.initialize();
                    const initElapsed = Date.now() - initStartTime;
                    console.log(`[SubscriptionService] DatabaseService.initialize() completed in ${initElapsed}ms`);
                } catch (initError) {
                    console.error('[SubscriptionService] ❌ DatabaseService.initialize() failed:', initError);
                    console.error('[SubscriptionService] init error details:', {
                        message: initError.message,
                        name: initError.name,
                        stack: initError.stack
                    });
                    throw initError;
                }
            } else {
                console.log('[SubscriptionService] DatabaseService already initialized');
            }
            
            console.log('[SubscriptionService] getCurrentUserSubscription - DatabaseService.client state AFTER init check:', {
                hasClient: !!databaseService.client,
                clientType: databaseService.client?.constructor?.name,
                hasSupabaseUrl: !!databaseService.client?.supabaseUrl,
                supabaseUrl: databaseService.client?.supabaseUrl
            });
            
            console.log('[SubscriptionService] getCurrentUserSubscription - calling _getCurrentUserId()...');
            const userId = await databaseService._getCurrentUserId();
            console.log('[SubscriptionService] getCurrentUserSubscription - userId:', userId);
            if (!userId) {
                return {
                    success: false,
                    subscription: null,
                    plan: null,
                    error: 'User not authenticated'
                };
            }
            
            // Get subscription
            console.log('[SubscriptionService] getCurrentUserSubscription - calling querySelect for subscriptions...');
            console.log('[SubscriptionService] getCurrentUserSubscription - DatabaseService.client state BEFORE querySelect:', {
                hasClient: !!databaseService.client,
                clientType: databaseService.client?.constructor?.name,
                hasSupabaseUrl: !!databaseService.client?.supabaseUrl
            });
            
            const queryStartTime = Date.now();
            const tableName = this._getTableName('subscriptions');
            const subscriptionResult = await databaseService.querySelect(tableName, {
                filter: { user_id: userId },
                limit: 1
            });
            const queryElapsed = Date.now() - queryStartTime;
            console.log(`[SubscriptionService] getCurrentUserSubscription - querySelect completed in ${queryElapsed}ms`);
            console.log('[SubscriptionService] getCurrentUserSubscription - subscriptionResult:', {
                hasData: !!subscriptionResult.data,
                dataIsArray: Array.isArray(subscriptionResult.data),
                dataLength: Array.isArray(subscriptionResult.data) ? subscriptionResult.data.length : 'N/A',
                hasError: !!subscriptionResult.error,
                errorMessage: subscriptionResult.error?.message
            });
            
            if (subscriptionResult.error) {
                console.error('[SubscriptionService] ❌ Error getting subscription:', subscriptionResult.error);
                console.error('[SubscriptionService] subscriptionResult.error details:', {
                    message: subscriptionResult.error.message,
                    code: subscriptionResult.error.code,
                    status: subscriptionResult.error.status
                });
                return {
                    success: false,
                    subscription: null,
                    plan: null,
                    error: subscriptionResult.error.message || 'Failed to get subscription'
                };
            }
            
            let subscription = subscriptionResult.data && subscriptionResult.data.length > 0 ? subscriptionResult.data[0] : null;
            console.log('[SubscriptionService] getCurrentUserSubscription - subscription:', {
                hasSubscription: !!subscription,
                subscriptionStatus: subscription?.status,
                planId: subscription?.plan_id,
                trialEnd: subscription?.trial_end
            });

            // AUTO-DOWNGRADE: Check if trial has expired and auto-downgrade to Free
            if (subscription && subscription.status === 'trial' && subscription.trial_end) {
                const trialEndDate = new Date(subscription.trial_end);
                const now = new Date();

                if (now > trialEndDate) {
                    console.log('[SubscriptionService] ⚠️ Trial expired, auto-downgrading to Free plan...');
                    console.log('[SubscriptionService] Trial ended:', trialEndDate.toISOString());
                    console.log('[SubscriptionService] Current time:', now.toISOString());

                    // Get Free plan ID
                    const plansTableName = this._getTableName('subscriptionPlans');
                    const freePlanResult = await databaseService.querySelect(plansTableName, {
                        filter: { name: 'Free' },
                        limit: 1
                    });

                    if (freePlanResult.data && freePlanResult.data.length > 0) {
                        const freePlan = freePlanResult.data[0];
                        console.log('[SubscriptionService] Free plan found:', freePlan.id);

                        // Downgrade to Free plan
                        const downgradeResult = await this.updateSubscription(currentUser.id, {
                            plan_id: freePlan.id,
                            status: 'active',
                            trial_end: null,
                            stripe_customer_id: null,
                            stripe_subscription_id: null,
                            stripe_price_id: null,
                            current_period_start: null,
                            current_period_end: null,
                            cancel_at_period_end: false,
                            canceled_at: null,
                            pending_plan_id: null,
                            pending_change_at: null
                        });

                        if (downgradeResult.success) {
                            console.log('[SubscriptionService] ✅ Successfully auto-downgraded to Free plan');
                            subscription = downgradeResult.subscription;
                        } else {
                            console.error('[SubscriptionService] ❌ Failed to auto-downgrade:', downgradeResult.error);
                        }
                    } else {
                        console.error('[SubscriptionService] ❌ Free plan not found in database');
                    }
                }
            }

            // Get plan details if subscription has plan_id
            let plan = null;
            if (subscription && subscription.plan_id) {
                const plansTableName = this._getTableName('subscriptionPlans');
                const planResult = await databaseService.querySelect(plansTableName, {
                    filter: { id: subscription.plan_id },
                    limit: 1
                });
                
                console.log('[SubscriptionService] Plan query result:', {
                    hasData: planResult.data !== null && planResult.data !== undefined,
                    dataLength: Array.isArray(planResult.data) ? planResult.data.length : 'N/A',
                    hasError: planResult.error !== null,
                    planId: subscription.plan_id,
                    dataType: typeof planResult.data,
                    isArray: Array.isArray(planResult.data)
                });
                
                // querySelect returns {data, error} - hasData is not part of the return value
                // Check if we have valid data (data exists and is not empty)
                const hasValidData = planResult.data && 
                                    ((Array.isArray(planResult.data) && planResult.data.length > 0) || 
                                     (typeof planResult.data === 'object' && !Array.isArray(planResult.data) && planResult.data !== null));
                
                if (hasValidData && planResult.data) {
                    // Handle both array and single object responses
                    if (Array.isArray(planResult.data)) {
                        if (planResult.data.length > 0) {
                    plan = planResult.data[0];
                            console.log('[SubscriptionService] Plan found (from array):', {
                                id: plan.id,
                                plan_name: plan.plan_name,
                                price_cents: plan.price_cents
                            });
                        } else {
                            console.warn('[SubscriptionService] Plan array is empty for plan_id:', subscription.plan_id);
                        }
                    } else if (typeof planResult.data === 'object' && planResult.data !== null) {
                        // Single object response
                        plan = planResult.data;
                        console.log('[SubscriptionService] Plan found (single object):', {
                            id: plan.id,
                            plan_name: plan.plan_name,
                            price_cents: plan.price_cents
                        });
                    }
                } else {
                    console.warn('[SubscriptionService] Plan not found for plan_id:', subscription.plan_id, {
                        hasData: planResult.data !== null && planResult.data !== undefined,
                        hasError: planResult.error !== null,
                        error: planResult.error,
                        hasValidData: hasValidData,
                        dataExists: !!planResult.data,
                        dataType: typeof planResult.data,
                        isArray: Array.isArray(planResult.data),
                        dataLength: Array.isArray(planResult.data) ? planResult.data.length : 'N/A'
                    });
                }
            }
            
            // Calculate subscription tier
            // If downgrade is pending but not yet effective, use current plan tier (user keeps premium access)
            const planName = plan?.plan_name || plan?.name || null;
            const status = subscription?.status || 'trial';

            // Check for pending downgrade
            const hasPendingDowngrade = subscription?.pending_plan_id &&
                                       subscription?.pending_change_at &&
                                       new Date() < new Date(subscription.pending_change_at);

            let tier;
            if (hasPendingDowngrade) {
                // User has pending downgrade but hasn't taken effect yet - use current plan tier
                console.log('[SubscriptionService] Pending downgrade detected, using current plan tier until change date');
                tier = this.getSubscriptionTier(planName, status, subscription?.plan_id);
            } else {
                // Normal tier calculation
                tier = this.getSubscriptionTier(planName, status, subscription?.plan_id);
            }

            console.log('[SubscriptionService] Subscription tier calculated:', {
                tier: tier,
                planName: planName,
                status: status,
                hasPendingDowngrade: hasPendingDowngrade,
                pendingChangeAt: subscription?.pending_change_at
            });
            
            const methodElapsed = Date.now() - methodStartTime;
            console.log(`[SubscriptionService] ✅ getCurrentUserSubscription completed successfully in ${methodElapsed}ms`);
            console.log('[SubscriptionService] ========== getCurrentUserSubscription() COMPLETE ==========');
            
            return {
                success: true,
                subscription: subscription,
                plan: plan,
                tier: tier, // Added tier: 'trial', 'basic', or 'premium'
                error: null
            };
        } catch (error) {
            const methodElapsed = Date.now() - methodStartTime;
            console.error(`[SubscriptionService] ❌ Exception getting subscription after ${methodElapsed}ms:`, error);
            console.error('[SubscriptionService] getCurrentUserSubscription - error details:', {
                message: error.message,
                name: error.name,
                stack: error.stack
            });
            const databaseService = this._getDatabaseService();
            console.error('[SubscriptionService] getCurrentUserSubscription - DatabaseService.client state on error:', {
                hasDatabaseService: !!databaseService,
                hasClient: !!databaseService?.client,
                clientType: databaseService?.client?.constructor?.name,
                clientIsNull: databaseService?.client === null,
                clientIsUndefined: databaseService?.client === undefined
            });
            console.error('[SubscriptionService] ========== getCurrentUserSubscription() FAILED ==========');
            
            return {
                success: false,
                subscription: null,
                plan: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Update subscription status
     * In the new schema, status field is the source of truth (synced from Stripe)
     * @param {string} userId - User ID
     * @param {Object} updateData - Data to update
     * @returns {Promise<{success: boolean, subscription: Object|null, error: string|null}>}
     */
    async updateSubscription(userId, updateData) {
        try {
            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }

            console.log('[SubscriptionService] updateSubscription - calling queryUpsert with:', {
                userId: userId,
                updateData: updateData,
                identifier: 'user_id',
                identifierValue: userId
            });

            const result = await window.DatabaseService.queryUpsert('subscriptions', {
                user_id: userId,
                ...updateData
            }, {
                identifier: 'user_id',
                identifierValue: userId
            });

            console.log('[SubscriptionService] updateSubscription - queryUpsert result:', {
                hasData: !!result.data,
                dataLength: Array.isArray(result.data) ? result.data.length : 'N/A',
                hasError: !!result.error,
                errorMessage: result.error?.message
            });

            if (result.error) {
                console.error('[SubscriptionService] Error updating subscription:', result.error);
                console.error('[SubscriptionService] Error details:', {
                    message: result.error.message,
                    code: result.error.code,
                    hint: result.error.hint,
                    details: result.error.details
                });
                return {
                    success: false,
                    subscription: null,
                    error: result.error.message || 'Failed to update subscription'
                };
            }

            const subscription = result.data && result.data.length > 0 ? result.data[0] : null;

            if (!subscription) {
                console.warn('[SubscriptionService] updateSubscription - No subscription returned from queryUpsert');
                // Try to fetch the subscription to verify it was updated
                const databaseService = this._getDatabaseService();
                const tableName = this._getTableName('subscriptions');
                const fetchResult = await databaseService.querySelect(tableName, {
                    filter: { user_id: userId },
                    limit: 1
                });

                if (fetchResult.data && fetchResult.data.length > 0) {
                    console.log('[SubscriptionService] updateSubscription - Subscription found via fetch:', fetchResult.data[0]);
                    return {
                        success: true,
                        subscription: fetchResult.data[0],
                        error: null
                    };
                } else {
                    console.error('[SubscriptionService] updateSubscription - Subscription not found after update');
                    return {
                        success: false,
                        subscription: null,
                        error: 'Subscription not found after update'
                    };
                }
            }

            console.log('[SubscriptionService] ✅ Subscription updated successfully:', {
                planId: subscription.plan_id,
                status: subscription.status
            });

            return {
                success: true,
                subscription: subscription,
                error: null
            };
        } catch (error) {
            console.error('[SubscriptionService] Exception updating subscription:', error);
            return {
                success: false,
                subscription: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Check if trial has expired
     * @param {Object} subscription - Subscription object
     * @returns {boolean} True if trial expired
     */
    isTrialExpired(subscription) {
        if (!subscription || subscription.status !== 'trial') {
            return false;
        }

        if (!subscription.trial_end) {
            return false;
        }

        const trialEnd = new Date(subscription.trial_end);
        const now = new Date();

        return now > trialEnd;
    },

    /**
     * Check if subscription is active (trial or paid)
     * @param {Object} subscription - Subscription object
     * @returns {boolean} True if subscription is active
     */
    isSubscriptionActive(subscription) {
        if (!subscription) {
            return false;
        }

        if (subscription.status === 'active') {
            // Check if current period end is in the future
            if (subscription.current_period_end) {
                const periodEnd = new Date(subscription.current_period_end);
                const now = new Date();
                return now <= periodEnd;
            }
            return true;
        }

        if (subscription.status === 'trial') {
            return !this.isTrialExpired(subscription);
        }

        return false;
    },

    /**
     * Get days remaining in trial
     * @param {Object} subscription - Subscription object
     * @returns {number|null} Days remaining or null if not in trial
     */
    getTrialDaysRemaining(subscription) {
        if (!subscription || subscription.status !== 'trial') {
            return null;
        }

        if (!subscription.trial_end) {
            return null;
        }

        const trialEnd = new Date(subscription.trial_end);
        const now = new Date();

        if (now > trialEnd) {
            return 0;
        }

        const diffTime = trialEnd - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return diffDays;
    },
    
    /**
     * Enable recurring billing for user's subscription
     * @param {string} userId - User ID
     * @returns {Promise<{success: boolean, error: string|null}>}
     */
    async enableRecurringBilling(userId) {
        console.log('[SubscriptionService] ========== enableRecurringBilling() STARTED ==========');
        
        try {
            if (!window.StripeService) {
                throw new Error('StripeService not available');
            }
            
            await window.StripeService.initialize();
            
            // Get backend endpoint from config
            if (typeof ConfigHelper === 'undefined') {
                throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
            }
            const updateEndpoint = ConfigHelper.getBackendEndpoint(this, 'updateSubscription');
            
            const result = await window.StripeService.updateSubscription(
                userId,
                null, // planId
                null, // changeType
                true, // recurringBillingEnabled = true
                updateEndpoint
            );
            
            if (result.success) {
                console.log('[SubscriptionService] ✅ Recurring billing enabled');
                return {
                    success: true,
                    error: null
                };
            } else {
                throw new Error(result.error || 'Failed to enable recurring billing');
            }
        } catch (error) {
            console.error('[SubscriptionService] Error enabling recurring billing:', error);
            return {
                success: false,
                error: error.message || 'Failed to enable recurring billing'
            };
        }
    },
    
    /**
     * Disable recurring billing for user's subscription
     * Subscription will cancel at the end of the current billing period
     * @param {string} userId - User ID
     * @returns {Promise<{success: boolean, error: string|null}>}
     */
    async disableRecurringBilling(userId) {
        console.log('[SubscriptionService] ========== disableRecurringBilling() STARTED ==========');
        
        try {
            if (!window.StripeService) {
                throw new Error('StripeService not available');
            }
            
            await window.StripeService.initialize();
            
            // Get backend endpoint from config
            if (typeof ConfigHelper === 'undefined') {
                throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
            }
            const updateEndpoint = ConfigHelper.getBackendEndpoint(this, 'updateSubscription');
            
            const result = await window.StripeService.updateSubscription(
                userId,
                null, // planId
                null, // changeType
                false, // recurringBillingEnabled = false
                updateEndpoint
            );
            
            if (result.success) {
                console.log('[SubscriptionService] ✅ Recurring billing disabled');
                return {
                    success: true,
                    error: null
                };
            } else {
                throw new Error(result.error || 'Failed to disable recurring billing');
            }
        } catch (error) {
            console.error('[SubscriptionService] Error disabling recurring billing:', error);
            return {
                success: false,
                error: error.message || 'Failed to disable recurring billing'
            };
        }
    },
    
    /**
     * Get days remaining in active subscription
     * @param {Object} subscription - Subscription object
     * @returns {number|null} Days remaining or null if not active or no end date
     */
    getSubscriptionDaysRemaining(subscription) {
        if (!subscription || subscription.status !== 'active') {
            return null;
        }

        if (!subscription.current_period_end) {
            return null;
        }

        const periodEnd = new Date(subscription.current_period_end);
        const now = new Date();

        if (now > periodEnd) {
            return 0;
        }

        const diffTime = periodEnd - now;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        return diffDays;
    },
    
    /**
     * Check if subscription is a trial (free, no payment)
     * In the new schema, status field determines this
     * @param {Object} subscription - Subscription object
     * @returns {boolean} True if subscription is a trial
     */
    isTrialSubscription(subscription) {
        if (!subscription) {
            return false;
        }
        // In new schema: status 'trial' = trial subscription
        if (subscription.status === 'trial') {
            return true;
        }
        return false;
    },

    /**
     * Check if subscription is a paid subscription (requires Stripe payment)
     * In the new schema, active status with Stripe info = paid subscription
     * @param {Object} subscription - Subscription object
     * @returns {boolean} True if subscription is paid
     */
    isPaidSubscription(subscription) {
        if (!subscription) {
            return false;
        }
        // In new schema: status 'active' with Stripe subscription ID = paid subscription
        if (subscription.status === 'active' && subscription.stripe_subscription_id) {
            return true;
        }
        return false;
    },
    
    /**
     * Get subscription type description for display
     * @param {Object} subscription - Subscription object
     * @returns {string} Description of subscription type ('Trial' or 'Paid')
     */
    getSubscriptionTypeDescription(subscription) {
        if (this.isPaidSubscription(subscription)) {
            return 'Paid';
        }
        if (this.isTrialSubscription(subscription)) {
            return 'Trial';
        }
        return 'Unknown';
    }
};

if (typeof window !== 'undefined') {
    window.SubscriptionService = SubscriptionService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SubscriptionService;
}

