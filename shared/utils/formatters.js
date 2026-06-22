/**
 * Utility Functions
 * Shared formatting and helper functions
 */

const Formatters = {
    /**
     * Get currency symbol from settings
     * Uses cached settings for synchronous access
     * Checks localStorage first for immediate access, then DataManager cache
     */
    getCurrencySymbol() {
        // First try DataManager cache (most up-to-date)
        if (typeof window !== 'undefined' && window.DataManager) {
            const settings = DataManager.getCachedSettings();
            if (settings && settings.currency) {
                return settings.currency;
            }
        }
        
        // Fallback to localStorage for immediate access (prevents FOUC)
        try {
            const cachedSettings = localStorage.getItem('money_tracker_settings');
            if (cachedSettings) {
                const parsed = JSON.parse(cachedSettings);
                if (parsed && parsed.currency) {
                    return parsed.currency;
                }
            }
        } catch (error) {
            // Silently fail - localStorage might not be available
        }
        
        return '£'; // Default to £
    },

    /**
     * Format currency amount
     */
    formatCurrency(amount) {
        const currencySymbol = this.getCurrencySymbol();
        return currencySymbol + parseFloat(amount || 0).toFixed(2);
    },

    /**
     * Format date for display
     */
    formatDate(dateString) {
        if (!dateString) return '';
        const date = new Date(dateString);
        return date.toLocaleDateString();
    },

    /**
     * Parse number safely
     */
    parseNumber(value) {
        const parsed = parseFloat(value || 0);
        return isNaN(parsed) ? 0 : parsed;
    },

    /**
     * Validate year input
     */
    validateYear(year) {
        const yearNum = parseInt(year, 10);
        return !isNaN(yearNum) && yearNum >= 2000 && yearNum <= 2100;
    },

    /**
     * Validate month input
     */
    validateMonth(month) {
        const monthNum = parseInt(month, 10);
        return !isNaN(monthNum) && monthNum >= 1 && monthNum <= 12;
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.Formatters = Formatters;
}

