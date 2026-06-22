/**
 * CSV Handler Utility
 * Handles conversion between month data and CSV format
 * Supports dynamic variable cost categories in weekly breakdown
 */

const CSVHandler = {
    /**
     * Get dynamic variable cost category names from month data
     * @param {Object} monthData - Month data object
     * @returns {Array} Array of category names
     */
    getVariableCostCategories(monthData) {
        if (!monthData.variableCosts || !Array.isArray(monthData.variableCosts)) {
            return ['Groceries', 'Transport', 'Activities'];
        }
        return monthData.variableCosts.map(cost => cost.category);
    },

    /**
     * Convert month data to CSV format
     * Handles dynamic variable cost categories
     */
    monthDataToCSV(monthData) {
        const lines = [];
        const categories = this.getVariableCostCategories(monthData);
        
        // Header line
        lines.push('Section,Category,Field,Value,Date,Card,Paid,Description,Comments');
        
        // Weekly Breakdown - with dynamic categories
        if (monthData.weeklyBreakdown && monthData.weeklyBreakdown.length > 0) {
            monthData.weeklyBreakdown.forEach((week, index) => {
                lines.push(`Weekly Breakdown,Week ${index + 1},Date Range,"${week.dateRange || week.weekRange || ''}",,,,`);
                lines.push(`Weekly Breakdown,Week ${index + 1},Payments Due,"${this.escapeCSV(week.paymentsDue || '')}",,,,`);
                
                // Add dynamic category columns
                categories.forEach(category => {
                    const value = week[category] || week[category.toLowerCase()] || '';
                    lines.push(`Weekly Breakdown,Week ${index + 1},${category},"${this.escapeCSV(value)}",,,,`);
                });
                
                lines.push(`Weekly Breakdown,Week ${index + 1},Estimate,${week.estimate || week.weeklyEstimate || 0},,,,`);
                lines.push(`Weekly Breakdown,Week ${index + 1},Actual,${week.actual || 0},,,,`);
            });
        }
        
        // Income
        if (monthData.incomeSources && monthData.incomeSources.length > 0) {
            monthData.incomeSources.forEach((income, index) => {
                lines.push(`Income,${income.source || `Income ${index + 1}`},Source,"${this.escapeCSV(income.source || '')}",${income.date || ''},,,"${this.escapeCSV(income.description || '')}","${this.escapeCSV(income.comments || '')}"`);
                lines.push(`Income,${income.source || `Income ${index + 1}`},Estimated,${income.estimated || 0},${income.date || ''},,,,"${this.escapeCSV(income.comments || '')}"`);
                lines.push(`Income,${income.source || `Income ${index + 1}`},Actual,${income.actual || 0},${income.date || ''},,,,"${this.escapeCSV(income.comments || '')}"`);
            });
        }
        
        // Fixed Costs
        if (monthData.fixedCosts && monthData.fixedCosts.length > 0) {
            monthData.fixedCosts.forEach((cost) => {
                lines.push(`Fixed Costs,"${this.escapeCSV(cost.category || '')}",Estimated,${cost.estimatedAmount || 0},${cost.date || ''},${cost.card || ''},${cost.paid ? 'Yes' : 'No'},"","${this.escapeCSV(cost.comments || '')}"`);
                lines.push(`Fixed Costs,"${this.escapeCSV(cost.category || '')}",Actual,${cost.actualAmount || 0},${cost.date || ''},${cost.card || ''},${cost.paid ? 'Yes' : 'No'},"","${this.escapeCSV(cost.comments || '')}"`);
            });
        }
        
        // Variable Costs
        if (monthData.variableCosts && monthData.variableCosts.length > 0) {
            monthData.variableCosts.forEach((cost) => {
                lines.push(`Variable Costs,"${this.escapeCSV(cost.category || '')}",Monthly Budget,${cost.estimatedAmount || cost.monthlyBudget || 0},,,,,"${this.escapeCSV(cost.comments || '')}"`);
                lines.push(`Variable Costs,"${this.escapeCSV(cost.category || '')}",Actual Spent,${cost.actualAmount || cost.actualSpent || 0},,,,,"${this.escapeCSV(cost.comments || '')}"`);
            });
        }
        
        // Unplanned Expenses
        if (monthData.unplannedExpenses && monthData.unplannedExpenses.length > 0) {
            monthData.unplannedExpenses.forEach((expense) => {
                lines.push(`Unplanned Expenses,"${this.escapeCSV(expense.name || '')}",Amount,${expense.amount || 0},${expense.date || ''},${expense.card || ''},${expense.paid ? 'Yes' : 'No'},${expense.status || ''},"${this.escapeCSV(expense.comments || '')}"`);
            });
        }
        
        // Pots
        if (monthData.pots && monthData.pots.length > 0) {
            monthData.pots.forEach((pot) => {
                lines.push(`Pots,"${this.escapeCSV(pot.category || '')}",Estimated,${pot.estimatedAmount || 0},,,,`);
                lines.push(`Pots,"${this.escapeCSV(pot.category || '')}",Actual,${pot.actualAmount || 0},,,,`);
            });
        }
        
        return lines.join('\n');
    },

    /**
     * Escape special characters for CSV
     */
    escapeCSV(value) {
        if (!value) return '';
        return String(value).replace(/"/g, '""').replace(/\r?\n/g, '\\n');
    },

    /**
     * Unescape CSV special characters
     */
    unescapeCSV(value) {
        if (!value) return '';
        return String(value).replace(/\\n/g, '\n').replace(/""/g, '"');
    },

    /**
     * Parse CSV and convert to month data structure
     * Handles dynamic variable cost categories
     */
    csvToMonthData(csvText, monthName, year) {
        const lines = csvText.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
            throw new Error('CSV file is empty or invalid');
        }
        
        // Skip header line
        const dataLines = lines.slice(1);
        
        const monthData = {
            key: `${monthName.toLowerCase()}-${year}`,
            monthName: monthName,
            year: year,
            weeklyBreakdown: [],
            incomeSources: [],
            fixedCosts: [],
            variableCosts: [],
            unplannedExpenses: [],
            pots: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        // Parse CSV lines
        const weeklyBreakdownMap = new Map();
        const incomeMap = new Map();
        const fixedCostsMap = new Map();
        const variableCostsMap = new Map();
        const unplannedExpensesMap = new Map();
        const potsMap = new Map();
        
        // Track all unique categories found in weekly breakdown
        const weeklyCategories = new Set();
        
        dataLines.forEach(line => {
            // Parse CSV line (handle quoted fields)
            const fields = this.parseCSVLine(line);
            if (fields.length < 4) return;
            
            const section = fields[0] || '';
            const category = fields[1] || '';
            const field = fields[2] || '';
            const value = this.unescapeCSV(fields[3] || '');
            const date = fields[4] || '';
            const card = fields[5] || '';
            const paid = fields[6] || '';
            const description = fields[7] || '';
            const comments = fields[8] || '';
            
            if (section === 'Weekly Breakdown') {
                const weekKey = category;
                if (!weeklyBreakdownMap.has(weekKey)) {
                    weeklyBreakdownMap.set(weekKey, {
                        dateRange: '',
                        weekRange: '',
                        paymentsDue: '',
                        estimate: 0,
                        weeklyEstimate: 0,
                        actual: 0
                    });
                }
                const week = weeklyBreakdownMap.get(weekKey);
                
                if (field === 'Date Range') {
                    week.dateRange = value;
                    week.weekRange = value;
                } else if (field === 'Payments Due') {
                    week.paymentsDue = value;
                } else if (field === 'Estimate') {
                    week.estimate = parseFloat(value) || 0;
                    week.weeklyEstimate = parseFloat(value) || 0;
                } else if (field === 'Actual') {
                    week.actual = parseFloat(value) || 0;
                } else {
                    // Dynamic category (e.g., Groceries, Transport, Activities, etc.)
                    week[field] = value;
                    weeklyCategories.add(field);
                }
            }
            else if (section === 'Income') {
                const incomeKey = category;
                if (!incomeMap.has(incomeKey)) {
                    incomeMap.set(incomeKey, {
                        source: category,
                        estimated: 0,
                        actual: 0,
                        date: '',
                        description: '',
                        comments: ''
                    });
                }
                const income = incomeMap.get(incomeKey);
                
                if (field === 'Source') income.source = value || category;
                else if (field === 'Estimated') income.estimated = parseFloat(value) || 0;
                else if (field === 'Actual') income.actual = parseFloat(value) || 0;
                if (date) income.date = date;
                if (description) income.description = description;
                if (comments) income.comments = comments;
            }
            else if (section === 'Fixed Costs') {
                if (!fixedCostsMap.has(category)) {
                    fixedCostsMap.set(category, {
                        category: category,
                        estimatedAmount: 0,
                        actualAmount: 0,
                        date: '',
                        card: '',
                        paid: false,
                        comments: ''
                    });
                }
                const cost = fixedCostsMap.get(category);
                
                if (field === 'Estimated') cost.estimatedAmount = parseFloat(value) || 0;
                else if (field === 'Actual') cost.actualAmount = parseFloat(value) || 0;
                if (date) cost.date = date;
                if (card) cost.card = card;
                if (paid.toLowerCase() === 'yes') cost.paid = true;
                if (comments) cost.comments = comments;
            }
            else if (section === 'Variable Costs') {
                if (!variableCostsMap.has(category)) {
                    variableCostsMap.set(category, {
                        category: category,
                        estimatedAmount: 0,
                        actualAmount: 0,
                        comments: ''
                    });
                }
                const cost = variableCostsMap.get(category);
                
                if (field === 'Monthly Budget') cost.estimatedAmount = parseFloat(value) || 0;
                else if (field === 'Actual Spent') cost.actualAmount = parseFloat(value) || 0;
                if (comments) cost.comments = comments;
            }
            else if (section === 'Unplanned Expenses') {
                if (!unplannedExpensesMap.has(category)) {
                    unplannedExpensesMap.set(category, {
                        name: category,
                        amount: 0,
                        date: '',
                        card: '',
                        paid: false,
                        status: '',
                        comments: ''
                    });
                }
                const expense = unplannedExpensesMap.get(category);
                
                if (field === 'Amount') expense.amount = parseFloat(value) || 0;
                if (date) expense.date = date;
                if (card) expense.card = card;
                if (paid.toLowerCase() === 'yes') expense.paid = true;
                if (description) expense.status = description;
                if (comments) expense.comments = comments;
            }
            else if (section === 'Pots') {
                if (!potsMap.has(category)) {
                    potsMap.set(category, {
                        category: category,
                        estimatedAmount: 0,
                        actualAmount: 0
                    });
                }
                const pot = potsMap.get(category);
                
                if (field === 'Estimated') pot.estimatedAmount = parseFloat(value) || 0;
                else if (field === 'Actual') pot.actualAmount = parseFloat(value) || 0;
            }
        });
        
        // Convert maps to arrays
        monthData.weeklyBreakdown = Array.from(weeklyBreakdownMap.values());
        monthData.incomeSources = Array.from(incomeMap.values());
        monthData.fixedCosts = Array.from(fixedCostsMap.values());
        monthData.variableCosts = Array.from(variableCostsMap.values());
        monthData.unplannedExpenses = Array.from(unplannedExpensesMap.values());
        monthData.pots = Array.from(potsMap.values());

        // If no variable costs were defined but we found categories in weekly breakdown, create them
        if (monthData.variableCosts.length === 0 && weeklyCategories.size > 0) {
            weeklyCategories.forEach(category => {
                monthData.variableCosts.push({
                    category: category,
                    estimatedAmount: 0,
                    actualAmount: 0,
                    comments: ''
                });
            });
        }
        
        return monthData;
    },

    /**
     * Parse a CSV line handling quoted fields
     */
    parseCSVLine(line) {
        const fields = [];
        let currentField = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote
                    currentField += '"';
                    i++;
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                // Field separator
                fields.push(currentField);
                currentField = '';
            } else {
                currentField += char;
            }
        }
        
        // Add last field
        fields.push(currentField);
        
        return fields;
    }
};

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CSVHandler;
}

// Make available globally
if (typeof window !== 'undefined') {
    window.CSVHandler = CSVHandler;
}
