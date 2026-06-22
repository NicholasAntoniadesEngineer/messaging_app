/**
 * Debug Tool for Missing Row Investigation
 *
 * This tool helps diagnose why specific rows (months) don't appear in the UI
 * even though they exist in the database or CSV exports.
 *
 * Usage:
 *   1. Open browser console on the monthly-budget page
 *   2. Run: await DebugMissingRow.investigateRow(6)
 *   3. Check the console output for diagnosis and solutions
 */

const DebugMissingRow = {
    /**
     * Investigate why a specific row is not appearing in the UI
     * @param {number} rowId - The ID of the row to investigate
     */
    async investigateRow(rowId) {
        console.group(`🔍 Investigating Row: id=${rowId}`);
        console.log('Started at:', new Date().toISOString());

        try {
            // 1. Direct database query (bypassing getAllMonths)
            console.log('\n--- Step 1: Direct Database Query ---');
            const { data, error } = await window.DatabaseService.querySelect(
                'user_months',
                { filter: { id: rowId }, limit: 1 }
            );

            console.log('Database query result:', {
                found: data?.length > 0,
                rowCount: data?.length || 0,
                error: error || null
            });

            if (data && data[0]) {
                console.log('Row data:', {
                    id: data[0].id,
                    user_id: data[0].user_id,
                    year: data[0].year,
                    month: data[0].month,
                    month_name: data[0].month_name,
                    created_at: data[0].created_at
                });
            }

            // 2. Check if row appears in getAllMonths()
            console.log('\n--- Step 2: Check getAllMonths() ---');
            const allMonths = await window.DataManager.getAllMonths(true, true);
            const monthKeys = Object.keys(allMonths);

            console.log('getAllMonths() returned:', {
                totalMonths: monthKeys.length,
                monthKeys: monthKeys
            });

            const foundInAllMonths = Object.entries(allMonths).find(([key, monthData]) =>
                monthData.id === rowId
            );

            console.log('Found in getAllMonths():', {
                found: !!foundInAllMonths,
                monthKey: foundInAllMonths ? foundInAllMonths[0] : null,
                data: foundInAllMonths ? foundInAllMonths[1] : null
            });

            // 3. Check current user ID
            console.log('\n--- Step 3: User Authentication Check ---');
            const currentUserId = await window.DatabaseService._getCurrentUserId();
            console.log('Current user ID:', currentUserId);

            // 4. Compare user IDs if row exists
            if (data && data[0]) {
                console.log('\n--- Step 4: User ID Comparison ---');
                const rowUserId = data[0].user_id;
                const isMatch = rowUserId === currentUserId;

                console.log('Row user_id:', rowUserId);
                console.log('Current user_id:', currentUserId);
                console.log('Match:', isMatch ? '✓ YES' : '✗ NO');
            }

            // 5. Validate JSONB structure if row exists
            if (data && data[0]) {
                console.log('\n--- Step 5: JSONB Structure Validation ---');
                const row = data[0];

                const jsonbFields = [
                    'weekly_breakdown',
                    'income_sources',
                    'fixed_costs',
                    'variable_costs',
                    'unplanned_expenses',
                    'pots'
                ];

                jsonbFields.forEach(field => {
                    const value = row[field];
                    const isValid = Array.isArray(value);
                    console.log(`${field}:`, {
                        isArray: isValid,
                        type: typeof value,
                        length: Array.isArray(value) ? value.length : 'N/A',
                        valid: isValid ? '✓' : '✗'
                    });
                });
            }

            // 6. Final Diagnosis
            console.log('\n--- Step 6: Diagnosis & Solutions ---');

            if (!data || data.length === 0) {
                console.error('❌ DIAGNOSIS: ROW DOES NOT EXIST in database');
                console.log('Possible causes:');
                console.log('  • Row was deleted');
                console.log('  • Row ID is incorrect');
                console.log('  • Database query is failing');
                console.log('\nSolution: Verify the row ID and check database directly');

            } else if (data[0].user_id !== currentUserId) {
                console.error('❌ DIAGNOSIS: RLS FILTERING - Row belongs to different user');
                console.log('\nRow owner:', data[0].user_id);
                console.log('Current user:', currentUserId);
                console.log('\nSolutions:');
                console.log('  Option 1 - Transfer ownership (SQL):');
                console.log(`    UPDATE user_months SET user_id = '${currentUserId}' WHERE id = ${rowId};`);
                console.log('\n  Option 2 - Create data share (JavaScript):');
                console.log(`    await window.DataSharingService.shareData(`);
                console.log(`      '${data[0].user_id}',  // Original owner`);
                console.log(`      '${currentUserId}',    // Current user`);
                console.log(`      { shareMonths: true, monthIds: [${rowId}], accessLevel: 'read_write' }`);
                console.log(`    );`);

            } else if (!foundInAllMonths) {
                console.error('❌ DIAGNOSIS: DATA TRANSFORMATION ISSUE');
                console.log('Row exists in database and belongs to current user, but not returned by getAllMonths()');
                console.log('\nPossible causes:');
                console.log('  • Invalid JSONB field structure (check Step 5 above)');
                console.log('  • Data transformation error in getAllMonths()');
                console.log('  • Month key format issue');
                console.log('\nSolution: Check JSONB fields above for validity');

            } else {
                console.log('✅ DIAGNOSIS: Row is accessible and properly loaded');
                console.log('Row appears in both database and getAllMonths()');
                console.log('\nIf row still not visible in UI:');
                console.log('  • Check UI rendering logic in MonthlyBudgetController');
                console.log('  • Verify month selector dropdown contains the option');
                console.log('  • Check for JavaScript errors in console');
                console.log(`  • Try manually loading: MonthlyBudgetController.loadMonth('${foundInAllMonths[0]}')`);
            }

        } catch (error) {
            console.error('❌ ERROR during investigation:', error);
            console.error('Stack trace:', error.stack);
        }

        console.log('\nInvestigation completed at:', new Date().toISOString());
        console.groupEnd();
    },

    /**
     * Quick check for multiple rows at once
     * @param {Array<number>} rowIds - Array of row IDs to check
     */
    async investigateMultiple(rowIds) {
        console.log(`Investigating ${rowIds.length} rows...`);

        for (const rowId of rowIds) {
            await this.investigateRow(rowId);
            console.log('\n' + '='.repeat(80) + '\n');
        }

        console.log('All investigations complete!');
    },

    /**
     * List all months accessible to current user
     */
    async listAllAccessibleMonths() {
        console.group('📋 All Accessible Months');

        const allMonths = await window.DataManager.getAllMonths(false, true);
        const monthKeys = Object.keys(allMonths).sort().reverse();

        console.log(`Total accessible months: ${monthKeys.length}`);
        console.table(
            monthKeys.map(key => {
                const month = allMonths[key];
                return {
                    key: key,
                    id: month.id,
                    year: month.year,
                    month: month.month,
                    name: month.monthName || month.month_name,
                    isShared: month.isShared || false,
                    isExample: month.year === 2045
                };
            })
        );

        console.groupEnd();
    }
};

// Make available globally
window.DebugMissingRow = DebugMissingRow;

console.log('%c[DebugMissingRow] Tool loaded successfully', 'color: green; font-weight: bold');
console.log('Usage: await DebugMissingRow.investigateRow(6)');
console.log('Help: await DebugMissingRow.listAllAccessibleMonths()');
