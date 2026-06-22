/**
 * Payments Module Base Configuration
 * This is the base configuration structure that all payment implementations must follow.
 * Project-specific configurations should extend or merge with this structure.
 * 
 * This configuration system allows the payments module to be reused across different projects
 * by providing a standardized interface for all dependencies and settings.
 */

const PaymentsConfigBase = {
    /**
     * Version of the config system
     */
    VERSION: '1.0.0',
    
    /**
     * Service Dependencies
     * These are the services that the payments module depends on.
     * They should be provided by the host application.
     */
    services: {
        /**
         * Database Service
         * Must provide:
         * - querySelect(table, options)
         * - queryInsert(table, data)
         * - queryUpdate(table, id, data)
         * - queryUpsert(table, data, options)
         * - _getCurrentUserId()
         */
        database: null,
        
        /**
         * Authentication Service
         * Must provide:
         * - isAuthenticated()
         * - getCurrentUser()
         * - getSession()
         * - getAccessToken()
         * - validateSession()
         */
        auth: null
    },
    
    /**
     * Stripe Configuration
     */
    stripe: {
        /**
         * Stripe publishable key (pk_...)
         * This is safe to expose in client-side code
         */
        publishableKey: null,
        
        /**
         * Stripe.js library loader
         * Function that returns a promise resolving to the Stripe object
         * If null, assumes Stripe is already loaded on window.Stripe
         */
        stripeJsLoader: null
    },
    
    /**
     * Backend Configuration
     */
    backend: {
        /**
         * Base URL for backend API endpoints
         * Example: 'https://your-project.supabase.co'
         */
        baseUrl: null,
        
        /**
         * Endpoint paths (relative to baseUrl)
         */
        endpoints: {
            createCheckoutSession: '/functions/v1/create-checkout-session',
            createPortalSession: '/functions/v1/create-portal-session',
            createCustomer: '/functions/v1/create-customer',
            updateSubscription: '/functions/v1/update-subscription',
            listInvoices: '/functions/v1/list-invoices',
            stripeWebhook: '/functions/v1/stripe-webhook'
        },
        
        /**
         * Function to get authorization headers for backend requests
         * Should return an object with headers (e.g., { 'Authorization': 'Bearer ...' })
         * If null, will attempt to get token from auth service
         */
        getAuthHeaders: null
    },
    
    /**
     * Database Table Names
     */
    tables: {
        subscriptions: 'subscriptions',
        subscriptionPlans: 'subscription_plans',
        paymentHistory: 'payment_history'
    },
    
    /**
     * Subscription Configuration
     */
    subscription: {
        /**
         * Default trial period in days
         */
        defaultTrialPeriodDays: 30,
        
        /**
         * Tier mapping configuration
         * Maps plan names to subscription tiers
         */
        tierMapping: {
            'trial': 'trial',
            'Free': 'basic',
            'Monthly Subscription': 'basic',
            'Basic Subscription': 'basic',
            'Premium': 'premium',
            'Premium Subscription': 'premium'
        },
        
        /**
         * Tier hierarchy for access checking
         */
        tierHierarchy: {
            'trial': 0,
            'basic': 1,
            'premium': 2
        }
    },
    
    /**
     * Application-specific Configuration
     */
    application: {
        /**
         * Application name (for display in Stripe checkout)
         */
        name: 'Application',
        
        /**
         * Default currency
         */
        currency: 'eur',
        
        /**
         * Default subscription interval
         */
        interval: 'month',
        
        /**
         * URL builder function for success/cancel redirects
         * @param {string} baseUrl - Current page URL
         * @param {string} status - 'success' or 'cancelled'
         * @returns {string} Redirect URL
         */
        buildRedirectUrl: null
    },
    
    /**
     * Logging Configuration
     */
    logging: {
        /**
         * Enable verbose logging
         */
        verbose: false,
        
        /**
         * Log prefix for all payment module logs
         */
        prefix: '[Payments]'
    },
    
    /**
     * Validation
     * Validates that all required configuration is present
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    validate() {
        const errors = [];
        
        if (!this.services.database) {
            errors.push('services.database is required');
        }
        
        if (!this.services.auth) {
            errors.push('services.auth is required');
        }
        
        if (!this.stripe.publishableKey) {
            errors.push('stripe.publishableKey is required');
        }
        
        if (!this.backend.baseUrl) {
            errors.push('backend.baseUrl is required');
        }
        
        if (!this.tables.subscriptions) {
            errors.push('tables.subscriptions is required');
        }
        
        if (!this.tables.subscriptionPlans) {
            errors.push('tables.subscriptionPlans is required');
        }
        
        if (!this.tables.paymentHistory) {
            errors.push('tables.paymentHistory is required');
        }
        
        return {
            valid: errors.length === 0,
            errors: errors
        };
    },
    
    /**
     * Merge with another configuration object
     * @param {Object} config - Configuration to merge
     * @returns {Object} Merged configuration
     */
    merge(config) {
        // Store methods before cloning
        const validateMethod = this.validate;
        const mergeMethod = this.merge;
        
        // Create a new object, copying all data properties
        const merged = {};
        
        // Copy all data properties (not methods)
        merged.services = { ...this.services };
        merged.stripe = { ...this.stripe };
        merged.backend = {
            ...this.backend,
            endpoints: { ...this.backend.endpoints }
        };
        merged.tables = { ...this.tables };
        merged.subscription = {
            ...this.subscription,
            tierMapping: { ...this.subscription.tierMapping },
            tierHierarchy: { ...this.subscription.tierHierarchy }
        };
        merged.application = { ...this.application };
        merged.logging = { ...this.logging };
        
        // Merge config properties
        if (config.services) {
            merged.services = { ...merged.services, ...config.services };
        }
        
        if (config.stripe) {
            merged.stripe = { ...merged.stripe, ...config.stripe };
        }
        
        if (config.backend) {
            merged.backend = {
                ...merged.backend,
                ...config.backend,
                endpoints: { ...merged.backend.endpoints, ...(config.backend.endpoints || {}) }
            };
        }
        
        if (config.tables) {
            merged.tables = { ...merged.tables, ...config.tables };
        }
        
        if (config.subscription) {
            merged.subscription = {
                ...merged.subscription,
                ...config.subscription,
                tierMapping: { ...merged.subscription.tierMapping, ...(config.subscription.tierMapping || {}) },
                tierHierarchy: { ...merged.subscription.tierHierarchy, ...(config.subscription.tierHierarchy || {}) }
            };
        }
        
        if (config.application) {
            merged.application = { ...merged.application, ...config.application };
        }
        
        if (config.logging) {
            merged.logging = { ...merged.logging, ...config.logging };
        }
        
        // Add methods to the merged object, bound to it
        if (typeof validateMethod === 'function') {
            merged.validate = function() {
                return validateMethod.call(merged);
            };
        } else {
            throw new Error('validate method not found on PaymentsConfigBase');
        }
        
        if (typeof mergeMethod === 'function') {
            merged.merge = function(newConfig) {
                return mergeMethod.call(merged, newConfig);
            };
        } else {
            throw new Error('merge method not found on PaymentsConfigBase');
        }
        
        return merged;
    }
};

if (typeof window !== 'undefined') {
    window.PaymentsConfigBase = PaymentsConfigBase;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PaymentsConfigBase;
}


