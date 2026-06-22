/**
 * Data Manager Model
 * Core data operations using Supabase database service
 * Replaces the old localStorage-based DataManager
 */

const DataManager = {
    _cachedSettings: null,

    /**
     * Initialize default settings if they don't exist
     * @returns {Promise<Object>} Settings object
     */
    async initializeSettings() {
        try {
            const existingSettings = await this.getSettings();
            if (!existingSettings) {
                const defaultSettings = {
                    currency: '£',
                    fontScale: 'medium',
                    defaultFixedCosts: [],
                    defaultVariableCategories: ['Food', 'Travel/Transport', 'Activities'],
                    defaultPots: []
                };
                await this.saveSettings(defaultSettings);
                this._cachedSettings = defaultSettings;
                // Ensure localStorage is updated (saveSettings does this, but be explicit)
                try {
                    localStorage.setItem('money_tracker_settings', JSON.stringify(defaultSettings));
                } catch (error) {
                    // Silently fail if localStorage is not available
                }
                return defaultSettings;
            }

            if (!existingSettings.fontScale) {
                existingSettings.fontScale = 'medium';
                await this.saveSettings(existingSettings);
            }

            this._cachedSettings = existingSettings;
            // Ensure localStorage is updated
            try {
                localStorage.setItem('money_tracker_settings', JSON.stringify(existingSettings));
            } catch (error) {
                // Silently fail if localStorage is not available
            }
            return existingSettings;
        } catch (error) {
            console.error('Error initializing settings:', error);
            throw error;
        }
    },

    /**
     * Get all months data from database
     * @param {boolean} forceRefresh - Force refresh from database, bypass cache
     * @param {boolean} includeExampleData - Include example months data (default: true)
     * @returns {Promise<Object>} Object with all months keyed by monthKey
     */
    async getAllMonths(forceRefresh = false, includeExampleData = true) {
        try {
            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }
            return await window.DatabaseService.getAllMonths(forceRefresh, includeExampleData);
        } catch (error) {
            console.error('Error getting all months:', error);
            throw error;
        }
    },

    /**
     * Save all months data to database
     * @param {Object} monthsData - Object with all months
     * @returns {Promise<boolean>} Success status
     */
    async saveAllMonths(monthsData) {
        try {
            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }

            const monthKeys = Object.keys(monthsData);
            for (const monthKey of monthKeys) {
                await window.DatabaseService.saveMonth(monthKey, monthsData[monthKey]);
            }

            return true;
        } catch (error) {
            console.error('Error saving all months:', error);
            throw error;
        }
    },

    /**
     * Get a specific month's data from database
     * @param {string} monthKey - Month key (e.g., "2025-11")
     * @returns {Promise<Object|null>} Month data or null
     */
    async getMonth(monthKey) {
        try {
            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }
            return await window.DatabaseService.getMonth(monthKey);
        } catch (error) {
            console.error(`Error getting month ${monthKey}:`, error);
            throw error;
        }
    },

    /**
     * Save a specific month's data to database
     * @param {string} monthKey - Month key
     * @param {Object} monthData - Month data object
     * @param {boolean} forceUserTable - Force save to user_months table (for imports)
     * @returns {Promise<boolean>} Success status
     */
    async saveMonth(monthKey, monthData, forceUserTable = false) {
        try {
            if (!monthKey || !monthData) {
                throw new Error('Month key and data are required');
            }

            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }

            monthData.updatedAt = new Date().toISOString();
            if (!monthData.createdAt) {
                monthData.createdAt = new Date().toISOString();
            }

            return await window.DatabaseService.saveMonth(monthKey, monthData, forceUserTable);
        } catch (error) {
            console.error(`Error saving month ${monthKey}:`, error);
            throw error;
        }
    },

    /**
     * Delete a month from database
     * @param {string} monthKey - Month key
     * @returns {Promise<boolean>} Success status
     * @throws {Error} If attempting to delete example data
     */
    async deleteMonth(monthKey) {
        try {
            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }

            // Check if this is example data before attempting deletion
            const isExample = await window.DatabaseService.isExampleData(monthKey);
            if (isExample) {
                throw new Error('Example data cannot be deleted. This data is protected and locked.');
            }

            return await window.DatabaseService.deleteMonth(monthKey);
        } catch (error) {
            console.error(`Error deleting month ${monthKey}:`, error);
            throw error;
        }
    },

    /**
     * Get all pots data
     * @returns {Promise<Object>} Pots data object
     */
    async getAllPots() {
        try {
            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }
            return await window.DatabaseService.getAllPots();
        } catch (error) {
            console.error('Error getting all pots:', error);
            throw error;
        }
    },

    /**
     * Save all pots data
     * @param {Object} potsData - Pots data object
     * @returns {Promise<boolean>} Success status
     */
    async saveAllPots(potsData) {
        try {
            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }
            return await window.DatabaseService.saveAllPots(potsData);
        } catch (error) {
            console.error('Error saving pots:', error);
            throw error;
        }
    },

    /**
     * Get settings
     * @returns {Promise<Object|null>} Settings object or null
     */
    async getSettings() {
        try {
            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }
            const settings = await window.DatabaseService.getSettings();
            if (settings) {
                this._cachedSettings = settings;
                // Update localStorage cache for immediate access on next page load
                try {
                    localStorage.setItem('money_tracker_settings', JSON.stringify(settings));
                } catch (error) {
                    // Silently fail if localStorage is not available
                }
            }
            return settings;
        } catch (error) {
            // Only log error once to prevent spam
            if (!this._settingsErrorLogged) {
                console.error('Error getting settings:', error);
                this._settingsErrorLogged = true;
            }
            // Return null instead of throwing to prevent cascading errors
            return null;
        }
    },

    /**
     * Get cached settings synchronously (for use in synchronous contexts)
     * Checks localStorage first for immediate access, then in-memory cache
     * @returns {Object|null} Cached settings object or null
     */
    getCachedSettings() {
        // First check in-memory cache (most up-to-date)
        if (this._cachedSettings) {
            return this._cachedSettings;
        }

        // Fallback to localStorage for immediate access (prevents FOUC)
        try {
            const cachedSettings = localStorage.getItem('money_tracker_settings');
            if (cachedSettings) {
                const parsed = JSON.parse(cachedSettings);
                // Cache in memory for future calls
                this._cachedSettings = parsed;
                return parsed;
            }
        } catch (error) {
            // Silently fail - localStorage might not be available
        }

        return null;
    },

    /**
     * Save settings
     * @param {Object} settings - Settings object
     * @returns {Promise<boolean>} Success status
     */
    async saveSettings(settings) {
        try {
            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }
            const success = await window.DatabaseService.saveSettings(settings);
            if (success) {
                this._cachedSettings = settings;
                // Update localStorage cache for immediate access on next page load
                try {
                    localStorage.setItem('money_tracker_settings', JSON.stringify(settings));
                } catch (error) {
                    // Silently fail if localStorage is not available
                }
            }
            return success;
        } catch (error) {
            console.error('Error saving settings:', error);
            throw error;
        }
    },

    /** Map scale names to root font sizes in px */
    _fontScaleMap: { 'very-small': 13, small: 14, medium: 16, large: 18, 'very-large': 20 },

    /**
     * Apply font scale setting to the document
     */
    async applyFontScale() {
        try {
            const settings = await this.getSettings();
            const scale = (settings && settings.fontScale) ? settings.fontScale : 'medium';
            const px = this._fontScaleMap[scale] || 16;
            document.documentElement.style.fontSize = px + 'px';
            localStorage.setItem('money_tracker_fontScale', scale);
            console.log('[DataManager] Font scale applied:', scale, px + 'px');
        } catch (error) {
            console.error('[DataManager] Error applying font scale:', error);
            document.documentElement.style.fontSize = '16px';
            localStorage.setItem('money_tracker_fontScale', 'medium');
        }
    },

    /**
     * Generate a month key from year and month
     * @param {number} year - Year
     * @param {number} month - Month (1-12)
     * @returns {string} Month key
     */
    generateMonthKey(year, month) {
        if (!window.MonthFactory) {
            throw new Error('MonthFactory not available');
        }
        return window.MonthFactory.generateMonthKey(year, month);
    },

    /**
     * Parse month key to year and month
     * @param {string} monthKey - Month key
     * @returns {Object} Object with year and month
     */
    parseMonthKey(monthKey) {
        if (!window.MonthFactory) {
            throw new Error('MonthFactory not available');
        }
        return window.MonthFactory.parseMonthKey(monthKey);
    },

    /**
     * Get month name from month number
     * @param {number} monthNumber - Month number (1-12)
     * @returns {string} Month name
     */
    getMonthName(monthNumber) {
        if (!window.MonthFactory) {
            throw new Error('MonthFactory not available');
        }
        return window.MonthFactory.getMonthName(monthNumber);
    },

    /**
     * Create a new month with default structure
     * @param {number} year - Year
     * @param {number} month - Month (1-12)
     * @returns {Promise<Object>} New month data object
     */
    async createNewMonth(year, month) {
        try {
            const settings = await this.getSettings() || await this.initializeSettings();

            if (!window.MonthFactory) {
                throw new Error('MonthFactory not available');
            }

            const newMonth = window.MonthFactory.createNewMonth(year, month, settings);
            const monthKey = newMonth.key;
            await this.saveMonth(monthKey, newMonth);
            return newMonth;
        } catch (error) {
            console.error('Error creating new month:', error);
            throw error;
        }
    },

    /**
     * Calculate totals for a month
     * @param {Object} monthData - Month data object
     * @returns {Object} Totals object
     */
    calculateMonthTotals(monthData) {
        if (!window.CalculationService) {
            throw new Error('CalculationService not available');
        }
        return window.CalculationService.calculateMonthTotals(monthData);
    },

    /**
     * Generate HTML representation of month data
     * @param {Object} monthData - Month data object
     * @param {string} monthKey - Month key
     * @returns {string} HTML string
     */
    monthDataToHTML(monthData, monthKey) {
        if (!window.ExportService) {
            throw new Error('ExportService not available');
        }
        return window.ExportService.monthDataToHTML(monthData, monthKey);
    }
};

if (typeof window !== 'undefined') {
    window.DataManager = DataManager;
}
