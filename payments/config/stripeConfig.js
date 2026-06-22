/**
 * Stripe Configuration
 * Centralized configuration for Stripe payment integration
 * Note: Secret key should be server-side only in production
 */

const StripeConfig = {
    PUBLISHABLE_KEY: 'pk_test_51QAQyCClUqvgxZvpgpfE0qWj3sOl3FbVBEhGS1uLOWdl8zyMK2z3LWGijvw0y4cn04EvydDqdK26VD7tcy1Qx1q40073PZrcmn',
    // SECRET_KEY and RESTRICTED_KEY not on client side for security
    // These keys should ONLY be used in server-side Edge Functions via environment variables
    // Never expose secret keys (sk_...) or restricted keys (rk_...) in client-side code
    
    SUBSCRIPTION_PRICE_AMOUNT: 500, // 5 EUR in cents
    SUBSCRIPTION_PRICE_CURRENCY: 'eur',
    TRIAL_PERIOD_DAYS: 30,
    CHECKOUT_SUCCESS_URL: null, // Set dynamically based on current page
    CHECKOUT_CANCEL_URL: null, // Set dynamically based on current page
    
    /**
     * Get Stripe publishable key
     * @returns {string} Stripe publishable key
     */
    getPublishableKey() {
        return this.PUBLISHABLE_KEY;
    },
    
    /**
     * Get subscription price amount in cents
     * @returns {number} Price in cents
     */
    getSubscriptionPriceAmount() {
        return this.SUBSCRIPTION_PRICE_AMOUNT;
    },
    
    /**
     * Get subscription price currency
     * @returns {string} Currency code
     */
    getSubscriptionPriceCurrency() {
        return this.SUBSCRIPTION_PRICE_CURRENCY;
    },
    
    /**
     * Get trial period in days
     * @returns {number} Trial period days
     */
    getTrialPeriodDays() {
        return this.TRIAL_PERIOD_DAYS;
    },
    
    /**
     * Get restricted key (for server-side use only)
     * Note: Secret keys are no longer stored in this file for security.
     * Use environment variables in Edge Functions instead.
     * @returns {string} Empty string - keys must be set in Edge Function environment variables
     */
    getRestrictedKey() {
        console.warn('[StripeConfig] getRestrictedKey() called - secret keys should be in Edge Function environment variables, not client code');
        return '';
    },
    
    /**
     * Get secret key (for server-side use only)
     * Note: Secret keys are no longer stored in this file for security.
     * Use environment variables in Edge Functions instead.
     * @returns {string} Empty string - keys must be set in Edge Function environment variables
     */
    getSecretKey() {
        console.warn('[StripeConfig] getSecretKey() called - secret keys should be in Edge Function environment variables, not client code');
        return '';
    }
};

if (typeof window !== 'undefined') {
    window.StripeConfig = StripeConfig;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = StripeConfig;
}

