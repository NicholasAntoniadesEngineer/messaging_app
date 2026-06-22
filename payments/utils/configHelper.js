/**
 * Configuration Helper Utility
 * Provides helper functions for services to access configuration
 * Configuration is required - services must be initialized with PaymentsModule.initialize()
 */

const ConfigHelper = {
    /**
     * Get configuration from service's _config property or PaymentsModule
     * @param {Object} serviceInstance - Service instance (should have _config property)
     * @returns {Object} Configuration object
     * @throws {Error} If configuration is not available
     */
    getConfig(serviceInstance) {
        // Try service's own config first
        if (serviceInstance && serviceInstance._config) {
            return serviceInstance._config;
        }
        
        // Try PaymentsModule config
        if (typeof window !== 'undefined' && window.PaymentsModule && window.PaymentsModule.getConfig) {
            const config = window.PaymentsModule.getConfig();
            if (config) {
                return config;
            }
        }
        
        throw new Error('Payments module not initialized. Call PaymentsModule.initialize(config) before using services.');
    },
    
    /**
     * Get database service
     * @param {Object} serviceInstance - Service instance
     * @returns {Object} Database service
     * @throws {Error} If database service is not available in config
     */
    getDatabaseService(serviceInstance) {
        const config = this.getConfig(serviceInstance);
        if (!config || !config.services || !config.services.database) {
            throw new Error('Database service not configured. Provide database service in config.services.database');
        }
        return config.services.database;
    },
    
    /**
     * Get auth service
     * @param {Object} serviceInstance - Service instance
     * @returns {Object} Auth service
     * @throws {Error} If auth service is not available in config
     */
    getAuthService(serviceInstance) {
        const config = this.getConfig(serviceInstance);
        if (!config || !config.services || !config.services.auth) {
            throw new Error('Auth service not configured. Provide auth service in config.services.auth');
        }
        return config.services.auth;
    },
    
    /**
     * Get Stripe publishable key
     * @param {Object} serviceInstance - Service instance
     * @returns {string} Publishable key
     * @throws {Error} If publishable key is not available in config
     */
    getStripePublishableKey(serviceInstance) {
        const config = this.getConfig(serviceInstance);
        if (!config || !config.stripe || !config.stripe.publishableKey) {
            throw new Error('Stripe publishable key not configured. Provide publishable key in config.stripe.publishableKey');
        }
        return config.stripe.publishableKey;
    },
    
    /**
     * Get backend endpoint URL
     * @param {Object} serviceInstance - Service instance
     * @param {string} endpointName - Name of the endpoint (e.g., 'createCheckoutSession')
     * @returns {string} Full endpoint URL
     * @throws {Error} If endpoint is not configured
     */
    getBackendEndpoint(serviceInstance, endpointName) {
        const config = this.getConfig(serviceInstance);
        if (!config || !config.backend || !config.backend.baseUrl) {
            throw new Error('Backend base URL not configured. Provide baseUrl in config.backend.baseUrl');
        }
        
        const baseUrl = config.backend.baseUrl;
        const endpointPath = config.backend.endpoints && config.backend.endpoints[endpointName];
        
        if (!endpointPath) {
            throw new Error(`Backend endpoint '${endpointName}' not configured. Provide endpoint path in config.backend.endpoints.${endpointName}`);
        }
        
        return `${baseUrl}${endpointPath}`;
    },
    
    /**
     * Get authorization headers for backend requests
     * @param {Object} serviceInstance - Service instance
     * @returns {Promise<Object>} Headers object
     */
    async getAuthHeaders(serviceInstance) {
        const config = this.getConfig(serviceInstance);
        
        // Try custom getAuthHeaders function from config
        if (config.backend && config.backend.getAuthHeaders) {
            const headers = await config.backend.getAuthHeaders();
            if (headers) {
                return headers;
            }
        }
        
        // Default: get from auth service
        const authService = this.getAuthService(serviceInstance);
        const headers = {
            'Content-Type': 'application/json'
        };
        
        if (authService.isAuthenticated && authService.isAuthenticated()) {
            if (authService.getAccessToken) {
                const token = authService.getAccessToken();
                if (token) {
                    headers['Authorization'] = `Bearer ${token}`;
                }
            }
        }
        
        return headers;
    },
    
    /**
     * Get table name
     * @param {Object} serviceInstance - Service instance
     * @param {string} tableKey - Key for the table (e.g., 'subscriptions', 'subscriptionPlans', 'paymentHistory')
     * @returns {string} Table name
     * @throws {Error} If table name is not configured
     */
    getTableName(serviceInstance, tableKey) {
        const config = this.getConfig(serviceInstance);
        if (!config || !config.tables || !config.tables[tableKey]) {
            throw new Error(`Table name '${tableKey}' not configured. Provide table name in config.tables.${tableKey}`);
        }
        return config.tables[tableKey];
    },
    
    /**
     * Get subscription configuration
     * @param {Object} serviceInstance - Service instance
     * @returns {Object} Subscription config
     * @throws {Error} If subscription config is not available
     */
    getSubscriptionConfig(serviceInstance) {
        const config = this.getConfig(serviceInstance);
        if (!config || !config.subscription) {
            throw new Error('Subscription configuration not available. Provide subscription config in config.subscription');
        }
        return config.subscription;
    },
    
    /**
     * Get application configuration
     * @param {Object} serviceInstance - Service instance
     * @returns {Object} Application config
     * @throws {Error} If application config is not available
     */
    getApplicationConfig(serviceInstance) {
        const config = this.getConfig(serviceInstance);
        if (!config || !config.application) {
            throw new Error('Application configuration not available. Provide application config in config.application');
        }
        return config.application;
    },
    
    /**
     * Check if verbose logging is enabled
     * @param {Object} serviceInstance - Service instance
     * @returns {boolean} True if verbose logging is enabled
     */
    isVerboseLogging(serviceInstance) {
        const config = this.getConfig(serviceInstance);
        return config.logging && config.logging.verbose === true;
    },
    
    /**
     * Get log prefix
     * @param {Object} serviceInstance - Service instance
     * @returns {string} Log prefix
     */
    getLogPrefix(serviceInstance) {
        const config = this.getConfig(serviceInstance);
        return (config.logging && config.logging.prefix) || '[Payments]';
    }
};

if (typeof window !== 'undefined') {
    window.ConfigHelper = ConfigHelper;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ConfigHelper;
}

