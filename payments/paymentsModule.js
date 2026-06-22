/**
 * Payments Module Initializer
 * 
 * This module initializes and configures all payment services with the provided configuration.
 * It acts as a dependency injection container for the payments module.
 * 
 * The module maintains backward compatibility - if not initialized, services will work
 * with their default window-based dependencies.
 * 
 * USAGE:
 * ```javascript
 * // For new projects with config:
 * await PaymentsModule.initialize(MoneyTrackerPaymentsConfig);
 * 
 * // Services will automatically use config if available, or fall back to window objects
 * ```
 */

const PaymentsModule = {
    VERSION: '1.0.0',
    config: null,
    initialized: false,
    
    /**
     * Services container
     * All initialized services are stored here
     */
    services: {
        stripe: null,
        payment: null,
        subscription: null
    },
    
    /**
     * Initialize the payments module with a configuration
     * This injects the config into all services so they can use it
     * @param {Object} config - Configuration object (should extend PaymentsConfigBase)
     * @returns {Promise<{success: boolean, error: string|null}>}
     */
    async initialize(config) {
        console.log('[PaymentsModule] ========== INITIALIZATION STARTED ==========');
        console.log('[PaymentsModule] Version:', this.VERSION);
        console.log('[PaymentsModule] Config received:', {
            hasConfig: !!config,
            configType: typeof config,
            hasServices: !!config?.services,
            hasStripe: !!config?.stripe,
            hasBackend: !!config?.backend,
            hasValidate: typeof config?.validate === 'function'
        });
        
        try {
            // Validate configuration
            if (!config) {
                console.error('[PaymentsModule] ❌ Configuration is null or undefined');
                throw new Error('Configuration is required');
            }
            
            console.log('[PaymentsModule] Step 1: Checking initial service state...');
            console.log('[PaymentsModule] Initial services state:', {
                hasDatabaseInConfig: !!config.services?.database,
                hasAuthInConfig: !!config.services?.auth,
                databaseType: typeof config.services?.database,
                authType: typeof config.services?.auth
            });
            
            // Inject services into config BEFORE validation (for money_tracker compatibility)
            // In new projects, services should be provided directly in the config
            console.log('[PaymentsModule] Step 2: Injecting services from window (if available)...');
            console.log('[PaymentsModule] Window services check:', {
                hasWindow: typeof window !== 'undefined',
                hasWindowDatabaseService: typeof window !== 'undefined' && !!window.DatabaseService,
                hasWindowAuthService: typeof window !== 'undefined' && !!window.AuthService,
                windowDatabaseServiceType: typeof window !== 'undefined' ? typeof window.DatabaseService : 'N/A',
                windowAuthServiceType: typeof window !== 'undefined' ? typeof window.AuthService : 'N/A'
            });
            
            if (!config.services.database && typeof window !== 'undefined' && window.DatabaseService) {
                config.services.database = window.DatabaseService;
                console.log('[PaymentsModule] ✅ Injected window.DatabaseService into config');
                console.log('[PaymentsModule] DatabaseService details:', {
                    type: typeof window.DatabaseService,
                    hasInitialize: typeof window.DatabaseService?.initialize === 'function',
                    hasQuerySelect: typeof window.DatabaseService?.querySelect === 'function'
                });
            } else {
                console.log('[PaymentsModule] ⚠️ DatabaseService not injected:', {
                    alreadyInConfig: !!config.services.database,
                    windowAvailable: typeof window !== 'undefined',
                    windowHasService: typeof window !== 'undefined' && !!window.DatabaseService
                });
            }

            if (!config.services.auth && typeof window !== 'undefined' && window.AuthService) {
                config.services.auth = window.AuthService;
                console.log('[PaymentsModule] ✅ Injected window.AuthService into config');
                console.log('[PaymentsModule] AuthService details:', {
                    type: typeof window.AuthService,
                    hasInitialize: typeof window.AuthService?.initialize === 'function',
                    hasIsAuthenticated: typeof window.AuthService?.isAuthenticated === 'function',
                    hasGetCurrentUser: typeof window.AuthService?.getCurrentUser === 'function'
                });
            } else {
                console.log('[PaymentsModule] ⚠️ AuthService not injected:', {
                    alreadyInConfig: !!config.services.auth,
                    windowAvailable: typeof window !== 'undefined',
                    windowHasService: typeof window !== 'undefined' && !!window.AuthService
                });
            }
            
            console.log('[PaymentsModule] Step 3: Services state after injection:', {
                hasDatabase: !!config.services.database,
                hasAuth: !!config.services.auth,
                databaseType: typeof config.services.database,
                authType: typeof config.services.auth
            });
            
            // Now validate configuration (after services are injected)
            console.log('[PaymentsModule] Step 4: Validating configuration...');
            console.log('[PaymentsModule] Validation method check:', {
                hasValidate: typeof config.validate === 'function',
                validateType: typeof config.validate
            });
            
            if (typeof config.validate !== 'function') {
                console.error('[PaymentsModule] ❌ config.validate is not a function:', typeof config.validate);
                throw new Error('Configuration object does not have a validate() method. Ensure PaymentsConfigBase.merge() was used correctly.');
            }
            
            const validation = config.validate();
            console.log('[PaymentsModule] Validation result:', {
                valid: validation.valid,
                errorCount: validation.errors?.length || 0,
                errors: validation.errors || []
            });
            
            if (!validation.valid) {
                console.error('[PaymentsModule] ❌ Configuration validation failed');
                console.error('[PaymentsModule] Validation errors:', validation.errors);
                throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
            }
            
            console.log('[PaymentsModule] ✅ Configuration validation passed');
            
            // Validate services are available
            console.log('[PaymentsModule] Step 5: Final service availability check...');
            if (!config.services.database) {
                console.error('[PaymentsModule] ❌ Database service is missing');
                throw new Error('Database service is required. Provide via config.services.database or ensure window.DatabaseService is available.');
            }
            console.log('[PaymentsModule] ✅ Database service available');
            
            if (!config.services.auth) {
                console.error('[PaymentsModule] ❌ Auth service is missing');
                throw new Error('Auth service is required. Provide via config.services.auth or ensure window.AuthService is available.');
            }
            console.log('[PaymentsModule] ✅ Auth service available');
            
            // Store configuration
            console.log('[PaymentsModule] Step 6: Storing config and injecting into services...');
            this.config = config;
            console.log('[PaymentsModule] Config stored in PaymentsModule');

            // Get services from window (they should already be loaded)
            console.log('[PaymentsModule] Step 7: Injecting config into payment services...');
            console.log('[PaymentsModule] Available window services:', {
                hasStripeService: !!window.StripeService,
                hasPaymentService: !!window.PaymentService,
                hasSubscriptionService: !!window.SubscriptionService
            });
            
            if (typeof window !== 'undefined') {
                // Inject config into services
                if (window.StripeService) {
                    this.services.stripe = window.StripeService;
                    window.StripeService._config = config;
                    console.log('[PaymentsModule] ✅ StripeService configured with config');
                    console.log('[PaymentsModule] StripeService details:', {
                        hasConfig: !!window.StripeService._config,
                        hasCreateCheckoutSession: typeof window.StripeService.createCheckoutSession === 'function',
                        hasListInvoices: typeof window.StripeService.listInvoices === 'function'
                    });
                } else {
                    console.warn('[PaymentsModule] ⚠️ StripeService not found in window');
                }
                
                if (window.PaymentService) {
                    this.services.payment = window.PaymentService;
                    window.PaymentService._config = config;
                    console.log('[PaymentsModule] ✅ PaymentService configured with config');
                    console.log('[PaymentsModule] PaymentService details:', {
                        hasConfig: !!window.PaymentService._config,
                        hasRecordPayment: typeof window.PaymentService.recordPayment === 'function'
                    });
                } else {
                    console.warn('[PaymentsModule] ⚠️ PaymentService not found in window');
                }
                
                if (window.SubscriptionService) {
                    this.services.subscription = window.SubscriptionService;
                    window.SubscriptionService._config = config;
                    console.log('[PaymentsModule] ✅ SubscriptionService configured with config');
                    console.log('[PaymentsModule] SubscriptionService details:', {
                        hasConfig: !!window.SubscriptionService._config,
                        hasGetCurrentUserSubscription: typeof window.SubscriptionService.getCurrentUserSubscription === 'function'
                    });
                } else {
                    console.warn('[PaymentsModule] ⚠️ SubscriptionService not found in window');
                }
                
                // Store module reference
                window.PaymentsModule = this;
                console.log('[PaymentsModule] ✅ PaymentsModule stored in window');
            }
            
            this.initialized = true;
            console.log('[PaymentsModule] ========== INITIALIZATION SUCCESSFUL ==========');
            console.log('[PaymentsModule] Final state:', {
                initialized: this.initialized,
                hasConfig: !!this.config,
                servicesConfigured: {
                    stripe: !!this.services.stripe,
                    payment: !!this.services.payment,
                    subscription: !!this.services.subscription
                }
            });
            
            return {
                success: true,
                error: null
            };
        } catch (error) {
            console.error('[PaymentsModule] ========== INITIALIZATION FAILED ==========');
            console.error('[PaymentsModule] Error:', error);
            return {
                success: false,
                error: error.message || 'Unknown error during initialization'
            };
        }
    },
    
    /**
     * Get a service by name
     * @param {string} serviceName - Name of the service ('stripe', 'payment', 'subscription')
     * @returns {Object|null} Service instance or null if not found
     */
    getService(serviceName) {
        if (typeof window !== 'undefined') {
            // Return from window if available (works even if not initialized)
            if (serviceName === 'stripe' && window.StripeService) {
                return window.StripeService;
            }
            if (serviceName === 'payment' && window.PaymentService) {
                return window.PaymentService;
            }
            if (serviceName === 'subscription' && window.SubscriptionService) {
                return window.SubscriptionService;
            }
        }
        
        return this.services[serviceName] || null;
    },
    
    /**
     * Get the current configuration
     * @returns {Object|null} Current configuration or null if not initialized
     */
    getConfig() {
        return this.config;
    },
    
    /**
     * Check if module is initialized
     * @returns {boolean} True if initialized
     */
    isInitialized() {
        return this.initialized;
    }
};

if (typeof window !== 'undefined') {
    window.PaymentsModule = PaymentsModule;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PaymentsModule;
}

