/**
 * Payment Service
 * Handles payment history and payment status tracking
 */

const PaymentService = {
    /**
     * Get database service (requires config)
     * @returns {Object} Database service
     * @throws {Error} If ConfigHelper is not available or database service is not configured
     */
    _getDatabaseService() {
        if (typeof ConfigHelper === 'undefined') {
            throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
        }
        return ConfigHelper.getDatabaseService(this);
    },
    
    /**
     * Get auth service (requires config)
     * @returns {Object} Auth service
     * @throws {Error} If ConfigHelper is not available or auth service is not configured
     */
    _getAuthService() {
        if (typeof ConfigHelper === 'undefined') {
            throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
        }
        return ConfigHelper.getAuthService(this);
    },
    
    /**
     * Get table name (requires config)
     * @param {string} tableKey - Table key
     * @returns {string} Table name
     * @throws {Error} If ConfigHelper is not available or table name is not configured
     */
    _getTableName(tableKey) {
        if (typeof ConfigHelper === 'undefined') {
            throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
        }
        return ConfigHelper.getTableName(this, tableKey);
    },
    
    /**
     * Record a payment in payment history
     * @param {string} userId - User ID
     * @param {Object} paymentData - Payment data
     * @returns {Promise<{success: boolean, payment: Object|null, error: string|null}>}
     */
    async recordPayment(userId, paymentData) {
        try {
            const databaseService = this._getDatabaseService();
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }
            
            const paymentRecord = {
                user_id: userId,
                subscription_id: paymentData.subscriptionId || null,
                stripe_payment_intent_id: paymentData.stripePaymentIntentId || null,
                stripe_charge_id: paymentData.stripeChargeId || null,
                stripe_invoice_id: paymentData.stripeInvoiceId || null,
                amount: paymentData.amount || 0,
                currency: paymentData.currency || 'eur',
                status: paymentData.status || 'pending',
                payment_method: paymentData.paymentMethod || null,
                payment_date: paymentData.paymentDate ? new Date(paymentData.paymentDate).toISOString() : new Date().toISOString(),
                refunded_amount: paymentData.refundedAmount || 0,
                refunded_date: paymentData.refundedDate ? new Date(paymentData.refundedDate).toISOString() : null,
                metadata: paymentData.metadata || {}
            };
            
            const tableName = this._getTableName('paymentHistory');
            const result = await databaseService.queryInsert(tableName, paymentRecord);
            
            if (result.error) {
                console.error('[PaymentService] Error recording payment:', result.error);
                return {
                    success: false,
                    payment: null,
                    error: result.error.message || 'Failed to record payment'
                };
            }
            
            const payment = result.data && result.data.length > 0 ? result.data[0] : null;
            
            console.log('[PaymentService] Payment recorded successfully:', {
                userId: userId,
                amount: paymentRecord.amount,
                status: paymentRecord.status
            });
            
            return {
                success: true,
                payment: payment,
                error: null
            };
        } catch (error) {
            console.error('[PaymentService] Exception recording payment:', error);
            return {
                success: false,
                payment: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Get payment history for current user
     * @param {number} limit - Maximum number of records to return
     * @returns {Promise<{success: boolean, payments: Array|null, error: string|null}>}
     */
    async getPaymentHistory(limit = 50) {
        try {
            const databaseService = this._getDatabaseService();
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }
            
            const authService = this._getAuthService();
            if (!authService) {
                throw new Error('AuthService not available');
            }
            
            const userId = await databaseService._getCurrentUserId();
            if (!userId) {
                return {
                    success: false,
                    payments: null,
                    error: 'User not authenticated'
                };
            }
            
            const tableName = this._getTableName('paymentHistory');
            const result = await databaseService.querySelect(tableName, {
                filter: { user_id: userId },
                order: [{ column: 'payment_date', ascending: false }],
                limit: limit
            });
            
            if (result.error) {
                console.error('[PaymentService] Error getting payment history:', result.error);
                return {
                    success: false,
                    payments: null,
                    error: result.error.message || 'Failed to get payment history'
                };
            }
            
            const payments = result.data || [];
            
            return {
                success: true,
                payments: payments,
                error: null
            };
        } catch (error) {
            console.error('[PaymentService] Exception getting payment history:', error);
            return {
                success: false,
                payments: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    },
    
    /**
     * Update payment status
     * @param {string} paymentId - Payment record ID
     * @param {string} status - New status
     * @returns {Promise<{success: boolean, payment: Object|null, error: string|null}>}
     */
    async updatePaymentStatus(paymentId, status) {
        try {
            const databaseService = this._getDatabaseService();
            if (!databaseService) {
                throw new Error('DatabaseService not available');
            }
            
            const updateData = {
                status: status
            };
            
            const tableName = this._getTableName('paymentHistory');
            const result = await databaseService.queryUpdate(tableName, paymentId, updateData);
            
            if (result.error) {
                console.error('[PaymentService] Error updating payment status:', result.error);
                return {
                    success: false,
                    payment: null,
                    error: result.error.message || 'Failed to update payment status'
                };
            }
            
            const payment = result.data && result.data.length > 0 ? result.data[0] : null;
            
            return {
                success: true,
                payment: payment,
                error: null
            };
        } catch (error) {
            console.error('[PaymentService] Exception updating payment status:', error);
            return {
                success: false,
                payment: null,
                error: error.message || 'An unexpected error occurred'
            };
        }
    }
};

if (typeof window !== 'undefined') {
    window.PaymentService = PaymentService;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PaymentService;
}

