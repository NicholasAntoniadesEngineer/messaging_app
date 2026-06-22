/**
 * Device Pairing Service — DISABLED
 *
 * SECURITY NOTICE (SM-06 / SM-16 / SM-31 / SM-47):
 * The previous implementation exported the user's long-term identity SECRET key
 * off-device, wrapped only by a brute-forceable 6-digit numeric code derived with a
 * single unsalted SHA-256 — with no rate limiting and the code logged/stored in the
 * clear. That is a total, permanent compromise of end-to-end encryption if a single
 * `device_keys` row leaks, so the entire pairing flow has been disabled in this build.
 *
 * The public surface (`window.DevicePairingService` and its method names) is preserved
 * so existing HTML/JS keeps loading, but every method that would export, wrap, transmit,
 * or recover a secret now performs NO secret operation and fails closed.
 *
 * Multi-device key transfer should be done via the password / recovery-key restore flow
 * (KeyBackupService / PasswordCryptoService), not by shipping the raw secret key.
 */

const DISABLED_MESSAGE = 'Device pairing is disabled in this build for security; use password/recovery-key restore.';

const DevicePairingService = {
    CODE_EXPIRY_MS: 5 * 60 * 1000, // retained for interface compatibility (unused)
    CODE_LENGTH: 6,

    /**
     * DISABLED. No pairing code is generated (codes are not a safe protector for the
     * long-term identity secret — SM-06). Returns null.
     * @returns {null}
     */
    generatePairingCode() {
        return null;
    },

    /**
     * DISABLED. Does NOT encrypt, wrap, or transmit any key material (SM-16). The
     * long-term identity secret must never leave the originating device.
     * @returns {Promise<{success: boolean, code: null, expiresAt: null, error: string}>}
     */
    async createPairingRequest() {
        return {
            success: false,
            code: null,
            expiresAt: null,
            error: DISABLED_MESSAGE
        };
    },

    /**
     * DISABLED. Does NOT read, decrypt, or return any stored secret (SM-06).
     * @returns {Promise<{success: boolean, keys: null, error: string}>}
     */
    async verifyPairingCode() {
        return {
            success: false,
            keys: null,
            error: DISABLED_MESSAGE
        };
    },

    /**
     * DISABLED. Does NOT write a device record (the previous body also called
     * non-existent crypto APIs — SM-31). Fails closed.
     * @returns {Promise<{success: boolean, error: string}>}
     */
    async registerDevice() {
        return {
            success: false,
            error: DISABLED_MESSAGE
        };
    },

    /**
     * No-op. Pairing requests are no longer created, so there is nothing to clean up.
     * @returns {Promise<void>}
     */
    async cleanupExpiredRequests() {
        // No pairing rows are ever created by this build; nothing to do.
    },

    /**
     * Best-effort human-readable device name (browser + OS). Contains no secret and is
     * safe to keep; used for UI labels only.
     * @returns {string} Device name
     */
    getDeviceName() {
        const userAgent = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : '';
        let browser = 'Unknown Browser';
        let os = 'Unknown OS';

        // Detect browser
        if (userAgent.includes('Chrome')) browser = 'Chrome';
        else if (userAgent.includes('Safari')) browser = 'Safari';
        else if (userAgent.includes('Firefox')) browser = 'Firefox';
        else if (userAgent.includes('Edge')) browser = 'Edge';

        // Detect OS
        if (userAgent.includes('Win')) os = 'Windows';
        else if (userAgent.includes('Mac')) os = 'macOS';
        else if (userAgent.includes('Linux')) os = 'Linux';
        else if (userAgent.includes('Android')) os = 'Android';
        else if (userAgent.includes('iOS')) os = 'iOS';

        return `${browser} on ${os}`;
    }
};

// Make available globally (HTML still references it)
window.DevicePairingService = DevicePairingService;
