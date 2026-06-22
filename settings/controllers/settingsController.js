/**
 * Settings Controller (Secure Messenger)
 *
 * Messaging-appropriate settings only: Account (email/password/text-size/sign-out),
 * Security (E2E fingerprint + sign-out-everywhere) and a Danger Zone (nuke account).
 *
 * Always dark; no theme toggle, no subscription/notification/data-sharing UI.
 * All user-controlled text is rendered via textContent (never innerHTML) to avoid XSS.
 */

const SettingsController = {
    /** Map scale names to root font sizes in px (same as money_tracker). */
    fontScaleMap: { 'very-small': 13, small: 14, medium: 16, large: 18, 'very-large': 20 },

    /** localStorage key for the local-only font-scale preference. */
    FONT_SCALE_KEY: 'secure_messenger_fontScale',

    /**
     * Initialize the settings page.
     * Set up event listeners FIRST so buttons work even if a load step throws,
     * then run each load step in its own try/catch.
     */
    async init() {
        console.log('[SettingsController] init() called');

        this.setupEventListeners();
        console.log('[SettingsController] Event listeners set up');

        try {
            await this.loadAccount();
        } catch (error) {
            console.error('[SettingsController] Error loading account:', error);
        }

        try {
            await this.loadFontScaleSetting();
        } catch (error) {
            console.error('[SettingsController] Error loading font scale:', error);
        }

        try {
            await this.loadSecurity();
        } catch (error) {
            console.error('[SettingsController] Error loading security:', error);
        }

        console.log('[SettingsController] init() completed');
    },

    /**
     * Format a date for display (copied from money_tracker).
     */
    formatDate(dateString) {
        if (!dateString) {
            return 'N/A';
        }
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-GB', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
        } catch (error) {
            return dateString;
        }
    },

    /**
     * Set a status element's content as escaped text with a CSS-variable color.
     * @param {string} id - element id
     * @param {string} message - plain text (rendered via textContent)
     * @param {string} cssVar - e.g. 'var(--danger-color)'
     */
    _setStatus(id, message, cssVar) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = '';
        const p = document.createElement('p');
        if (cssVar) {
            p.style.color = cssVar;
        }
        p.textContent = message;
        el.appendChild(p);
    },

    /**
     * Clear a status element.
     */
    _clearStatus(id) {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    },

    // ==================== Account (section 1) ====================

    /**
     * Load and display the account email + creation date (1.1).
     */
    async loadAccount() {
        const user = window.AuthService?.getCurrentUser?.() || null;

        const emailEl = document.getElementById('account-email');
        if (emailEl) {
            emailEl.textContent = user?.email || 'Unknown';
        }

        const createdEl = document.getElementById('account-created');
        if (createdEl) {
            createdEl.textContent = user?.created_at
                ? `Account created: ${this.formatDate(user.created_at)}`
                : '';
        }
    },

    /**
     * Load and display the current font-scale setting (1.4).
     */
    async loadFontScaleSetting() {
        const select = document.getElementById('font-scale-select');
        if (!select) return;
        const scale = localStorage.getItem(this.FONT_SCALE_KEY) || 'medium';
        select.value = scale;
    },

    /**
     * Local password-strength check (1.3.2).
     * Require length >= 8 AND at least three of {lowercase, uppercase, digit, symbol}.
     * @param {string} pw
     * @returns {{ok: boolean, reason: string|null}}
     */
    checkPasswordStrength(pw) {
        if (typeof pw !== 'string' || pw.length < 8) {
            return {
                ok: false,
                reason: 'Password too weak — use at least 8 characters with a mix of upper/lowercase, numbers, and symbols.'
            };
        }
        let classes = 0;
        if (/[a-z]/.test(pw)) classes++;
        if (/[A-Z]/.test(pw)) classes++;
        if (/[0-9]/.test(pw)) classes++;
        if (/[^a-zA-Z0-9]/.test(pw)) classes++;
        if (classes < 3) {
            return {
                ok: false,
                reason: 'Password too weak — use at least 8 characters with a mix of upper/lowercase, numbers, and symbols.'
            };
        }
        return { ok: true, reason: null };
    },

    // ==================== Security (section 2) ====================

    /**
     * Load and render the E2E key fingerprint / safety number (2.1).
     * Must degrade gracefully — never throws.
     */
    async loadSecurity() {
        const TARGET = 'key-fingerprint';
        try {
            const userId = window.AuthService?.getCurrentUser?.()?.id;
            if (!userId) {
                this._setStatus(TARGET, 'Encryption keys not set up on this device.', 'var(--text-secondary)');
                return;
            }

            let publicKeyBytes = null;

            // Prefer the locally stored identity key from IndexedDB.
            try {
                if (window.KeyStorageService
                    && window.KeyStorageService.isAvailable?.()
                    && window.KeyStorageService.initialized) {
                    const keys = await window.KeyStorageService.getIdentityKeys(userId);
                    if (keys && keys.publicKey) {
                        publicKeyBytes = keys.publicKey;
                    }
                }
            } catch (localErr) {
                console.warn('[SettingsController] Local identity key lookup failed:', localErr);
            }

            // Fallback: fetch the public key row from the identity_keys table (base64).
            if (!publicKeyBytes) {
                try {
                    const client = window.AuthService?.client || window.DatabaseService?.client;
                    if (client) {
                        const { data, error } = await client
                            .from('identity_keys')
                            .select('public_key')
                            .eq('user_id', userId)
                            .single();
                        if (!error && data && data.public_key) {
                            publicKeyBytes = this._base64ToBytes(data.public_key);
                        }
                    }
                } catch (remoteErr) {
                    console.warn('[SettingsController] Remote identity key lookup failed:', remoteErr);
                }
            }

            if (!publicKeyBytes || publicKeyBytes.length === 0) {
                this._setStatus(TARGET, 'Encryption keys not set up on this device.', 'var(--text-secondary)');
                return;
            }

            const fingerprint = await this._computeFingerprint(publicKeyBytes);
            if (!fingerprint) {
                this._setStatus(TARGET, 'Encryption keys not set up on this device.', 'var(--text-secondary)');
                return;
            }

            const el = document.getElementById(TARGET);
            if (el) {
                el.textContent = fingerprint;
                el.style.color = '';
            }
        } catch (error) {
            console.warn('[SettingsController] loadSecurity failed (non-fatal):', error);
            this._setStatus(TARGET, 'Encryption keys not set up on this device.', 'var(--text-secondary)');
        }
    },

    /**
     * Decode a base64 string to a Uint8Array.
     * @param {string} b64
     * @returns {Uint8Array}
     */
    _base64ToBytes(b64) {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    },

    /**
     * Compute a SHA-256 fingerprint over the public-key bytes and render the
     * first 32 hex chars grouped in 8 blocks of 4 (a stable "safety number").
     * @param {Uint8Array} bytes
     * @returns {Promise<string|null>}
     */
    async _computeFingerprint(bytes) {
        try {
            let digest;
            if (window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
                const buf = await window.crypto.subtle.digest('SHA-256', bytes);
                digest = new Uint8Array(buf);
            } else {
                return null;
            }

            const hex = Array.from(digest)
                .map(b => b.toString(16).padStart(2, '0'))
                .join('')
                .toUpperCase();

            const first32 = hex.slice(0, 32);
            const groups = [];
            for (let i = 0; i < first32.length; i += 4) {
                groups.push(first32.slice(i, i + 4));
            }
            return groups.join(' ');
        } catch (error) {
            console.warn('[SettingsController] Fingerprint computation failed:', error);
            return null;
        }
    },

    // ==================== Event listeners (section 5) ====================

    setupEventListeners() {
        const updateEmailBtn = document.getElementById('update-email-button');
        if (updateEmailBtn) {
            updateEmailBtn.addEventListener('click', () => this.handleUpdateEmail());
        }

        const updatePasswordBtn = document.getElementById('update-password-button');
        if (updatePasswordBtn) {
            updatePasswordBtn.addEventListener('click', () => this.handleUpdatePassword());
        }

        const fontScaleSelect = document.getElementById('font-scale-select');
        if (fontScaleSelect) {
            fontScaleSelect.addEventListener('change', () => {
                const val = fontScaleSelect.value;
                const px = this.fontScaleMap[val] || 16;
                document.documentElement.style.fontSize = px + 'px';
                localStorage.setItem(this.FONT_SCALE_KEY, val);
            });
        }

        const signOutBtn = document.getElementById('sign-out-button');
        if (signOutBtn) {
            signOutBtn.addEventListener('click', () => this.handleSignOut());
        }

        const signOutEverywhereBtn = document.getElementById('sign-out-everywhere-button');
        if (signOutEverywhereBtn) {
            signOutEverywhereBtn.addEventListener('click', () => this.handleSignOutEverywhere());
        }

        const deleteConfirmInput = document.getElementById('delete-confirm-input');
        const deleteAccountBtn = document.getElementById('delete-account-button');
        if (deleteConfirmInput && deleteAccountBtn) {
            deleteConfirmInput.addEventListener('input', () => {
                deleteAccountBtn.disabled = !this._isDeleteConfirmed(deleteConfirmInput.value);
            });
        }
        if (deleteAccountBtn) {
            deleteAccountBtn.addEventListener('click', () => this.handleDeleteAccount());
        }
    },

    /**
     * Whether the delete-confirmation input matches an accepted value:
     * the literal word DELETE (case-sensitive) OR the user's email (case-insensitive).
     * @param {string} value
     * @returns {boolean}
     */
    _isDeleteConfirmed(value) {
        const v = (value || '').trim();
        if (v === 'DELETE') return true;
        const email = window.AuthService?.getCurrentUser?.()?.email;
        if (email && v.toLowerCase() === email.trim().toLowerCase()) return true;
        return false;
    },

    // ==================== Handlers ====================

    /**
     * Change email (1.2). Supabase double-confirm flow.
     */
    async handleUpdateEmail() {
        const input = document.getElementById('new-email');
        const button = document.getElementById('update-email-button');
        const newEmail = (input?.value || '').trim();

        if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
            this._setStatus('email-status', 'Please enter a valid email address.', 'var(--danger-color)');
            return;
        }

        if (button) button.disabled = true;
        this._setStatus('email-status', 'Updating email...', 'var(--text-secondary)');

        try {
            const client = window.AuthService?.client;
            if (!client) {
                throw new Error('Authentication service not available.');
            }
            const { error } = await client.auth.updateUser({ email: newEmail });
            if (error) {
                this._setStatus('email-status', error.message, 'var(--danger-color)');
            } else {
                this._setStatus(
                    'email-status',
                    'Confirmation links sent. Check BOTH your old and new email to confirm the change.',
                    'var(--success-color)'
                );
            }
        } catch (error) {
            this._setStatus('email-status', error.message || 'Failed to update email.', 'var(--danger-color)');
        } finally {
            if (button) button.disabled = false;
        }
    },

    /**
     * Change password with a local strength check (1.3).
     */
    async handleUpdatePassword() {
        const newInput = document.getElementById('new-password');
        const confirmInput = document.getElementById('confirm-password');
        const button = document.getElementById('update-password-button');

        const newPassword = newInput?.value || '';
        const confirmPassword = confirmInput?.value || '';

        // 1. Both non-empty and equal.
        if (!newPassword || !confirmPassword || newPassword !== confirmPassword) {
            this._setStatus('password-status', 'Passwords do not match', 'var(--danger-color)');
            return;
        }

        // 2. Strength check.
        const strength = this.checkPasswordStrength(newPassword);
        if (!strength.ok) {
            this._setStatus('password-status', strength.reason, 'var(--danger-color)');
            return;
        }

        if (button) button.disabled = true;
        this._setStatus('password-status', 'Updating password...', 'var(--text-secondary)');

        try {
            // 3. Call the API.
            const result = await window.AuthService.updatePassword(newPassword);
            if (result && result.success) {
                this._setStatus('password-status', 'Password updated.', 'var(--success-color)');
            } else {
                this._setStatus('password-status', (result && result.error) || 'Failed to update password.', 'var(--danger-color)');
            }
        } catch (error) {
            this._setStatus('password-status', error.message || 'Failed to update password.', 'var(--danger-color)');
        } finally {
            // Never leave the plaintext password lingering in the inputs.
            if (newInput) newInput.value = '';
            if (confirmInput) confirmInput.value = '';
            if (button) button.disabled = false;
        }
    },

    /**
     * Sign out (1.5). AuthService.signOut() handles state clearing + redirect.
     */
    async handleSignOut() {
        try {
            await window.AuthService.signOut();
        } catch (error) {
            console.error('[SettingsController] Sign out error:', error);
        }
    },

    /**
     * Sign out everywhere (2.2). Revoke all refresh tokens server-side, then
     * run AuthService.signOut() for local cleanup + redirect.
     */
    async handleSignOutEverywhere() {
        const button = document.getElementById('sign-out-everywhere-button');
        if (button) button.disabled = true;
        this._setStatus('security-status', 'Signing out of all sessions...', 'var(--text-secondary)');

        try {
            const client = window.AuthService?.client;
            if (client && client.auth) {
                await client.auth.signOut({ scope: 'global' });
            }
        } catch (error) {
            console.warn('[SettingsController] Global sign out error (continuing):', error);
        }

        try {
            await window.AuthService.signOut();
        } catch (error) {
            console.error('[SettingsController] Local sign out error:', error);
            if (button) button.disabled = false;
        }
    },

    /**
     * Build the delete-account edge-function call (section 5 helper).
     * @returns {Promise<{ok: boolean, body: Object}>}
     */
    async callDeleteAccountFn() {
        const baseUrl = window.SupabaseConfig?.PROJECT_URL || 'https://ofutzrxfbrgtbkyafndv.supabase.co';
        const anonKey = window.SupabaseConfig?.PUBLISHABLE_API_KEY || '';
        const token = window.AuthService?.getAccessToken?.();

        if (!token) {
            return { ok: false, body: { error: 'No active session. Please sign in again.' } };
        }

        const response = await fetch(`${baseUrl}/functions/v1/delete-account`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'apikey': anonKey
            },
            body: JSON.stringify({})
        });

        let body = {};
        try {
            body = await response.json();
        } catch (parseErr) {
            body = { error: 'Unexpected server response.' };
        }
        return { ok: response.ok, body };
    },

    /**
     * Delete (nuke) the account (section 3).
     * Server-side deletion is authoritative; only clear local state on confirmed success.
     */
    async handleDeleteAccount() {
        const input = document.getElementById('delete-confirm-input');
        const button = document.getElementById('delete-account-button');

        // Re-validate the confirmation before acting.
        if (!this._isDeleteConfirmed(input?.value || '')) {
            this._setStatus('delete-status', 'Type DELETE or your email address to confirm.', 'var(--danger-color)');
            return;
        }

        if (button) button.disabled = true;
        this._setStatus('delete-status', 'Deleting your account and all data...', 'var(--text-secondary)');

        // A. Server-side deletion (authoritative).
        let result;
        try {
            result = await this.callDeleteAccountFn();
        } catch (error) {
            this._setStatus('delete-status', error.message || 'Network error. Please try again.', 'var(--danger-color)');
            if (button) button.disabled = false;
            return;
        }

        if (!result.ok) {
            const msg = (result.body && result.body.error) || 'Failed to delete account. Please try again.';
            this._setStatus('delete-status', msg, 'var(--danger-color)');
            if (button) button.disabled = false;
            return; // DO NOT clear local state — allow retry.
        }

        // C. Clear ALL local state on this device (only after confirmed server success).
        await this._clearAllLocalState();

        // D. Success.
        this._setStatus('delete-status', 'Your account and all data have been permanently deleted.', 'var(--success-color)');

        // Sign out (clears sb-* keys, dispatches auth:signout, redirects to auth).
        try {
            const client = window.AuthService?.client;
            if (client && client.auth) {
                await client.auth.signOut({ scope: 'global' });
            }
        } catch (error) {
            console.warn('[SettingsController] Global sign out during delete (continuing):', error);
        }
        try {
            localStorage.removeItem(this.FONT_SCALE_KEY);
        } catch (error) {
            /* non-fatal */
        }
        try {
            await window.AuthService.signOut();
        } catch (error) {
            console.error('[SettingsController] Sign out during delete failed; forcing redirect:', error);
            window.location.href = '../../auth/views/auth.html';
        }
    },

    /**
     * Clear IndexedDB encryption DB, sessionStorage password handle and the
     * local font-scale preference. The server cannot do this — the client must.
     */
    async _clearAllLocalState() {
        // IndexedDB: delete the encryption database.
        try {
            if (window.KeyStorageService && typeof window.KeyStorageService.deleteDatabase === 'function') {
                await window.KeyStorageService.deleteDatabase();
            } else if (typeof indexedDB !== 'undefined') {
                await new Promise((resolve) => {
                    const req = indexedDB.deleteDatabase('MoneyTrackerEncryption');
                    req.onsuccess = () => resolve();
                    req.onerror = () => resolve();
                    req.onblocked = () => resolve();
                });
            }
        } catch (error) {
            console.warn('[SettingsController] Failed to delete IndexedDB (continuing):', error);
        }

        // sessionStorage: clear temporary password handle (+ belt-and-braces full clear).
        try {
            if (window.PasswordManager && typeof window.PasswordManager.clear === 'function') {
                window.PasswordManager.clear();
            } else {
                sessionStorage.removeItem('money_tracker_temp_password');
            }
        } catch (error) {
            console.warn('[SettingsController] Failed to clear password handle (continuing):', error);
        }
        try {
            sessionStorage.clear();
        } catch (error) {
            /* non-fatal */
        }

        // localStorage: remove the local font-scale preference.
        try {
            localStorage.removeItem(this.FONT_SCALE_KEY);
        } catch (error) {
            /* non-fatal */
        }
    }
};

// Make available globally (same as money_tracker).
if (typeof window !== 'undefined') {
    window.SettingsController = SettingsController;
}

// Export for module systems / node --check friendliness.
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SettingsController;
}
