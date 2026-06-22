/**
 * Month Factory
 * Creates and manages month data structures
 * @module models/MonthFactory
 */

const MonthFactory = {
    /**
     * Generate a month key from year and month
     * @param {number} year - Year (e.g., 2025)
     * @param {number} month - Month (1-12)
     * @returns {string} Month key (e.g., "2025-11")
     */
    generateMonthKey(year, month) {
        if (!year || !month || month < 1 || month > 12) {
            throw new Error('Invalid year or month');
        }
        return `${year}-${String(month).padStart(2, '0')}`;
    },

    /**
     * Parse month key to year and month
     * @param {string} monthKey - Month key (e.g., "2025-11")
     * @returns {Object} Object with year and month
     */
    parseMonthKey(monthKey) {
        if (!monthKey || typeof monthKey !== 'string') {
            throw new Error('Invalid month key');
        }
        const parts = monthKey.split('-');
        if (parts.length !== 2) {
            throw new Error('Invalid month key format');
        }
        return {
            year: parseInt(parts[0], 10),
            month: parseInt(parts[1], 10)
        };
    },

    /**
     * Get month name from month number
     * @param {number} monthNumber - Month number (1-12)
     * @returns {string} Month name
     */
    getMonthName(monthNumber) {
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        if (monthNumber < 1 || monthNumber > 12) {
            throw new Error('Invalid month number');
        }
        return monthNames[monthNumber - 1] || '';
    },

    /**
     * Create a new month with default structure
     * @param {number} year - Year
     * @param {number} month - Month (1-12)
     * @param {Object} settings - Settings object with defaults
     * @returns {Object} New month data object
     */
    createNewMonth(year, month, settings = {}) {
        if (!year || !month || month < 1 || month > 12) {
            throw new Error('Invalid year or month');
        }

        const monthKey = this.generateMonthKey(year, month);
        const monthName = this.getMonthName(month);

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);

        const defaultVariableCategories = settings.defaultVariableCategories || ['Food', 'Travel/Transport', 'Activities'];
        const variableCosts = defaultVariableCategories.map(category => ({
            category: category,
            estimatedAmount: 0,
            actualAmount: 0,
            comments: ''
        }));

        const newMonth = {
            key: monthKey,
            year: year,
            month: month,
            monthName: monthName,
            dateRange: {
                start: startDate.toISOString().split('T')[0],
                end: endDate.toISOString().split('T')[0]
            },
            weeklyBreakdown: [],
            fixedCosts: [],
            variableCosts: variableCosts,
            unplannedExpenses: [],
            incomeSources: [],
            pots: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        return newMonth;
    },

    /**
     * Calculate number of weeks in a month
     * @param {number} year - Year
     * @param {number} month - Month (1-12)
     * @returns {Array} Array of week objects with start and end dates
     */
    calculateWeeksInMonth(year, month) {
        const weeks = [];
        const firstDay = new Date(year, month - 1, 1);
        const lastDay = new Date(year, month, 0);
        const daysInMonth = lastDay.getDate();
        
        const firstDayOfWeek = firstDay.getDay();
        const daysToMonday = firstDayOfWeek === 0 ? -6 : 1 - firstDayOfWeek;
        
        let weekStartDay = 1 + daysToMonday;
        let weekEndDay = weekStartDay + 6;
        
        if (weekStartDay < 1) {
            weekStartDay = 1;
        }
        
        while (weekStartDay <= daysInMonth) {
            if (weekEndDay > daysInMonth) {
                weekEndDay = daysInMonth;
            }
            
            weeks.push({
                startDate: weekStartDay,
                endDate: weekEndDay,
                startFullDate: new Date(year, month - 1, weekStartDay),
                endFullDate: new Date(year, month - 1, weekEndDay),
                weekNumber: weeks.length + 1
            });
            
            weekStartDay = weekEndDay + 1;
            weekEndDay = weekStartDay + 6;
        }
        
        return weeks;
    }
};

if (typeof window !== 'undefined') {
    window.MonthFactory = MonthFactory;
}
