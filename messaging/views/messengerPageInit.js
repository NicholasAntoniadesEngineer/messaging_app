/**
 * Messenger page initialization.
 *
 * H-5 (CSP): extracted verbatim (behavior-preserving) from the inline <script>
 * blocks at the foot of messenger.html so the page can drop
 * `script-src 'unsafe-inline'`. This file is loaded with `defer` AFTER all the
 * service/controller <script src> tags, so window.Header / window.MessengerController
 * are loading/loaded by the time it runs; it still waits for them via waitFor().
 *
 * The former inline `onload`/`onerror` diagnostics on the header/controller script
 * tags are replaced by addEventListener wiring here (or a no-op if the script has
 * already finished loading) — they were purely console diagnostics.
 */
(function () {
    'use strict';

    console.log('[MessengerPage] Loading Header.js / messengerController.js (external init)...');

    // Replace the former inline onload/onerror handlers (pure diagnostics) with
    // addEventListener wiring. If the target script already loaded, the 'load'
    // event won't fire again — that's fine, these were diagnostic-only.
    function wireScriptDiagnostics(id, label, globalName) {
        var el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('load', function () {
            console.log('[MessengerPage] ' + label + ' loaded; window.' + globalName + ':', typeof window[globalName]);
        });
        el.addEventListener('error', function () {
            console.error('[MessengerPage] ERROR loading ' + label);
        });
    }
    wireScriptDiagnostics('messenger-header-script', 'Header.js', 'Header');
    wireScriptDiagnostics('messenger-controller-script', 'messengerController.js', 'MessengerController');

    // Wait for scripts to load with detailed logging
    function waitFor(condition, name, timeout) {
        timeout = timeout || 5000;
        return new Promise(function (resolve, reject) {
            var startTime = Date.now();
            var checkCount = 0;
            var check = function () {
                checkCount++;
                var elapsed = Date.now() - startTime;
                var isAvailable = condition();

                // Log every 10 checks (every second) or on first check
                if (checkCount === 1 || checkCount % 10 === 0) {
                    console.log('[MessengerPage] Waiting for ' + name + '... (check ' + checkCount + ', ' + elapsed + 'ms elapsed)');
                }

                if (isAvailable) {
                    var totalTime = Date.now() - startTime;
                    console.log('[MessengerPage] ' + name + ' is now available after ' + totalTime + 'ms (' + checkCount + ' checks)');
                    resolve();
                } else if (elapsed > timeout) {
                    console.error('[MessengerPage] Timeout waiting for ' + name + ' after ' + (Date.now() - startTime) + 'ms (' + checkCount + ' checks)');
                    reject(new Error('Timeout waiting for ' + name));
                } else {
                    setTimeout(check, 100);
                }
            };
            check();
        });
    }

    console.log('[MessengerPage] ========== INITIALIZATION SCRIPT EXECUTING ==========');
    console.log('[MessengerPage] Current readyState:', document.readyState);

    function runInit() {
        return (async function () {
            console.log('[MessengerPage] ========== DOMContentLoaded / init start ==========');

            try {
                // SM-45: enforce authentication (and the subscription/business gate) BEFORE
                // initializing the UI. AuthGuard.checkAuth() validates the session server-side
                // and redirects to the sign-in page if the user is not authenticated.
                if (window.AuthGuard && typeof window.AuthGuard.checkAuth === 'function') {
                    const authed = await window.AuthGuard.checkAuth();
                    if (!authed) {
                        console.log('[MessengerPage] Not authenticated — AuthGuard is redirecting.');
                        return;
                    }
                } else {
                    console.error('[MessengerPage] AuthGuard unavailable; refusing to load messenger.');
                    window.location.href = '../../auth/views/auth.html';
                    return;
                }

                console.log('[MessengerPage] Step 1: Waiting for Header to be available...');
                await waitFor(function () { return typeof window.Header !== 'undefined'; }, 'Header', 10000);

                // Initialize Header first (it may have already auto-initialized, but init() is idempotent)
                if (window.Header && typeof window.Header.init === 'function') {
                    console.log('[MessengerPage] Calling Header.init()...');
                    await window.Header.init();
                    console.log('[MessengerPage] Header.init() completed');
                } else {
                    console.warn('[MessengerPage] Header.init() is not available');
                }

                console.log('[MessengerPage] Step 4: Waiting for MessengerController to be available...');
                await waitFor(function () { return typeof window.MessengerController !== 'undefined'; }, 'MessengerController', 10000);

                // Initialize MessengerController
                if (window.MessengerController && typeof window.MessengerController.init === 'function') {
                    console.log('[MessengerPage] Calling MessengerController.init()...');
                    await window.MessengerController.init();
                    console.log('[MessengerPage] MessengerController.init() completed');

                    // Set up periodic key rotation check (every 5 minutes)
                    // This checks if YOUR keys need rotation based on the configured interval
                    // Other user's key rotations are handled transparently via epoch-based decryption
                    const ROTATION_CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes
                    let lastRotationCheck = 0;

                    const checkKeyRotation = async function () {
                        const now = Date.now();
                        // Throttle: only check if 5 minutes have passed since last check
                        if (now - lastRotationCheck < ROTATION_CHECK_INTERVAL) {
                            return;
                        }
                        lastRotationCheck = now;

                        try {
                            // Check if EncryptionModule is initialized
                            if (!window.EncryptionModule?.isInitialized?.()) {
                                return; // Skip rotation check if module not initialized
                            }

                            const facade = window.getEncryptionFacade?.();
                            if (!facade?.checkAndRotateIfNeeded) return;

                            const result = await facade.checkAndRotateIfNeeded();
                            if (result.rotated) {
                                console.log('[MessengerPage] Auto-rotated keys to epoch ' + result.newEpoch);
                            }
                        } catch (error) {
                            console.warn('[MessengerPage] Key rotation check failed:', error);
                        }
                    };

                    // Check rotation on page load (already done in EncryptionModule, but also do it here)
                    checkKeyRotation();

                    // Set up periodic check while page is open
                    setInterval(checkKeyRotation, ROTATION_CHECK_INTERVAL);

                    // Also check on message receive (throttled by the function above)
                    const originalSubscribe = window.MessagingService?.subscribeToMessages;
                    if (originalSubscribe) {
                        window.MessagingService.subscribeToMessages = async function (userId, callback) {
                            const wrappedCallback = function (payload) {
                                // Check rotation on new message (throttled)
                                checkKeyRotation();
                                // Call original callback
                                if (callback) callback(payload);
                            };
                            return originalSubscribe.call(this, userId, wrappedCallback);
                        };
                    }

                    console.log('[MessengerPage] Key rotation monitoring enabled (checks every 5 min)');
                    console.log('[MessengerPage] ========== INITIALIZATION COMPLETE ==========');
                } else {
                    console.error('[MessengerPage] MessengerController.init() is not available');
                    throw new Error('MessengerController.init() is not available');
                }
            } catch (error) {
                console.error('[MessengerPage] ========== INITIALIZATION ERROR ==========');
                console.error('[MessengerPage] Error message:', error && error.message);
                console.error('[MessengerPage] Error stack:', error && error.stack);
                try {
                    console.error('[init] failed:', typeof error !== 'undefined' ? error : '');
                } catch (_) { /* noop */ }
                if (document.body) {
                    var banner = document.createElement('div');
                    banner.setAttribute('role', 'alert');
                    banner.style.cssText = 'background:#7f1d1d;color:#fff;padding:12px 16px;text-align:center;font:14px sans-serif';
                    banner.textContent = 'Could not load the page. Check your connection and refresh.';
                    document.body.prepend(banner);
                }
            }
        })();
    }

    // This file loads with `defer`, so DOMContentLoaded may have already fired by
    // the time it executes. Run immediately if the DOM is ready, else wait for it.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', runInit);
    } else {
        runInit();
    }
})();
