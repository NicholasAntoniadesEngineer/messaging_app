/**
 * Global Logging Configuration
 * Controls all console logging across the entire application
 * This file should be loaded FIRST, before any other scripts
 * @module shared/config/loggingConfig
 */

// ============================================================================
// LOGGING CONFIGURATION - Modify these settings to control logging behavior
// ============================================================================

// Master switch for all logging
const ENABLE_ALL_LOGS = true; // Set to true to enable logging, false to disable completely

// Filter mode: 'all' = show all logs, 'filter' = only show logs matching ALLOWED_PREFIXES
const LOG_FILTER_MODE = 'filter'; // 'all' or 'filter'

// Prefixes to allow when LOG_FILTER_MODE is 'filter'
// Only logs starting with these prefixes will be shown
const ALLOWED_PREFIXES = [
    // Messaging & Encryption (for debugging multi-device issues)
    '[KeyManagementService]',
    '[HistoricalKeysService]',
    '[KeyManager]',
    '[CryptoService]',
    '[KeyStorageService]',
    '[MessagingService]',
    '[MessengerController]',
    '[DevicePairing',
    '[NaClLoader]',
    // Always show errors
    'Error',
    'error',
    '❌',
    'CRITICAL',
    'FAILED',
    // Always show important warnings
    '⚠️',
    'WARNING',
    'MISMATCH'
];

// ============================================================================

/**
 * Global Logging Configuration
 *
 * MODES:
 * 1. ENABLE_ALL_LOGS: false → Disables ALL logging (production)
 * 2. ENABLE_ALL_LOGS: true + LOG_FILTER_MODE: 'all' → Shows all logs (full debug)
 * 3. ENABLE_ALL_LOGS: true + LOG_FILTER_MODE: 'filter' → Only shows logs matching ALLOWED_PREFIXES
 *
 * The filter mode is useful for debugging specific features without noise from other systems.
 */

// Initialize global logging configuration
window.LoggingConfig = window.LoggingConfig || {};
window.LoggingConfig.ENABLE_ALL_LOGS = ENABLE_ALL_LOGS;
window.LoggingConfig.LOG_FILTER_MODE = LOG_FILTER_MODE;
window.LoggingConfig.ALLOWED_PREFIXES = ALLOWED_PREFIXES;

/**
 * Override console methods to respect logging configuration
 * Supports three modes:
 * 1. Disabled: All logging off (production)
 * 2. All: All logging on (full debug)
 * 3. Filter: Only show logs matching ALLOWED_PREFIXES
 */
(function() {
    // Store original console methods
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;
    const originalDebug = console.debug;

    // Check configuration
    const loggingEnabled = window.LoggingConfig && window.LoggingConfig.ENABLE_ALL_LOGS === true;
    const filterMode = window.LoggingConfig && window.LoggingConfig.LOG_FILTER_MODE === 'filter';
    const allowedPrefixes = window.LoggingConfig && window.LoggingConfig.ALLOWED_PREFIXES || [];

    /**
     * Check if a log message matches any allowed prefix
     * @param {Array} args - Console arguments
     * @returns {boolean} - True if message should be shown
     */
    function matchesAllowedPrefix(args) {
        if (!args || args.length === 0) return false;

        // Convert first argument to string for matching
        const firstArg = String(args[0]);

        // Check if any allowed prefix matches
        for (const prefix of allowedPrefixes) {
            if (firstArg.includes(prefix)) {
                return true;
            }
        }

        // Also check subsequent arguments (for console.log('prefix', 'message') style)
        for (let i = 1; i < Math.min(args.length, 3); i++) {
            const arg = String(args[i]);
            for (const prefix of allowedPrefixes) {
                if (arg.includes(prefix)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Create a filtered console method
     * @param {Function} originalMethod - Original console method
     * @returns {Function} - Filtered method
     */
    function createFilteredMethod(originalMethod) {
        return function(...args) {
            if (matchesAllowedPrefix(args)) {
                originalMethod.apply(console, args);
            }
        };
    }

    if (!loggingEnabled) {
        // Mode 1: Disabled - no-op functions
        console.log = function() {};
        console.warn = function() {};
        console.error = function() {};
        console.info = function() {};
        console.debug = function() {};

        originalLog('[LoggingConfig] All console logging is DISABLED');
    } else if (filterMode) {
        // Mode 3: Filter - only show logs matching allowed prefixes
        console.log = createFilteredMethod(originalLog);
        console.warn = createFilteredMethod(originalWarn);
        console.error = originalError; // Always show errors
        console.info = createFilteredMethod(originalInfo);
        console.debug = createFilteredMethod(originalDebug);

        originalLog('[LoggingConfig] Filtered logging ENABLED - only showing:', allowedPrefixes.slice(0, 5).join(', '), '...');
    } else {
        // Mode 2: All - keep original methods
        originalLog('[LoggingConfig] All console logging is ENABLED');
    }

    // Store original methods for potential restoration
    console._originalLog = originalLog;
    console._originalWarn = originalWarn;
    console._originalError = originalError;
    console._originalInfo = originalInfo;
    console._originalDebug = originalDebug;

    // Provide method to restore original console methods (show all logs)
    window.LoggingConfig.restoreConsole = function() {
        console.log = originalLog;
        console.warn = originalWarn;
        console.error = originalError;
        console.info = originalInfo;
        console.debug = originalDebug;
        originalLog('[LoggingConfig] Console restored - all logs enabled');
    };

    // Provide method to disable console methods
    window.LoggingConfig.disableConsole = function() {
        console.log = function() {};
        console.warn = function() {};
        console.error = function() {};
        console.info = function() {};
        console.debug = function() {};
        originalLog('[LoggingConfig] Console disabled');
    };

    // Provide method to enable filtered logging
    window.LoggingConfig.enableFilteredLogging = function(prefixes) {
        const customPrefixes = prefixes || allowedPrefixes;
        console.log = createFilteredMethod(originalLog);
        console.warn = createFilteredMethod(originalWarn);
        console.error = originalError;
        console.info = createFilteredMethod(originalInfo);
        console.debug = createFilteredMethod(originalDebug);
        originalLog('[LoggingConfig] Filtered logging enabled for:', customPrefixes.slice(0, 5).join(', '));
    };

    // Provide method to update allowed prefixes at runtime
    window.LoggingConfig.setAllowedPrefixes = function(prefixes) {
        window.LoggingConfig.ALLOWED_PREFIXES = prefixes;
        // Re-apply filter with new prefixes
        window.LoggingConfig.enableFilteredLogging(prefixes);
    };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.LoggingConfig;
}
