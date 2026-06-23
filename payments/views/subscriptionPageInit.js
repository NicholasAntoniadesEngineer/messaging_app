// Subscription page bootstrap + script-load diagnostics.
// H-5: externalized from subscription.html inline <script> so script-src can drop
// 'unsafe-inline'. Loaded with `defer`; self-guards for the case where
// DOMContentLoaded has already fired by the time this script runs.
// The original ran at parse time (no DOMContentLoaded wrapper); deferring keeps
// it after the synchronous controller <script src> tags, preserving order.

function runSubscriptionInit() {
    // Verify all required services are loaded
    console.log('[subscription.html] Checking required services after script load...');
    console.log('[subscription.html] Services check:', {
        hasSupabaseConfig: !!window.SupabaseConfig,
        hasAuthService: !!window.AuthService,
        hasDatabaseService: !!window.DatabaseService,
        hasSubscriptionService: !!window.SubscriptionService,
        hasStripeService: !!window.StripeService,
        hasStripeConfig: !!window.StripeConfig,
        hasHeader: !!window.Header,
        hasUpgradeController: !!window.UpgradeController
    });

    // Check for script loading errors
    window.addEventListener('error', function(e) {
        console.log('[subscription.html] Global error event:', {
            message: e.message,
            filename: e.filename,
            lineno: e.lineno,
            colno: e.colno,
            error: e.error,
            isStripeService: e.filename && e.filename.includes('StripeService')
        });
        if (e.filename && e.filename.includes('StripeService')) {
            console.error('[subscription.html] ⚠️ StripeService script loading error detected:', {
                message: e.message,
                filename: e.filename,
                lineno: e.lineno,
                colno: e.colno,
                error: e.error
            });
        }
    }, true);

    // Check for resource loading errors (network errors)
    window.addEventListener('error', function(e) {
        const target = e.target;
        if (target && target.tagName === 'SCRIPT' && target.src && target.src.includes('StripeService')) {
            console.error('[subscription.html] ⚠️ StripeService script resource loading error:', {
                src: target.src,
                error: e.error,
                type: target.type
            });
        }
    }, true);

    // Verify script tags after a delay
    setTimeout(function() {
        const stripeServiceScript = document.querySelector('script[src*="StripeService"]');
        if (stripeServiceScript) {
            console.log('[subscription.html] StripeService script tag found:', {
                src: stripeServiceScript.src,
                async: stripeServiceScript.async,
                defer: stripeServiceScript.defer,
                type: stripeServiceScript.type
            });

            // Try to manually check if script loaded
            stripeServiceScript.addEventListener('load', function() {
                console.log('[subscription.html] ✅ StripeService script load event fired');
                console.log('[subscription.html] StripeService available after load event:', !!window.StripeService);
            });

            stripeServiceScript.addEventListener('error', function(e) {
                console.error('[subscription.html] ❌ StripeService script error event fired:', e);
            });
        } else {
            console.error('[subscription.html] ❌ StripeService script tag not found in DOM');
        }
    }, 100);

    // Initialize header
    if (window.Header) {
        window.Header.init();
    } else {
        console.warn('[subscription.html] Header not available');
    }

    // Initialize upgrade page (async to wait for payments init)
    (async function() {
        // Wait for payments module initialization before initializing UpgradeController
        if (window.waitForPaymentsInit) {
            try {
                await window.waitForPaymentsInit();
            } catch (error) {
                console.error('[subscription.html] Error waiting for payments init:', error);
            }
        }

        if (window.UpgradeController) {
            window.UpgradeController.init();
        } else {
            console.warn('[subscription.html] UpgradeController not available');
        }
    })();

    // Final check after a short delay
    setTimeout(function() {
        console.log('[subscription.html] Final services check after delay:', {
            hasStripeService: !!window.StripeService,
            stripeServiceType: typeof window.StripeService,
            hasListInvoices: !!(window.StripeService && typeof window.StripeService.listInvoices === 'function')
        });

        // If StripeService still not available, try to manually verify the script URL
        if (!window.StripeService) {
            console.warn('[subscription.html] ⚠️ StripeService still not available after delay');
            const stripeServiceScript = document.querySelector('script[src*="StripeService"]');
            if (stripeServiceScript) {
                const scriptUrl = stripeServiceScript.src;
                console.log('[subscription.html] Attempting to manually verify script URL:', scriptUrl);

                // Try to fetch the script to see if it's accessible
                fetch(scriptUrl)
                    .then(response => {
                        console.log('[subscription.html] Script fetch response:', {
                            status: response.status,
                            statusText: response.statusText,
                            ok: response.ok,
                            contentType: response.headers.get('content-type')
                        });
                        if (!response.ok) {
                            console.error('[subscription.html] ❌ Script URL returned error status:', response.status);
                        }
                        return response.text();
                    })
                    .then(text => {
                        console.log('[subscription.html] Script content preview (first 200 chars):', text.substring(0, 200));
                        console.log('[subscription.html] Script contains StripeService definition:', text.includes('const StripeService'));
                        console.log('[subscription.html] Script contains window.StripeService:', text.includes('window.StripeService'));
                    })
                    .catch(error => {
                        console.error('[subscription.html] ❌ Error fetching script:', error);
                    });
            }
        }
    }, 1000);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runSubscriptionInit);
} else {
    runSubscriptionInit();
}
