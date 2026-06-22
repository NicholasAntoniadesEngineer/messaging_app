/**
 * Reference Importer Utility
 * Parses reference HTML files and imports data into the application
 */

const ReferenceImporter = {
    /**
     * Parse a reference HTML file and extract month data
     */
    parseReferenceHTML(htmlContent, monthName, year) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        
        const fixedCosts = this.extractFixedCosts(doc);
        const monthData = {
            year: year,
            month: this.getMonthNumber(monthName),
            monthName: monthName,
            weeklyBreakdown: this.extractWeeklyBreakdown(doc, fixedCosts),
            income: this.extractIncome(doc),
            fixedCosts: fixedCosts,
            variableCosts: this.extractVariableCosts(doc),
            unplannedExpenses: this.extractUnplannedExpenses(doc),
            pots: this.extractPots(doc),
            dateRange: this.extractDateRange(doc, year, this.getMonthNumber(monthName))
        };

        return monthData;
    },

    /**
     * Get month number from month name
     */
    getMonthNumber(monthName) {
        const months = {
            'January': 1, 'February': 2, 'March': 3, 'April': 4,
            'May': 5, 'June': 6, 'July': 7, 'August': 8,
            'September': 9, 'October': 10, 'November': 11, 'December': 12
        };
        return months[monthName] || 1;
    },

    /**
     * Extract weekly breakdown table - the first table with Date, Payments Due, Groceries, Transport, Activities columns
     */
    extractWeeklyBreakdown(doc, fixedCosts = []) {
        const weeklyBreakdown = [];
        const tables = doc.querySelectorAll('table.simple-table');
        
        if (tables.length === 0) {
            return [];
        }

        let weeklyTable = null;
        for (let i = 0; i < tables.length; i++) {
            const table = tables[i];
            const headerRow = table.querySelector('thead tr');
            if (!headerRow) continue;

            const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim());
            const hasDate = headers.some(h => h === 'Date' || h.includes('Date'));
            const hasPaymentsDue = headers.some(h => h.includes('Payments Due') || h.includes('Payments'));
            const hasGroceries = headers.some(h => h.includes('Groceries') || h.includes('Grocer'));
            const hasTransport = headers.some(h => h.includes('Transport') || h.includes('Transport'));
            const hasActivities = headers.some(h => h.includes('Activities') || h.includes('Activities'));
            const hasEstimate = headers.some(h => h.includes('Estimate') || h.includes('Est'));
            const hasActual = headers.some(h => h === 'Actual' || h.includes('Actual'));

            // This is the working section table - first table with Date, Payments Due, Groceries, Transport, Activities
            if (hasDate && hasPaymentsDue && (hasGroceries || hasTransport || hasActivities) && hasEstimate && hasActual) {
                weeklyTable = table;
                break;
            }
        }

        if (weeklyTable) {
            const rows = weeklyTable.querySelectorAll('tbody tr');

            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('th, td'));
                if (cells.length >= 5) {
                    const dateRange = cells[0].textContent.trim();
                    // Skip empty rows and totals row
                    if (dateRange && !dateRange.includes('TOTALS') && dateRange !== '' && !dateRange.match(/^\s*$/)) {
                        // Find column indices based on headers
                        const headerRow = weeklyTable.querySelector('thead tr');
                        const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim());
                        
                        let paymentsDueIdx = -1;
                        let groceriesIdx = -1;
                        let transportIdx = -1;
                        let activitiesIdx = -1;
                        let estimateIdx = -1;
                        let actualIdx = -1;
                        let unplannedIdx = -1;
                        
                        headers.forEach((header, idx) => {
                            if (header.includes('Payments Due') || header.includes('Payments')) paymentsDueIdx = idx;
                            else if (header.includes('Unplanned')) unplannedIdx = idx;
                            else if (header.includes('Groceries') || header.includes('Grocer')) groceriesIdx = idx;
                            else if (header.includes('Transport')) transportIdx = idx;
                            else if (header.includes('Activities')) activitiesIdx = idx;
                            else if (header.includes('Estimate') || header.includes('Est')) estimateIdx = idx;
                            else if (header === 'Actual' || header.includes('Actual')) actualIdx = idx;
                        });
                        
                        // Extract data from cells
                        const paymentsDue = paymentsDueIdx >= 0 && cells[paymentsDueIdx] ? cells[paymentsDueIdx].textContent.trim() : '';
                        const groceries = groceriesIdx >= 0 && cells[groceriesIdx] ? cells[groceriesIdx].textContent.trim() : '';
                        const transport = transportIdx >= 0 && cells[transportIdx] ? cells[transportIdx].textContent.trim() : '';
                        const activities = activitiesIdx >= 0 && cells[activitiesIdx] ? cells[activitiesIdx].textContent.trim() : '';
                        const estimate = estimateIdx >= 0 && cells[estimateIdx] ? this.parseAmount(cells[estimateIdx].textContent || '') : 0;
                        const actual = actualIdx >= 0 && cells[actualIdx] ? this.parseAmount(cells[actualIdx].textContent || '') : 0;

                        weeklyBreakdown.push({
                            dateRange: dateRange,
                            weekRange: dateRange,
                            paymentsDue: paymentsDue,
                            groceries: groceries,
                            transport: transport,
                            activities: activities,
                            estimate: estimate,
                            weeklyEstimate: estimate,
                            actual: actual
                        });
                    }
                }
            });
        }

        // If no weeks found, return empty array (will be populated by user)
        return weeklyBreakdown;
    },


    /**
     * Extract date range from document
     */
    extractDateRange(doc, year, month) {
        const timeElement = doc.querySelector('time');
        if (timeElement) {
            const dateText = timeElement.textContent;
            const match = dateText.match(/(\w+)\s+(\d+),\s+(\d+)\s+→\s+(\w+)\s+(\d+),\s+(\d+)/);
            if (match) {
                const startDate = new Date(year, month - 1, 1);
                const endDate = new Date(year, month, 0);
                return {
                    start: startDate.toISOString().split('T')[0],
                    end: endDate.toISOString().split('T')[0]
                };
            }
        }
        
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        return {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0]
        };
    },

    /**
     * Extract income data
     */
    extractIncome(doc) {
        const income = {
            nicholasIncome: { estimated: 0, actual: 0, date: '' },
            laraIncome: { estimated: 0, actual: 0, date: '' },
            otherIncome: { estimated: 0, actual: 0, description: '' }
        };

        const tables = doc.querySelectorAll('table.simple-table');
        tables.forEach(table => {
            // Check if this is the income table (has "Revenue Source" header)
            const headerRow = table.querySelector('thead tr');
            let isIncomeTable = false;
            let estimatedIdx = 1;
            let actualIdx = 2;
            let dateIdx = 3;
            
            if (headerRow) {
                const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
                isIncomeTable = headers.some(h => h.includes('revenue') || h.includes('income'));
                if (isIncomeTable) {
                    headers.forEach((header, idx) => {
                        if (header.includes('estimate') || header.includes('estimated')) {
                            estimatedIdx = idx;
                        } else if (header.includes('actual')) {
                            actualIdx = idx;
                        } else if (header.includes('date')) {
                            dateIdx = idx;
                        }
                    });
                }
            }
            
            if (isIncomeTable) {
            const rows = table.querySelectorAll('tbody tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                if (cells.length >= 3) {
                    const source = cells[0].textContent.trim();
                        const estimated = estimatedIdx < cells.length ? this.parseAmount(cells[estimatedIdx].textContent) : 0;
                        const actual = actualIdx < cells.length ? this.parseAmount(cells[actualIdx].textContent) : 0;
                        const date = dateIdx < cells.length ? cells[dateIdx].textContent.trim() : '';

                    if (source.includes('Nicholas Income')) {
                        income.nicholasIncome.estimated = estimated;
                        income.nicholasIncome.actual = actual;
                        income.nicholasIncome.date = date;
                    } else if (source.includes('Lara Income')) {
                        income.laraIncome.estimated = estimated;
                        income.laraIncome.actual = actual;
                        income.laraIncome.date = date;
                    } else if (source.includes('Other Income')) {
                        income.otherIncome.estimated = estimated;
                        income.otherIncome.actual = actual;
                        income.otherIncome.description = source;
                    }
                }
            });
            }
        });

        return income;
    },

    /**
     * Find section heading for a table (walks backwards through DOM tree)
     */
    findSectionHeading(table, sectionName) {
        const sectionNameLower = sectionName.toLowerCase();
        const sectionNames = ['fixed costs', 'variable costs', 'unplanned', 'pots', 'investments', 'expenses vs income', 'savings and investments'];
        
        // Walk backwards through the DOM tree
        let current = table;
        let foundMatchingHeading = null;
        let depth = 0;
        const maxDepth = 50;
        
        while (current && depth < maxDepth) {
            // Check previous siblings
            let sibling = current.previousElementSibling;
            let siblingDepth = 0;
            while (sibling && siblingDepth < 20) {
                // Check if it's a heading
                const tagName = sibling.tagName ? sibling.tagName.toLowerCase() : '';
                if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
                    const text = (sibling.textContent || '').toLowerCase();
                    if (text.includes(sectionNameLower)) {
                        foundMatchingHeading = sibling;
                        break;
                    }
                    // Check if it's another section heading
                    for (const otherSection of sectionNames) {
                        if (otherSection !== sectionNameLower && text.includes(otherSection)) {
                            // Found another section - stop searching
                            return foundMatchingHeading !== null;
                        }
                    }
                }
                
                // Also check inside divs
                if (tagName === 'div') {
                    const headings = sibling.querySelectorAll('h1, h2, h3');
                    for (const heading of headings) {
                        const text = (heading.textContent || '').toLowerCase();
                        if (text.includes(sectionNameLower)) {
                            foundMatchingHeading = heading;
                            break;
                        }
                        for (const otherSection of sectionNames) {
                            if (otherSection !== sectionNameLower && text.includes(otherSection)) {
                                return foundMatchingHeading !== null;
                            }
                        }
                    }
                }
                
                sibling = sibling.previousElementSibling;
                siblingDepth++;
            }
            
            if (foundMatchingHeading) {
                return true;
            }
            
            // Move to parent and continue searching
            current = current.parentElement;
            depth++;
        }
        
        return false;
    },

    /**
     * Extract fixed costs
     */
    extractFixedCosts(doc) {
        const fixedCosts = [];
        const tables = doc.querySelectorAll('table.simple-table');
        
        console.log('Extracting fixed costs from ' + tables.length + ' tables');
        
        tables.forEach((table, tableIdx) => {
            // Check if this table is in the Fixed Costs section
            const isFixedCostsTable = this.findSectionHeading(table, 'Fixed Costs');
            if (!isFixedCostsTable) {
                return;
            }

            console.log('Found Fixed Costs table #' + tableIdx);

            // Get header row to determine column order
            const headerRow = table.querySelector('thead tr');
            let estimatedIdx = -1;
            let actualIdx = -1;
            let dateIdx = -1;
            let cardIdx = -1;
            
            if (headerRow) {
                const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
                console.log('Fixed Costs headers:', headers);
                headers.forEach((header, idx) => {
                    if (header.includes('estimate') || header.includes('estimated')) {
                        estimatedIdx = idx;
                    } else if (header.includes('actual')) {
                        actualIdx = idx;
                    } else if (header.includes('date')) {
                        dateIdx = idx;
                    } else if (header.includes('card')) {
                        cardIdx = idx;
                    }
                });
                console.log('Fixed Costs column indices - estimated:', estimatedIdx, 'actual:', actualIdx, 'date:', dateIdx);
            }

                const rows = table.querySelectorAll('tbody tr');
            console.log('Processing ' + rows.length + ' fixed cost rows');
            rows.forEach((row, rowIdx) => {
                    const cells = row.querySelectorAll('td');
                if (cells.length >= 2) {
                        const category = cells[0].textContent.trim();
                    if (category && !category.includes('Total') && !category.includes('Subscriptions') && category !== '' && category !== 'Category' && !category.startsWith('<')) {
                        let estimated = estimatedIdx >= 0 && estimatedIdx < cells.length ? this.parseAmount(cells[estimatedIdx].textContent) : 0;
                        let actual = actualIdx >= 0 && actualIdx < cells.length ? this.parseAmount(cells[actualIdx].textContent) : 0;
                        
                        // Handle special cases like "(Skipped for some reason)" - if estimated is 0 but actual has value, try to get estimated from actual
                        if (estimated === 0 && actual > 0 && estimatedIdx >= 0 && estimatedIdx < cells.length) {
                            const estimatedText = cells[estimatedIdx].textContent.trim();
                            if (estimatedText.includes('Skipped') || estimatedText.includes('skipped') || estimatedText === '') {
                                // Estimated is empty or skipped, keep actual value
                            }
                        }
                        const date = dateIdx >= 0 && dateIdx < cells.length ? cells[dateIdx].textContent.trim() : '';
                        const card = cardIdx >= 0 && cardIdx < cells.length ? cells[cardIdx].textContent.trim() : '';
                        const paid = (actualIdx >= 0 && actualIdx < cells.length && cells[actualIdx]?.textContent.includes('✓')) || 
                                   (estimatedIdx >= 0 && estimatedIdx < cells.length && cells[estimatedIdx]?.textContent.includes('✓')) || false;

                        if (category && (estimated > 0 || actual > 0)) {
                                fixedCosts.push({
                                    category: category,
                                    estimatedAmount: estimated,
                                    actualAmount: actual,
                                    date: date,
                                    card: card,
                                    paid: paid
                                });
                            console.log('  Added fixed cost: ' + category + ' (est: ' + estimated + ', actual: ' + actual + ')');
                            }
                        }
                    }
                });
        });

        console.log('Extracted ' + fixedCosts.length + ' fixed costs');
        return fixedCosts;
    },

    /**
     * Extract variable costs - Food, Travel/Transport, and Activities
     */
    extractVariableCosts(doc) {
        const variableCosts = [];
        const tables = doc.querySelectorAll('table.simple-table');
        
        console.log('Extracting variable costs from ' + tables.length + ' tables');
        
        tables.forEach((table, tableIdx) => {
            // Check if this table is in the Variable Costs section
            const isVariableCostsTable = this.findSectionHeading(table, 'Variable Costs');
            if (!isVariableCostsTable) {
                return;
            }

            console.log('Found Variable Costs table #' + tableIdx);

            // Get header row to determine column order
            const headerRow = table.querySelector('thead tr');
            let estimatedIdx = -1;
            let actualIdx = -1;
            
            if (headerRow) {
                const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
                console.log('Variable Costs headers:', headers);
                headers.forEach((header, idx) => {
                    if (header.includes('estimate') || header.includes('estimated') || header.includes('budget')) {
                        estimatedIdx = idx;
                    } else if (header.includes('actual')) {
                        actualIdx = idx;
                    }
                });
                console.log('Variable Costs column indices - estimated:', estimatedIdx, 'actual:', actualIdx);
            }
            
                const rows = table.querySelectorAll('tbody tr');
            console.log('Processing ' + rows.length + ' variable cost rows');
            rows.forEach((row, rowIdx) => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                        const category = cells[0].textContent.trim();
                    if (category && !category.includes('Total') && !category.includes('Books') && category !== '' && category !== 'Category' && !category.startsWith('<')) {
                        const monthlyBudget = estimatedIdx >= 0 && estimatedIdx < cells.length ? this.parseAmount(cells[estimatedIdx].textContent) : 0;
                        const actualSpent = actualIdx >= 0 && actualIdx < cells.length ? this.parseAmount(cells[actualIdx].textContent) : 0;

                        // Normalize category names
                        let normalizedCategory = category;
                        if (category.includes('Food')) {
                            normalizedCategory = 'Food';
                        } else if (category.includes('Travel') || category.includes('Transport')) {
                            normalizedCategory = 'Travel/Transport';
                        } else if (category.includes('Activities')) {
                            normalizedCategory = 'Activities';
                        }

                        if (normalizedCategory === 'Food' || normalizedCategory === 'Travel/Transport' || normalizedCategory === 'Activities') {
                                variableCosts.push({
                                    category: normalizedCategory,
                                    estimatedAmount: monthlyBudget,
                                    actualAmount: actualSpent
                                });
                            console.log('  Added variable cost: ' + normalizedCategory + ' (budget: ' + monthlyBudget + ', actual: ' + actualSpent + ')');
                            }
                        }
                    }
                });
        });

        // Ensure we have at least Food and Activities
        const hasFood = variableCosts.some(vc => vc.category === 'Food');
        const hasActivities = variableCosts.some(vc => vc.category === 'Activities');
        
        if (!hasFood) {
            variableCosts.push({ category: 'Food', estimatedAmount: 0, actualAmount: 0 });
        }
        if (!hasActivities) {
            variableCosts.push({ category: 'Activities', estimatedAmount: 0, actualAmount: 0 });
        }

        console.log('Extracted ' + variableCosts.length + ' variable costs');
        return variableCosts;
    },

    /**
     * Extract unplanned expenses
     */
    extractUnplannedExpenses(doc) {
        const unplannedExpenses = [];
        const tables = doc.querySelectorAll('table.simple-table');
        
        console.log('Extracting unplanned expenses from ' + tables.length + ' tables');
        
        tables.forEach((table, tableIdx) => {
            // Check if this table is in the Unplanned Expenses section
            const isUnplannedTable = this.findSectionHeading(table, 'Unplanned');
            if (!isUnplannedTable) {
                return;
            }

            console.log('Found Unplanned Expenses table #' + tableIdx);

            // Get header row to determine column order (if exists)
            const headerRow = table.querySelector('thead tr');
            let nameIdx = 0;
            let amountIdx = 1;
            let dateIdx = -1;
            let cardIdx = -1;
            let statusIdx = -1;
            
            if (headerRow) {
                const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
                console.log('Unplanned Expenses headers:', headers);
                headers.forEach((header, idx) => {
                    if (header.includes('name') || header.includes('description')) {
                        nameIdx = idx;
                    } else if (header.includes('amount')) {
                        amountIdx = idx;
                    } else if (header.includes('date')) {
                        dateIdx = idx;
                    } else if (header.includes('card')) {
                        cardIdx = idx;
                    } else if (header.includes('status')) {
                        statusIdx = idx;
                    }
                });
            } else {
                // No header row - assume first column is name, second is amount
                console.log('No header row found, using default column order');
            }

                const rows = table.querySelectorAll('tbody tr');
            console.log('Processing ' + rows.length + ' unplanned expense rows');
            rows.forEach((row, rowIdx) => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                    const name = nameIdx < cells.length ? cells[nameIdx].textContent.trim() : '';
                    if (name && !name.includes('Total') && name !== '' && !name.startsWith('<')) {
                        const amount = amountIdx < cells.length ? this.parseAmount(cells[amountIdx].textContent) : 0;
                        const date = dateIdx >= 0 && dateIdx < cells.length ? cells[dateIdx].textContent.trim() : '';
                        const card = cardIdx >= 0 && cardIdx < cells.length ? cells[cardIdx].textContent.trim() : '';
                        const status = statusIdx >= 0 && statusIdx < cells.length ? cells[statusIdx].textContent.trim() : '';

                        if (name && amount > 0) {
                                unplannedExpenses.push({
                                    name: name,
                                    amount: amount,
                                    date: date,
                                card: card,
                                status: status
                                });
                            console.log('  Added unplanned expense: ' + name + ' (' + amount + ')');
                            }
                        }
                    }
                });
        });

        console.log('Extracted ' + unplannedExpenses.length + ' unplanned expenses');
        return unplannedExpenses;
    },

    /**
     * Extract pots
     */
    extractPots(doc) {
        const pots = [];
        const tables = doc.querySelectorAll('table.simple-table');
        
        console.log('Extracting pots from ' + tables.length + ' tables');
        
        tables.forEach((table, tableIdx) => {
            // Check if this table is in the Pots/Investments section
            const isPotsTable = this.findSectionHeading(table, 'Pots') || this.findSectionHeading(table, 'Investments');
            if (!isPotsTable) {
                return;
            }

            console.log('Found Pots/Investments table #' + tableIdx);

            // Get header row to determine column order
            const headerRow = table.querySelector('thead tr');
            let categoryIdx = 0;
            let estimatedIdx = -1;
            let actualIdx = -1;
            
            if (headerRow) {
                const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim().toLowerCase());
                console.log('Pots headers:', headers);
                headers.forEach((header, idx) => {
                    if (header.includes('category') || header.includes('name')) {
                        categoryIdx = idx;
                    } else if (header.includes('estimate') || header.includes('estimated')) {
                        estimatedIdx = idx;
                    } else if (header.includes('actual')) {
                        actualIdx = idx;
                    }
                });
                console.log('Pots column indices - category:', categoryIdx, 'estimated:', estimatedIdx, 'actual:', actualIdx);
            } else {
                // No header row - assume first column is category, second is estimated
                console.log('No header row found, using default column order');
            }

                const rows = table.querySelectorAll('tbody tr');
            console.log('Processing ' + rows.length + ' pot rows');
            rows.forEach((row, rowIdx) => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                    const category = categoryIdx < cells.length ? cells[categoryIdx].textContent.trim() : '';
                    if (category && !category.includes('Total') && !category.includes('Category') && category !== '' && !category.startsWith('<')) {
                        // If no estimated column found, use first data column after category
                        const estimated = estimatedIdx >= 0 && estimatedIdx < cells.length 
                            ? this.parseAmount(cells[estimatedIdx].textContent)
                            : (cells.length > 1 ? this.parseAmount(cells[1].textContent) : 0);
                        
                        // If no actual column, use estimated value
                        const actual = actualIdx >= 0 && actualIdx < cells.length 
                            ? this.parseAmount(cells[actualIdx].textContent)
                            : estimated;

                        if (category && estimated > 0) {
                                pots.push({
                                    category: category,
                                    estimatedAmount: estimated,
                                    actualAmount: actual
                                });
                            console.log('  Added pot: ' + category + ' (estimated: ' + estimated + ', actual: ' + actual + ')');
                            }
                        }
                    }
                });
        });

        console.log('Extracted ' + pots.length + ' pots');
        return pots;
    },

    /**
     * Parse amount from text (removes currency symbols and commas)
     */
    parseAmount(text) {
        if (!text) return 0;
        // Remove currency symbols, commas, and common text patterns
        let cleaned = text.replace(/[£€$,\s]/g, '').trim();
        // Remove text in parentheses like "(Skipped for some reason)"
        cleaned = cleaned.replace(/\([^)]*\)/g, '').trim();
        // Remove any remaining non-numeric characters except decimal point and minus
        cleaned = cleaned.replace(/[^\d.-]/g, '').trim();
        const parsed = parseFloat(cleaned);
        return isNaN(parsed) ? 0 : parsed;
    },

    /**
     * Import a month from reference HTML file
     */
    async importMonthFromFile(file, monthName, year) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const htmlContent = e.target.result;
                    const parsedData = this.parseReferenceHTML(htmlContent, monthName, year);
                    
                    const monthKey = DataManager.generateMonthKey(year, parsedData.month);
                    
                    const monthData = {
                        key: monthKey,
                        year: parsedData.year,
                        month: parsedData.month,
                        monthName: parsedData.monthName,
                        dateRange: parsedData.dateRange,
                        weeklyBreakdown: parsedData.weeklyBreakdown || [],
                        incomeSources: this.convertIncomeToArray(parsedData.income),
                        fixedCosts: parsedData.fixedCosts || [],
                        variableCosts: parsedData.variableCosts || [
                            { category: 'Food', monthlyBudget: 0, actualSpent: 0 },
                            { category: 'Activities', monthlyBudget: 0, actualSpent: 0 }
                        ],
                        unplannedExpenses: parsedData.unplannedExpenses || [],
                        pots: parsedData.pots || [],
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString()
                    };

                    // Save to localStorage and export file (files are source of truth)
                    const saved = DataManager.saveMonth(monthKey, monthData, true);
                    
                    if (saved) {
                        console.log(`✓ Month ${monthKey} saved to localStorage`);
                        console.log(`  - Fixed Costs: ${monthData.fixedCosts.length} items`);
                        console.log(`  - Variable Costs: ${monthData.variableCosts.length} items`);
                        console.log(`  - Unplanned Expenses: ${monthData.unplannedExpenses.length} items`);
                        console.log(`  - Weekly Breakdown: ${monthData.weeklyBreakdown.length} weeks`);
                        console.log(`  - Income Sources: ${monthData.incomeSources.length} items`);
                        console.log(`  - Pots: ${monthData.pots.length} items`);
                        console.log(`  - File download should start automatically. Save it to data/months/ folder.`);
                    } else {
                        console.error(`✗ Failed to save month ${monthKey} to localStorage`);
                    }
                    
                    resolve(monthData);
                } catch (error) {
                    reject(error);
                }
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    },

    /**
     * Convert old income format to new array format
     */
    convertIncomeToArray(income) {
        const incomeSources = [];
        
        if (income && typeof income === 'object') {
            if (income.nicholasIncome) {
                incomeSources.push({
                    source: 'Nicholas Income',
                    estimated: income.nicholasIncome.estimated || 0,
                    actual: income.nicholasIncome.actual || 0,
                    date: income.nicholasIncome.date || '',
                    description: ''
                });
            }
            if (income.laraIncome) {
                incomeSources.push({
                    source: 'Lara Income',
                    estimated: income.laraIncome.estimated || 0,
                    actual: income.laraIncome.actual || 0,
                    date: income.laraIncome.date || '',
                    description: ''
                });
            }
            if (income.otherIncome) {
                incomeSources.push({
                    source: 'Other Income',
                    estimated: income.otherIncome.estimated || 0,
                    actual: income.otherIncome.actual || 0,
                    date: '',
                    description: income.otherIncome.description || 'e.g., sales of cloths, household'
                });
            }
        }
        
        return incomeSources;
    }
};

// Make available globally
if (typeof window !== 'undefined') {
    window.ReferenceImporter = ReferenceImporter;
}

