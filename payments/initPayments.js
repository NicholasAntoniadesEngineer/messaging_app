/**
 * Payments Module Initialization Script
 * 
 * This script initializes the payments module with the project-specific configuration.
 * Include this script after all payment services are loaded.
 * 
 * For the money_tracker project, this uses MoneyTrackerPaymentsConfig.
 * For other projects, create a similar config file and update the import.
 * 
 * This script creates a global promise that can be awaited by other scripts.
 */

// Create a global promise for initialization
window.PaymentsModuleInitPromise = (async function() {
    console.log('[PaymentsInit] ========== PAYMENTS MODULE INITIALIZATION ==========');
    console.log('[PaymentsInit] Start time:', new Date().toISOString());
    
    try {
        // Wait for required dependencies
        console.log('[PaymentsInit] Step 1: Waiting for config dependencies...');
        let waitCount = 0;
        const maxWait = 50; // 5 seconds
        
        while ((typeof PaymentsConfigBase === 'undefined' || 
                typeof MoneyTrackerPaymentsConfig === 'undefined' ||
                typeof PaymentsModule === 'undefined') && 
               waitCount < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
            waitCount++;
            if (waitCount % 10 === 0) {
                console.log('[PaymentsInit] Still waiting for dependencies...', {
                    waitCount,
                    hasPaymentsConfigBase: typeof PaymentsConfigBase !== 'undefined',
                    hasMoneyTrackerConfig: typeof MoneyTrackerPaymentsConfig !== 'undefined',
                    hasPaymentsModule: typeof PaymentsModule !== 'undefined'
                });
            }
        }
        
        console.log('[PaymentsInit] Dependency check complete after', waitCount * 100, 'ms');
        console.log('[PaymentsInit] Dependencies status:', {
            hasPaymentsConfigBase: typeof PaymentsConfigBase !== 'undefined',
            hasMoneyTrackerConfig: typeof MoneyTrackerPaymentsConfig !== 'undefined',
            hasPaymentsModule: typeof PaymentsModule !== 'undefined'
        });
        
        if (typeof PaymentsConfigBase === 'undefined') {
            console.error('[PaymentsInit] ❌ PaymentsConfigBase not found after', waitCount * 100, 'ms');
            throw new Error('PaymentsConfigBase not found');
        }
        console.log('[PaymentsInit] ✅ PaymentsConfigBase found');
        
        if (typeof MoneyTrackerPaymentsConfig === 'undefined') {
            console.error('[PaymentsInit] ❌ MoneyTrackerPaymentsConfig not found after', waitCount * 100, 'ms');
            throw new Error('MoneyTrackerPaymentsConfig not found');
        }
        console.log('[PaymentsInit] ✅ MoneyTrackerPaymentsConfig found');
        console.log('[PaymentsInit] MoneyTrackerPaymentsConfig details:', {
            hasServices: !!MoneyTrackerPaymentsConfig.services,
            hasStripe: !!MoneyTrackerPaymentsConfig.stripe,
            hasBackend: !!MoneyTrackerPaymentsConfig.backend,
            hasValidate: typeof MoneyTrackerPaymentsConfig.validate === 'function'
        });
        
        if (typeof PaymentsModule === 'undefined') {
            console.error('[PaymentsInit] ❌ PaymentsModule not found after', waitCount * 100, 'ms');
            throw new Error('PaymentsModule not found');
        }
        console.log('[PaymentsInit] ✅ PaymentsModule found');
        console.log('[PaymentsInit] PaymentsModule details:', {
            version: PaymentsModule.VERSION,
            hasInitialize: typeof PaymentsModule.initialize === 'function',
            initialized: PaymentsModule.initialized
        });
        
        // Wait for services to be loaded
        console.log('[PaymentsInit] Step 2: Waiting for payment services to load...');
        let serviceWaitCount = 0;
        const maxServiceWait = 50; // 5 seconds
        while ((!window.StripeService || !window.PaymentService || !window.SubscriptionService) && serviceWaitCount < maxServiceWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
            serviceWaitCount++;
            if (serviceWaitCount % 10 === 0) {
                console.log('[PaymentsInit] Still waiting for services...', {
                    serviceWaitCount,
                    hasStripeService: !!window.StripeService,
                    hasPaymentService: !!window.PaymentService,
                    hasSubscriptionService: !!window.SubscriptionService
                });
            }
        }
        
        console.log('[PaymentsInit] Service wait complete after', serviceWaitCount * 100, 'ms');
        console.log('[PaymentsInit] Services status:', {
            hasStripeService: !!window.StripeService,
            hasPaymentService: !!window.PaymentService,
            hasSubscriptionService: !!window.SubscriptionService,
            stripeServiceType: typeof window.StripeService,
            paymentServiceType: typeof window.PaymentService,
            subscriptionServiceType: typeof window.SubscriptionService
        });
        
        if (!window.StripeService || !window.PaymentService || !window.SubscriptionService) {
            console.error('[PaymentsInit] ❌ Services not loaded after waiting', serviceWaitCount * 100, 'ms');
            console.error('[PaymentsInit] Missing services:', {
                missingStripeService: !window.StripeService,
                missingPaymentService: !window.PaymentService,
                missingSubscriptionService: !window.SubscriptionService
            });
            throw new Error('Payment services not loaded');
        }
        console.log('[PaymentsInit] ✅ All payment services loaded');
        
        // Wait for DatabaseService and AuthService
        console.log('[PaymentsInit] Step 3: Checking for DatabaseService and AuthService...');
        console.log('[PaymentsInit] Window services check:', {
            hasDatabaseService: !!window.DatabaseService,
            hasAuthService: !!window.AuthService,
            databaseServiceType: typeof window.DatabaseService,
            authServiceType: typeof window.AuthService
        });
        
        if (!window.DatabaseService) {
            console.warn('[PaymentsInit] ⚠️ window.DatabaseService not found - will fail validation');
        } else {
            console.log('[PaymentsInit] ✅ window.DatabaseService found');
        }
        
        if (!window.AuthService) {
            console.warn('[PaymentsInit] ⚠️ window.AuthService not found - will fail validation');
        } else {
            console.log('[PaymentsInit] ✅ window.AuthService found');
        }
        
        // Initialize the module
        console.log('[PaymentsInit] Step 4: Calling PaymentsModule.initialize()...');
        console.log('[PaymentsInit] Passing config:', {
            configType: typeof MoneyTrackerPaymentsConfig,
            hasServices: !!MoneyTrackerPaymentsConfig.services,
            servicesState: {
                database: !!MoneyTrackerPaymentsConfig.services?.database,
                auth: !!MoneyTrackerPaymentsConfig.services?.auth
            }
        });
        
        const result = await PaymentsModule.initialize(MoneyTrackerPaymentsConfig);
        
        console.log('[PaymentsInit] Initialize result received:', {
            success: result.success,
            hasError: !!result.error,
            error: result.error
        });
        
        if (result.success) {
            console.log('[PaymentsInit] ========== PAYMENTS MODULE INITIALIZED SUCCESSFULLY ==========');
            console.log('[PaymentsInit] End time:', new Date().toISOString());
            return { success: true };
        } else {
            console.error('[PaymentsInit] ========== PAYMENTS MODULE INITIALIZATION FAILED ==========');
            console.error('[PaymentsInit] Error:', result.error);
            console.error('[PaymentsInit] End time:', new Date().toISOString());
            throw new Error(result.error || 'Payments module initialization failed');
        }
    } catch (error) {
        console.error('[PaymentsInit] ========== PAYMENTS MODULE INITIALIZATION ERROR ==========');
        console.error('[PaymentsInit] Exception type:', error?.constructor?.name);
        console.error('[PaymentsInit] Exception message:', error?.message);
        console.error('[PaymentsInit] Exception stack:', error?.stack);
        console.error('[PaymentsInit] End time:', new Date().toISOString());
        throw error;
    }
})();

// Also set a flag when complete
window.PaymentsModuleInitPromise.then(() => {
    window.PaymentsModuleInitialized = true;
    console.log('[PaymentsInit] PaymentsModuleInitialized flag set to true');
}).catch(() => {
    window.PaymentsModuleInitialized = false;
    console.error('[PaymentsInit] PaymentsModuleInitialized flag set to false due to error');
});


