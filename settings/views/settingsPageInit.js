// Settings page bootstrap.
// H-5: externalized from settings.html inline <script> so script-src can drop
// 'unsafe-inline'. Loaded with `defer`; self-guards for the case where
// DOMContentLoaded has already fired by the time this script runs.

// Surface a NON-BLOCKING, dismissible inline notice for page-init/load
// failures (replaces the old modal alert()). Never blocks the UI — the
// page stays usable in the backend-less preview or on a transient error.
function showSettingsLoadErrorNotice(message) {
    try {
        var existing = document.querySelector('[data-load-error-notice="settings"]');
        if (existing) existing.remove();

        var notice = document.createElement('div');
        notice.setAttribute('data-load-error-notice', 'settings');
        notice.setAttribute('role', 'status');
        notice.style.cssText = [
            'position: fixed',
            'top: 16px',
            'left: 50%',
            'transform: translateX(-50%)',
            'z-index: 10000',
            'max-width: min(92vw, 460px)',
            'background: var(--warning-bg, #fff3cd)',
            'color: var(--warning-color, #856404)',
            'border: 1px solid var(--warning-border, #ffeeba)',
            'border-radius: 6px',
            'padding: 10px 12px',
            'box-shadow: 0 2px 8px rgba(0,0,0,0.15)',
            'font-size: 0.9em',
            'display: flex',
            'align-items: center',
            'justify-content: space-between',
            'gap: 8px'
        ].join(';');

        var msgSpan = document.createElement('span');
        msgSpan.textContent = message; // textContent => inherently XSS-safe

        var closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Dismiss');
        closeBtn.textContent = '×';
        closeBtn.style.cssText = 'background:none;border:none;font-size:1.2em;line-height:1;cursor:pointer;color:inherit;flex-shrink:0;';
        closeBtn.addEventListener('click', function() { notice.remove(); });

        notice.appendChild(msgSpan);
        notice.appendChild(closeBtn);
        (document.body || document.documentElement).appendChild(notice);

        setTimeout(function() { if (notice.isConnected) notice.remove(); }, 8000);
    } catch (e) {
        console.error('[SettingsPage] showSettingsLoadErrorNotice failed:', e);
    }
}

// Bootstrap mirrors messenger.html: init config -> services -> AuthGuard -> controller.
async function runSettingsInit() {
    console.log('[SettingsPage] DOMContentLoaded - starting initialization');
    try {
        if (window.SupabaseConfig && typeof window.SupabaseConfig.initialize === 'function') {
            await window.SupabaseConfig.initialize();
        }
        if (window.AuthService && typeof window.AuthService.initialize === 'function') {
            await window.AuthService.initialize();
        }
        if (window.DatabaseService && typeof window.DatabaseService.initialize === 'function') {
            await window.DatabaseService.initialize();
        }

        // Enforce authentication before initializing the UI.
        if (window.AuthGuard && typeof window.AuthGuard.checkAuth === 'function') {
            const authed = await window.AuthGuard.checkAuth();
            if (!authed) {
                console.log('[SettingsPage] Not authenticated — AuthGuard is redirecting.');
                return;
            }
        } else {
            console.error('[SettingsPage] AuthGuard unavailable; refusing to load settings.');
            window.location.href = '../../auth/views/auth.html';
            return;
        }

        if (window.SettingsController) {
            await window.SettingsController.init();
            console.log('[SettingsPage] SettingsController initialized');
        }

        // Link-a-device: generate a one-time pairing code for another device.
        const linkBtn = document.getElementById('link-device-button');
        if (linkBtn && window.DevicePairingService) {
            linkBtn.addEventListener('click', async () => {
                const out = document.getElementById('pairing-code-output');
                const val = document.getElementById('pairing-code-value');
                const exp = document.getElementById('pairing-code-expiry');
                const status = document.getElementById('link-device-status');
                status.textContent = '';
                const orig = linkBtn.innerHTML;
                linkBtn.disabled = true;
                linkBtn.textContent = 'Generating…';
                try {
                    const r = await window.DevicePairingService.createPairingRequest();
                    if (r && r.success) {
                        val.textContent = r.code;
                        exp.textContent = r.expiresAt ? ('Valid until ' + new Date(r.expiresAt).toLocaleTimeString()) : '';
                        out.classList.remove('hidden');
                    } else {
                        status.textContent = (r && r.error) ? r.error : 'Could not generate a pairing code.';
                    }
                } catch (e) {
                    status.textContent = 'Could not generate a pairing code.';
                } finally {
                    linkBtn.disabled = false;
                    linkBtn.innerHTML = orig;
                }
            });
            const copyBtn = document.getElementById('copy-pairing-code');
            if (copyBtn) {
                copyBtn.addEventListener('click', async () => {
                    const code = document.getElementById('pairing-code-value').textContent;
                    try {
                        await navigator.clipboard.writeText(code);
                        const t = copyBtn.innerHTML;
                        copyBtn.innerHTML = '<i class="fas fa-check"></i> Copied!';
                        setTimeout(() => { copyBtn.innerHTML = t; }, 1500);
                    } catch (_) { /* clipboard blocked; the code is selectable */ }
                });
            }
        }

        console.log('[SettingsPage] Initialization complete!');
    } catch (error) {
        console.error('[SettingsPage] Initialization error:', error);
        showSettingsLoadErrorNotice('Failed to initialize the settings page. Please refresh and try again.');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runSettingsInit);
} else {
    runSettingsInit();
}
