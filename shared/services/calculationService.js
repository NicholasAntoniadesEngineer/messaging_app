/**
 * Calculation Service
 * Pure functions for all financial calculations
 * @module services/CalculationService
 */

const CalculationService = {
    /**
     * Calculate totals for a month
     * @param {Object} monthData - The month data object
     * @returns {Object} Totals object with estimated and actual values
     */
    calculateMonthTotals(monthData) {
        if (!monthData) {
            throw new Error('Month data is required for calculation');
        }

        const totals = {
            fixedCosts: { estimated: 0, actual: 0 },
            variableCosts: { estimated: 0, actual: 0 },
            unplannedExpenses: { actual: 0 },
            income: { estimated: 0, actual: 0 },
            pots: { estimated: 0, actual: 0 },
            expenses: { estimated: 0, actual: 0 },
            savings: { estimated: 0, actual: 0 }
        };

        if (monthData.fixedCosts && Array.isArray(monthData.fixedCosts)) {
            monthData.fixedCosts.forEach(cost => {
                totals.fixedCosts.estimated += this.parseNumber(cost.estimatedAmount || 0);
                totals.fixedCosts.actual += this.parseNumber(cost.actualAmount || 0);
            });
        }

        if (monthData.variableCosts && Array.isArray(monthData.variableCosts)) {
            monthData.variableCosts.forEach(cost => {
                totals.variableCosts.estimated += this.parseNumber(cost.monthlyBudget || cost.estimatedAmount || 0);
                totals.variableCosts.actual += this.parseNumber(cost.actualSpent || cost.actualAmount || 0);
            });
        }

        if (monthData.unplannedExpenses && Array.isArray(monthData.unplannedExpenses)) {
            monthData.unplannedExpenses.forEach(expense => {
                totals.unplannedExpenses.actual += this.parseNumber(expense.amount || 0);
            });
        }

        if (monthData.incomeSources && Array.isArray(monthData.incomeSources)) {
            monthData.incomeSources.forEach(income => {
                totals.income.estimated += this.parseNumber(income.estimated || 0);
                totals.income.actual += this.parseNumber(income.actual || 0);
            });
        } else if (monthData.income) {
            totals.income.estimated = 
                this.parseNumber(monthData.income.nicholasIncome?.estimated || 0) +
                this.parseNumber(monthData.income.laraIncome?.estimated || 0) +
                this.parseNumber(monthData.income.otherIncome?.estimated || 0);
            
            totals.income.actual = 
                this.parseNumber(monthData.income.nicholasIncome?.actual || 0) +
                this.parseNumber(monthData.income.laraIncome?.actual || 0) +
                this.parseNumber(monthData.income.otherIncome?.actual || 0);
        }

        if (monthData.pots && Array.isArray(monthData.pots)) {
            monthData.pots.forEach(pot => {
                totals.pots.estimated += this.parseNumber(pot.estimatedAmount || 0);
                totals.pots.actual += this.parseNumber(pot.actualAmount || 0);
            });
        }

        totals.expenses.estimated = totals.fixedCosts.estimated + totals.variableCosts.estimated;
        totals.expenses.actual = totals.fixedCosts.actual + totals.variableCosts.actual + totals.unplannedExpenses.actual;

        totals.savings.estimated = totals.income.estimated - totals.expenses.estimated - totals.pots.estimated;
        totals.savings.actual = totals.income.actual - totals.expenses.actual - totals.pots.actual;

        return totals;
    },

    /**
     * Calculate week totals from weekly breakdown
     * @param {Array} weeklyBreakdown - Array of week objects
     * @returns {Object} Totals for estimate and actual
     */
    calculateWeekTotals(weeklyBreakdown) {
        if (!Array.isArray(weeklyBreakdown)) {
            return { estimate: 0, actual: 0 };
        }

        const totals = weeklyBreakdown.reduce((acc, week) => {
            acc.estimate += this.parseNumber(week.estimate || week.weeklyEstimate || 0);
            acc.actual += this.parseNumber(week.actual || 0);
            return acc;
        }, { estimate: 0, actual: 0 });

        return totals;
    },

    /**
     * Calculate trend for a specific metric across months
     * @param {Array<string>} monthKeys - Sorted array of month keys
     * @param {Object} allMonths - Object containing all month data
     * @param {string} type - Type of metric ('income', 'expenses', 'savings')
     * @returns {Object} Trend data with average, percentage, and direction
     */
    calculateTrend(monthKeys, allMonths, type) {
        if (!Array.isArray(monthKeys) || monthKeys.length < 2) {
            return { average: 0, percentage: 0, direction: '→ Stable' };
        }

        const values = monthKeys.map(key => {
            const monthData = allMonths[key];
            if (!monthData) return 0;
            
            const totals = this.calculateMonthTotals(monthData);
            switch(type) {
                case 'income': return totals.income.actual;
                case 'expenses': return totals.expenses.actual;
                case 'savings': return totals.savings.actual;
                default: return 0;
            }
        });

        const average = values.reduce((a, b) => a + b, 0) / values.length;
        
        const firstHalf = values.slice(0, Math.floor(values.length / 2));
        const secondHalf = values.slice(Math.floor(values.length / 2));
        
        const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
        
        const percentage = firstAvg !== 0 ? ((secondAvg - firstAvg) / Math.abs(firstAvg)) * 100 : 0;
        const direction = percentage > 0 ? '↑ Increasing' : percentage < 0 ? '↓ Decreasing' : '→ Stable';

        return { average, percentage, direction };
    },

    /**
     * Calculate savings amount
     * @param {number} income - Total income
     * @param {number} expenses - Total expenses
     * @param {number} pots - Total pots/investments
     * @returns {number} Savings amount
     */
    calculateSavings(income, expenses, pots) {
        return this.parseNumber(income) - this.parseNumber(expenses) - this.parseNumber(pots);
    },

    /**
     * Parse number safely, returning 0 for invalid values
     * @param {*} value - Value to parse
     * @returns {number} Parsed number or 0
     */
    parseNumber(value) {
        const parsed = parseFloat(value || 0);
        return isNaN(parsed) ? 0 : parsed;
    }
};

if (typeof window !== 'undefined') {
    window.CalculationService = CalculationService;
}
