/**
 * Utility to wait for payments module initialization
 * Use this in any script that needs to use payment services
 * 
 * Usage:
 *   await waitForPaymentsInit();
 *   // Now safe to use payment services
 */

async function waitForPaymentsInit() {
    // If already initialized, return immediately
    if (window.PaymentsModule && window.PaymentsModule.isInitialized()) {
        return;
    }
    
    // If initialization promise exists, wait for it
    if (window.PaymentsModuleInitPromise) {
        try {
            await window.PaymentsModuleInitPromise;
            return;
        } catch (error) {
            console.error('[waitForPaymentsInit] Payments module initialization failed:', error);
            throw new Error('Payments module initialization failed: ' + error.message);
        }
    }
    
    // If PaymentsModule exists but not initialized, wait for it
    if (window.PaymentsModule) {
        let waitCount = 0;
        const maxWait = 50; // 5 seconds
        while (!window.PaymentsModule.isInitialized() && waitCount < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 100));
            waitCount++;
        }
        
        if (!window.PaymentsModule.isInitialized()) {
            throw new Error('Payments module not initialized after waiting');
        }
        return;
    }
    
    // No PaymentsModule at all - this shouldn't happen if scripts are loaded correctly
    throw new Error('PaymentsModule not found. Ensure payments config files are loaded.');
}

if (typeof window !== 'undefined') {
    window.waitForPaymentsInit = waitForPaymentsInit;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = waitForPaymentsInit;
}

