/**
 * Export Service
 * Handles exporting month data to various formats
 * @module services/ExportService
 */

const ExportService = {
    /**
     * Export month data to file
     * @param {string} monthKey - Month key
     * @param {Object} monthData - Month data object
     * @param {string} format - Export format ('json', 'csv', 'html')
     * @returns {Promise<boolean>} Success status
     */
    async exportMonthToFile(monthKey, monthData, format = 'json') {
        try {
            let blob;
            let filename;
            let mimeType;
            let fileExtension;
            
            if (format === 'csv') {
                if (!window.CSVHandler) {
                    console.error('CSVHandler not available. Cannot export CSV.');
                    return false;
                }
                const csvString = window.CSVHandler.monthDataToCSV(monthData);
                blob = new Blob([csvString], { type: 'text/csv' });
                filename = `${monthKey}.csv`;
                mimeType = 'text/csv';
                fileExtension = '.csv';
            } else if (format === 'html') {
                const htmlString = this.monthDataToHTML(monthData, monthKey);
                blob = new Blob([htmlString], { type: 'text/html' });
                filename = `${monthKey}.html`;
                mimeType = 'text/html';
                fileExtension = '.html';
            } else {
                const jsonString = JSON.stringify(monthData, null, 2);
                blob = new Blob([jsonString], { type: 'application/json' });
                filename = `${monthKey}.json`;
                mimeType = 'application/json';
                fileExtension = '.json';
            }
            
            if ('showSaveFilePicker' in window) {
                try {
                    const fileHandle = await window.showSaveFilePicker({
                        suggestedName: filename,
                        types: [{
                            description: format === 'csv' ? 'CSV files' : format === 'html' ? 'HTML files' : 'JSON files',
                            accept: { [mimeType]: [fileExtension] }
                        }],
                        startIn: 'downloads'
                    });
                    
                    const writable = await fileHandle.createWritable();
                    await writable.write(blob);
                    await writable.close();
                    
                    console.log(`✓ Month ${monthKey} saved as ${format.toUpperCase()} directly to file system`);
                    return true;
                } catch (error) {
                    if (error.name !== 'AbortError') {
                        console.warn('File System Access API failed, falling back to download:', error);
                    } else {
                        return false;
                    }
                }
            }
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);
            
            console.log(`✓ Month ${monthKey} downloaded as ${format.toUpperCase()}. Save it to data/months/ folder.`);
            return true;
        } catch (error) {
            console.error('Error exporting month file:', error);
            return false;
        }
    },

    /**
     * Save all months to files
     * @param {Object} allMonths - Object with all months
     * @returns {Promise<Object>} Result object
     */
    async saveAllMonthsToFiles(allMonths) {
        const monthKeys = Object.keys(allMonths);
        
        if (monthKeys.length === 0) {
            return { success: false, message: 'No months to save' };
        }
        
        try {
            const isFileProtocol = window.location.protocol === 'file:';
            
            if ('showDirectoryPicker' in window && !isFileProtocol) {
                try {
                    const directoryHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                    let savedCount = 0;
                    let errorCount = 0;
                    
                    for (const monthKey of monthKeys) {
                        try {
                            const monthData = allMonths[monthKey];
                            
                            const jsonString = JSON.stringify(monthData, null, 2);
                            const jsonBlob = new Blob([jsonString], { type: 'application/json' });
                            const jsonFileHandle = await directoryHandle.getFileHandle(`${monthKey}.json`, { create: true });
                            const jsonWritable = await jsonFileHandle.createWritable();
                            await jsonWritable.write(jsonBlob);
                            await jsonWritable.close();
                            
                            if (window.CSVHandler) {
                                try {
                                    const csvString = window.CSVHandler.monthDataToCSV(monthData);
                                    const csvBlob = new Blob([csvString], { type: 'text/csv' });
                                    const csvFileHandle = await directoryHandle.getFileHandle(`${monthKey}.csv`, { create: true });
                                    const csvWritable = await csvFileHandle.createWritable();
                                    await csvWritable.write(csvBlob);
                                    await csvWritable.close();
                                    console.log(`✓ Saved ${monthKey}.csv`);
                                } catch (csvError) {
                                    console.warn(`Could not save ${monthKey}.csv:`, csvError);
                                }
                            }
                            
                            savedCount++;
                            console.log(`✓ Saved ${monthKey}.json`);
                        } catch (error) {
                            console.error(`Error saving ${monthKey}:`, error);
                            errorCount++;
                        }
                    }
                    
                    return { 
                        success: savedCount > 0, 
                        count: savedCount, 
                        errors: errorCount,
                        message: `Saved ${savedCount} months to directory${errorCount > 0 ? ` (${errorCount} errors)` : ''}` 
                    };
                } catch (error) {
                    if (error.name !== 'AbortError') {
                        console.warn('Directory picker failed, falling back to downloads:', error);
                    } else {
                        return { success: false, message: 'User cancelled' };
                    }
                }
            }
            
            let downloadedCount = 0;
            const downloadPromises = [];
            
            for (const monthKey of monthKeys) {
                const monthData = allMonths[monthKey];
                downloadPromises.push(
                    this.exportMonthToFile(monthKey, monthData, 'json').then(() => {
                        downloadedCount++;
                    }).catch(error => {
                        console.error(`Error downloading ${monthKey}.json:`, error);
                    })
                );
                await new Promise(resolve => setTimeout(resolve, 200));
                
                if (window.CSVHandler) {
                    downloadPromises.push(
                        this.exportMonthToFile(monthKey, monthData, 'csv').then(() => {
                            // CSV download doesn't count separately
                        }).catch(error => {
                            console.warn(`Could not download ${monthKey}.csv:`, error);
                        })
                    );
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
            
            await Promise.all(downloadPromises);
            
            const fileTypeText = window.CSVHandler ? 'JSON and CSV files' : 'JSON files';
            return { 
                success: downloadedCount > 0, 
                count: downloadedCount,
                message: `Downloaded ${downloadedCount} month ${fileTypeText}${downloadedCount !== 1 ? 's' : ''}. Save ${downloadedCount === 1 ? 'it' : 'them'} to data/months/ folder.` 
            };
        } catch (error) {
            console.error('Error saving all months:', error);
            return { success: false, message: error.message };
        }
    },

    /**
     * Generate HTML representation of month data
     * @param {Object} monthData - Month data object
     * @param {string} monthKey - Month key
     * @returns {string} HTML string
     */
    monthDataToHTML(monthData, monthKey) {
        if (!window.Formatters || !window.CalculationService) {
            throw new Error('Formatters and CalculationService must be available');
        }

        const formatCurrency = (amount) => {
            if (amount === null || amount === undefined) return window.Formatters.formatCurrency(0);
            return window.Formatters.formatCurrency(amount);
        };

        const formatDate = (dateString) => {
            if (!dateString) return '';
            try {
                return new Date(dateString).toLocaleDateString('en-GB');
            } catch {
                return dateString;
            }
        };

        const monthName = monthData.monthName || this.getMonthName(monthData.month);
        const year = monthData.year;
        const totals = window.CalculationService.calculateMonthTotals(monthData);

        const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${monthName} ${year} - Monthly Budget</title>
    <style>
        html { -webkit-print-color-adjust: exact; }
        * { box-sizing: border-box; -webkit-print-color-adjust: exact; }
        html, body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.5; color: #333; }
        @media only screen { body { margin: 2em auto; max-width: 900px; background-color: #f8f9fa; } }
        body { white-space: pre-wrap; background-color: white; }
        .header { text-align: center; padding: 2rem 0; background: #667eea; color: white; margin-bottom: 2rem; }
        .header h1 { margin: 0; font-size: 2.5rem; font-weight: 300; }
        .header p { margin: 0.5rem 0 0 0; opacity: 0.9; }
        .section { margin-bottom: 2rem; background: white; border-radius: 0px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); overflow: hidden; }
        .section-header { background: #f8f9fa; padding: 1rem 1.5rem; border-bottom: 1px solid #e9ecef; }
        .section-title { margin: 0; font-size: 1.5rem; font-weight: 600; color: #495057; }
        table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid #e9ecef; }
        th { background-color: #f8f9fa; font-weight: 600; color: #495057; border-bottom: 2px solid #dee2e6; }
        .total-row { background-color: #fff3cd; font-weight: 600; }
        .total-row td { border-top: 2px solid #ffc107; }
        .summary-section { background: #28a745; color: white; }
        .summary-section .section-title { color: white; }
        .summary-section table { color: #333; }
        .summary-section .total-row { background-color: rgba(255,255,255,0.2); color: white; }
        .summary-section .total-row td { border-top: 2px solid rgba(255,255,255,0.5); }
        .export-info { background: #e9ecef; padding: 1rem; margin-top: 2rem; border-radius: 0px; font-size: 0.875rem; color: #6c757d; }
        .export-info strong { color: #495057; }
        @media print { body { background: white !important; margin: 0 !important; max-width: none !important; } .section { box-shadow: none !important; border: 1px solid #ddd !important; } .export-info { display: none; } }
    </style>
</head>
<body>
    <div class="header">
        <h1>${monthName} ${year}</h1>
        <p>Monthly Budget Report</p>
    </div>
    ${this.renderWeeklyBreakdownHTML(monthData, formatCurrency, formatDate)}
    ${this.renderHTMLSection('Income Sources', monthData.incomeSources, [
        { key: 'source', label: 'Source' },
        { key: 'estimated', label: 'Estimated', type: 'currency' },
        { key: 'actual', label: 'Actual', type: 'currency' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'description', label: 'Description' },
        { key: 'comments', label: 'Comments' }
    ], formatCurrency, formatDate, totals.income)}
    ${this.renderHTMLSection('Fixed Costs', monthData.fixedCosts, [
        { key: 'category', label: 'Category' },
        { key: 'estimatedAmount', label: 'Estimated', type: 'currency' },
        { key: 'actualAmount', label: 'Actual', type: 'currency' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'card', label: 'Card' },
        { key: 'paid', label: 'Paid', type: 'boolean' },
        { key: 'comments', label: 'Comments' }
    ], formatCurrency, formatDate, totals.fixedCosts)}
    ${this.renderHTMLSection('Variable Costs', monthData.variableCosts, [
        { key: 'category', label: 'Category' },
        { key: 'estimatedAmount', label: 'Budget', type: 'currency' },
        { key: 'actualAmount', label: 'Actual', type: 'currency' },
        { key: 'comments', label: 'Comments' }
    ], formatCurrency, formatDate, totals.variableCosts)}
    ${monthData.unplannedExpenses && monthData.unplannedExpenses.length > 0 ? this.renderHTMLSection('Unplanned Expenses', monthData.unplannedExpenses, [
        { key: 'name', label: 'Name' },
        { key: 'amount', label: 'Amount', type: 'currency' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'card', label: 'Card' },
        { key: 'status', label: 'Status' },
        { key: 'comments', label: 'Comments' }
    ], formatCurrency, formatDate, { actual: totals.unplannedExpenses.actual }) : ''}
    ${monthData.pots && monthData.pots.length > 0 ? this.renderHTMLSection('Savings & Investments', monthData.pots, [
        { key: 'category', label: 'Category' },
        { key: 'estimatedAmount', label: 'Estimated', type: 'currency' },
        { key: 'actualAmount', label: 'Actual', type: 'currency' }
    ], formatCurrency, formatDate, totals.pots) : ''}
    ${this.renderSummarySection(totals, formatCurrency)}
    <div class="export-info">
        <strong>Export Details:</strong><br>
        Generated on ${new Date().toLocaleString()}<br>
        Format: HTML Report<br>
        Source: Money Tracker Application
    </div>
</body>
</html>`;

        return html;
    },

    /**
     * Render weekly breakdown HTML with dynamic variable cost categories
     * @private
     */
    renderWeeklyBreakdownHTML(monthData, formatCurrency, formatDate) {
        if (!monthData.weeklyBreakdown || monthData.weeklyBreakdown.length === 0) return '';

        // Get dynamic categories from variable costs
        const categories = monthData.variableCosts && monthData.variableCosts.length > 0
            ? monthData.variableCosts.map(cost => cost.category)
            : ['Groceries', 'Transport', 'Activities'];

        // Build columns dynamically
        const columns = [
            { key: 'dateRange', label: 'Date Range' },
            { key: 'paymentsDue', label: 'Payments Due' }
        ];

        categories.forEach(category => {
            columns.push({ key: category, label: category });
        });

        columns.push({ key: 'estimate', label: 'Estimate', type: 'currency' });
        columns.push({ key: 'actual', label: 'Actual', type: 'currency' });

        const rows = monthData.weeklyBreakdown.map(item => {
            const cells = columns.map(col => {
                let value = item[col.key] || item[col.key.toLowerCase()] || '';
                if (col.type === 'currency') {
                    value = formatCurrency(value);
                } else if (typeof value === 'string') {
                    // Preserve line breaks for display
                    value = value.replace(/\n/g, '<br>');
                }
                return `<td>${value}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');

        return `
    <div class="section">
        <div class="section-header">
            <h2 class="section-title">Weekly Breakdown</h2>
        </div>
        <table>
            <thead>
                <tr>${columns.map(col => `<th>${col.label}</th>`).join('')}</tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    </div>`;
    },

    /**
     * Render HTML section for a data array
     * @private
     */
    renderHTMLSection(title, items, columns, formatCurrency, formatDate, totals = null) {
        if (!items || items.length === 0) return '';

        const rows = items.map(item => {
            const cells = columns.map(col => {
                let value = item[col.key];
                if (col.type === 'currency') {
                    value = formatCurrency(value);
                } else if (col.type === 'date') {
                    value = formatDate(value);
                } else if (col.type === 'boolean') {
                    value = value ? '✓' : '';
                }
                return `<td>${value || ''}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');

        let totalRow = '';
        if (totals) {
            const totalCells = columns.map((col, idx) => {
                if (idx === 0) return '<td><strong>Total</strong></td>';
                if (col.type === 'currency') {
                    const totalValue = totals.estimated !== undefined ? totals.estimated : totals.actual;
                    return `<td><strong>${formatCurrency(totalValue)}</strong></td>`;
                }
                return '<td></td>';
            }).join('');
            totalRow = `<tr class="total-row">${totalCells}</tr>`;
        }

        return `
    <div class="section">
        <div class="section-header">
            <h2 class="section-title">${title}</h2>
        </div>
        <table>
            <thead>
                <tr>${columns.map(col => `<th>${col.label}</th>`).join('')}</tr>
            </thead>
            <tbody>
                ${rows}
                ${totalRow}
            </tbody>
        </table>
    </div>`;
    },

    /**
     * Render summary section
     * @private
     */
    renderSummarySection(totals, formatCurrency) {
        return `
    <div class="section summary-section">
        <div class="section-header">
            <h2 class="section-title">Monthly Summary</h2>
        </div>
        <table>
            <thead>
                <tr>
                    <th>Category</th>
                    <th>Estimated</th>
                    <th>Actual</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>Total Income</strong></td>
                    <td><strong>${formatCurrency(totals.income.estimated)}</strong></td>
                    <td><strong>${formatCurrency(totals.income.actual)}</strong></td>
                </tr>
                <tr>
                    <td>Total Fixed Costs</td>
                    <td>${formatCurrency(totals.fixedCosts.estimated)}</td>
                    <td>${formatCurrency(totals.fixedCosts.actual)}</td>
                </tr>
                <tr>
                    <td>Total Variable Costs</td>
                    <td>${formatCurrency(totals.variableCosts.estimated)}</td>
                    <td>${formatCurrency(totals.variableCosts.actual)}</td>
                </tr>
                <tr>
                    <td><strong>Total Expenses</strong></td>
                    <td><strong>${formatCurrency(totals.expenses.estimated)}</strong></td>
                    <td><strong>${formatCurrency(totals.expenses.actual)}</strong></td>
                </tr>
                <tr>
                    <td>Total Unplanned Expenses</td>
                    <td>—</td>
                    <td>${formatCurrency(totals.unplannedExpenses.actual)}</td>
                </tr>
                <tr class="total-row">
                    <td><strong>Grand Savings Total</strong></td>
                    <td><strong>${formatCurrency(totals.savings.estimated)}</strong></td>
                    <td><strong>${formatCurrency(totals.savings.actual)}</strong></td>
                </tr>
            </tbody>
        </table>
    </div>`;
    },

    /**
     * Get month name from month number
     * @private
     */
    getMonthName(monthNumber) {
        const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        return monthNames[monthNumber - 1] || '';
    }
};

if (typeof window !== 'undefined') {
    window.ExportService = ExportService;
}
