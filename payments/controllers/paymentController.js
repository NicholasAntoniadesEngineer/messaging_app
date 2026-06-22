/**
 * Payment Controller
 * Handles the payment/subscription page logic
 */

const PaymentController = {
    currentSubscription: null,
    currentPlan: null,
    paymentHistory: [],
    
    /**
     * Initialize the payment page
     */
    async init() {
        console.log('[PaymentController] Initializing payment page...');
        
        await this.loadSubscriptionData();
        await this.loadPaymentHistory();
        this.setupEventListeners();
        this.renderSubscriptionStatus();
        this.renderPaymentHistory();
    },
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        const startSubscriptionBtn = document.getElementById('start-subscription-button');
        if (startSubscriptionBtn) {
            startSubscriptionBtn.addEventListener('click', () => this.handleStartSubscription());
        }
        
        const refreshBtn = document.getElementById('refresh-subscription-button');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshSubscriptionData());
        }
        
        const managePaymentMethodBtn = document.getElementById('manage-payment-method-button');
        if (managePaymentMethodBtn) {
            managePaymentMethodBtn.addEventListener('click', () => this.handleManagePaymentMethod());
        }
    },
    
    /**
     * Load subscription data for current user
     */
    async loadSubscriptionData() {
        const methodStartTime = Date.now();
        console.log('[PaymentController] ========== loadSubscriptionData() CALLED ==========');
        
        try {
            if (!window.SubscriptionService) {
                const error = new Error('SubscriptionService not available');
                console.error('[PaymentController] ❌ loadSubscriptionData error:', error);
                throw error;
            }
            
            console.log('[PaymentController] loadSubscriptionData - calling SubscriptionService.getCurrentUserSubscription()...');
            const result = await window.SubscriptionService.getCurrentUserSubscription();
            const methodElapsed = Date.now() - methodStartTime;
            console.log(`[PaymentController] loadSubscriptionData - getCurrentUserSubscription() completed in ${methodElapsed}ms`);
            
            console.log('[PaymentController] loadSubscriptionData - result:', {
                success: result.success,
                hasSubscription: !!result.subscription,
                subscriptionStatus: result.subscription?.status,
                hasPlan: !!result.plan,
                planName: result.plan?.plan_name,
                hasError: !!result.error,
                errorMessage: result.error
            });
            
            if (result.success) {
                this.currentSubscription = result.subscription;
                this.currentPlan = result.plan;
                if (this.currentSubscription) {
                    console.log('[PaymentController] ✅ Subscription loaded successfully:', {
                        status: this.currentSubscription.status,
                        planId: this.currentSubscription.plan_id,
                        trialEnd: this.currentSubscription.trial_end,
                        currentPeriodEnd: this.currentSubscription.current_period_end,
                        planName: this.currentPlan?.plan_name || this.currentPlan?.name
                    });
                } else {
                    console.log('[PaymentController] ⚠️ Subscription query succeeded but returned null subscription');
                    console.log('[PaymentController] This means the user has NO subscription record in the database');
                }
            } else {
                console.error('[PaymentController] ❌ Failed to load subscription:', result.error);
                console.error('[PaymentController] loadSubscriptionData - error details:', {
                    error: result.error,
                    hasSubscription: !!result.subscription,
                    hasPlan: !!result.plan
                });
                this.currentSubscription = null;
                this.currentPlan = null;
            }
        } catch (error) {
            const methodElapsed = Date.now() - methodStartTime;
            console.error(`[PaymentController] ❌ Exception loading subscription after ${methodElapsed}ms:`, error);
            console.error('[PaymentController] loadSubscriptionData - exception details:', {
                message: error.message,
                name: error.name,
                stack: error.stack
            });
            this.currentSubscription = null;
        }
        
        const totalElapsed = Date.now() - methodStartTime;
        console.log(`[PaymentController] loadSubscriptionData completed in ${totalElapsed}ms`);
        console.log('[PaymentController] loadSubscriptionData - final currentSubscription:', {
            hasSubscription: !!this.currentSubscription,
            subscriptionStatus: this.currentSubscription?.status
        });
        console.log('[PaymentController] ========== loadSubscriptionData() COMPLETE ==========');
    },
    
    /**
     * Load payment history for current user
     */
    async loadPaymentHistory() {
        try {
            if (!window.PaymentService) {
                throw new Error('PaymentService not available');
            }
            
            const result = await window.PaymentService.getPaymentHistory(20);
            
            if (result.success) {
                this.paymentHistory = result.payments || [];
                console.log('[PaymentController] Payment history loaded:', this.paymentHistory.length, 'payments');
            } else {
                console.error('[PaymentController] Failed to load payment history:', result.error);
                this.paymentHistory = [];
            }
        } catch (error) {
            console.error('[PaymentController] Exception loading payment history:', error);
            this.paymentHistory = [];
        }
    },
    
    /**
     * Render subscription status
     */
    renderSubscriptionStatus() {
        console.log('[PaymentController] ========== renderSubscriptionStatus() CALLED ==========');
        const statusContainer = document.getElementById('subscription-status-container');
        const statusMessage = document.getElementById('subscription-status-message');
        const subscriptionSection = statusContainer ? statusContainer.closest('.subscription-section') : null;
        const subscriptionHeading = subscriptionSection ? subscriptionSection.querySelector('h2.section-title') : null;
        const startSubscriptionBtn = document.getElementById('start-subscription-button');
        const managePaymentMethodBtn = document.getElementById('manage-payment-method-button');
        const statusDiv = document.getElementById('subscription-status');
        const subscriptionDetailsContainer = document.getElementById('subscription-details');
        const subscriptionDetailsContent = document.getElementById('subscription-details-content');
        
        console.log('[PaymentController] Button elements found:', {
            hasStartBtn: !!startSubscriptionBtn,
            hasManagePaymentBtn: !!managePaymentMethodBtn
        });
        
        if (!statusContainer || !statusMessage) {
            return;
        }
        
            if (!this.currentSubscription) {
            statusMessage.textContent = 'No subscription found. Please subscribe to access the application.';
            statusMessage.className = 'subscription-message subscription-message-error';
            statusMessage.style.backgroundColor = 'rgba(181, 138, 138, 0.2)';
            statusMessage.style.border = 'var(--border-width-standard) solid var(--danger-color)';
            if (startSubscriptionBtn) {
                startSubscriptionBtn.style.display = 'block';
            }
            // Always show payment method button - users can add payment method even without subscription
            if (managePaymentMethodBtn) {
                managePaymentMethodBtn.style.display = 'block';
                managePaymentMethodBtn.textContent = 'Add Payment Method';
            }
            if (subscriptionDetailsContainer) {
                subscriptionDetailsContainer.style.display = 'none';
            }
            return;
        }
        
        const subscription = this.currentSubscription;
        const plan = this.currentPlan;
        
        const planName = plan ? (plan.plan_name || 'Standard') : 'Standard';
        
        console.log('[PaymentController] Subscription data:', {
            status: subscription.status,
            isPaid: subscription.status === 'active' && !!subscription.stripe_subscription_id,
            hasStripeCustomerId: !!subscription.stripe_customer_id,
            stripeCustomerId: subscription.stripe_customer_id,
            hasStripeSubscriptionId: !!subscription.stripe_subscription_id,
            stripeSubscriptionId: subscription.stripe_subscription_id
        });
        
        if (subscriptionHeading) {
            subscriptionHeading.textContent = 'Subscription';
        }
        
        let statusText = '';
        let statusClass = '';
        let statusBgColor = '';
        let statusBorderColor = '';
        
        if (subscription.status === 'trial') {
            const daysRemaining = window.SubscriptionService.getTrialDaysRemaining(subscription);
            const isExpired = window.SubscriptionService.isTrialExpired(subscription);
            
            if (isExpired) {
                statusText = 'Your trial has expired. Please subscribe to continue using the application.';
                statusClass = 'subscription-message-error';
                statusBgColor = 'rgba(181, 138, 138, 0.2)';
                statusBorderColor = 'var(--danger-color)';
                if (startSubscriptionBtn) {
                    startSubscriptionBtn.style.display = 'block';
                }
                // Always show payment method button, even for expired trials
                if (managePaymentMethodBtn) {
                    managePaymentMethodBtn.style.display = 'block';
                    managePaymentMethodBtn.textContent = subscription.stripe_customer_id ? 'Update Payment Method' : 'Add Payment Method';
                }
            } else {
                // Hide status message when subscription details are shown (details table has all info)
                statusText = '';
                statusClass = '';
                statusBgColor = 'transparent';
                statusBorderColor = 'transparent';
                if (startSubscriptionBtn) {
                    startSubscriptionBtn.style.display = 'none';
                }
                // Always show "Add Payment Method" button for trial users so they can convert to paid
                // If they already have a customer ID, they can update; otherwise we'll create one
                if (managePaymentMethodBtn) {
                    managePaymentMethodBtn.style.display = 'block';
                    // Change button text for trial users
                    if (!subscription.stripe_customer_id) {
                        managePaymentMethodBtn.textContent = 'Add Payment Method';
                    } else {
                        managePaymentMethodBtn.textContent = 'Update Payment Method';
                    }
                }
            }
        } else if (subscription.status === 'active') {
            const daysRemaining = window.SubscriptionService.getSubscriptionDaysRemaining(subscription);
            
            if (daysRemaining !== null && daysRemaining !== undefined) {
                if (daysRemaining === 0) {
                    statusText = `Your ${planName} subscription has expired. Please renew to continue.`;
                    statusClass = 'subscription-message-error';
                    statusBgColor = 'rgba(181, 138, 138, 0.2)';
                    statusBorderColor = 'var(--danger-color)';
                    if (startSubscriptionBtn) {
                        startSubscriptionBtn.style.display = 'block';
                    }
                } else {
                    // Hide status message when subscription details are shown (details table has all info)
                    statusText = '';
                    statusClass = '';
                    statusBgColor = 'transparent';
                    statusBorderColor = 'transparent';
                }
            } else {
                // Hide status message when subscription details are shown (details table has all info)
                statusText = '';
                statusClass = '';
                statusBgColor = 'transparent';
                statusBorderColor = 'transparent';
            }
            
            if (startSubscriptionBtn) {
                startSubscriptionBtn.style.display = 'none';
            }
            
            // Always show payment method button for active subscriptions
            if (managePaymentMethodBtn) {
                const hasCustomerId = !!subscription.stripe_customer_id;
                managePaymentMethodBtn.style.display = 'block';
                managePaymentMethodBtn.textContent = hasCustomerId ? 'Update Payment Method' : 'Add Payment Method';
                console.log('[PaymentController] Showing payment method button - active subscription');
            }
        } else {
            // For any other status (expired, cancelled, etc.), still show payment method button
            statusText = `Your subscription status: ${subscription.status}. Please subscribe to continue.`;
            statusClass = 'subscription-message-error';
            statusBgColor = 'rgba(181, 138, 138, 0.2)';
            statusBorderColor = 'var(--danger-color)';
            if (startSubscriptionBtn) {
                startSubscriptionBtn.style.display = 'block';
            }
            // Always show payment method button - users can always add/update payment method
            if (managePaymentMethodBtn) {
                managePaymentMethodBtn.style.display = 'block';
                const hasCustomerId = !!subscription.stripe_customer_id;
                managePaymentMethodBtn.textContent = hasCustomerId ? 'Update Payment Method' : 'Add Payment Method';
            }
        }
        
        // Only show status message if there's actual text (hide when details table shows all info)
        if (statusText) {
            statusMessage.textContent = statusText;
            statusMessage.className = `subscription-message ${statusClass}`;
            statusMessage.style.backgroundColor = statusBgColor;
            statusMessage.style.border = `var(--border-width-standard) solid ${statusBorderColor}`;
            statusMessage.style.display = 'block';
        } else {
            // Hide status message when subscription details table is shown
            statusMessage.style.display = 'none';
        }
        
        if (subscriptionDetailsContainer && subscriptionDetailsContent) {
            const detailsHtml = [];
            
            // Subscription Type (always show - clearly distinguishes trial vs paid)
            const subscriptionType = window.SubscriptionService ?
                window.SubscriptionService.getSubscriptionTypeDescription(subscription) :
                (subscription.status === 'trial' ? 'Trial' :
                 subscription.status === 'active' && subscription.stripe_subscription_id ? 'Paid' : 'Free');
            detailsHtml.push(`<div style="display: flex; justify-content: space-between; padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));"><strong>Type:</strong><span>${subscriptionType}</span></div>`);
            
            // Days Remaining (calculate and show)
            let daysRemaining = null;
            if (subscription.status === 'trial') {
                daysRemaining = window.SubscriptionService.getTrialDaysRemaining(subscription);
            } else if (subscription.status === 'active') {
                daysRemaining = window.SubscriptionService.getSubscriptionDaysRemaining(subscription);
            }
            
            if (daysRemaining !== null && daysRemaining !== undefined) {
                const daysText = daysRemaining === 0 ? 'Expired' : `${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining`;
                detailsHtml.push(`<div style="display: flex; justify-content: space-between; padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));"><strong>Days Remaining:</strong><span>${daysText}</span></div>`);
            }
            
            // Subscription Start (show if available - for paid subscriptions)
            const subscriptionStartDate = subscription.current_period_start;
            if (subscriptionStartDate) {
                detailsHtml.push(`<div style="display: flex; justify-content: space-between; padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));"><strong>Subscription Start:</strong><span>${this.formatDate(subscriptionStartDate)}</span></div>`);
            }

            // Subscription End (show end date: current_period_end for paid, trial_end for trial)
            const subscriptionEndDate = subscription.current_period_end || subscription.trial_end;
            if (subscriptionEndDate) {
                detailsHtml.push(`<div style="display: flex; justify-content: space-between; padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));"><strong>Subscription End:</strong><span>${this.formatDate(subscriptionEndDate)}</span></div>`);
            }
            
            // Always show the details box if we have a subscription
            if (detailsHtml.length > 0) {
                subscriptionDetailsContent.innerHTML = detailsHtml.join('');
                subscriptionDetailsContainer.style.display = 'block';
            } else {
                subscriptionDetailsContainer.style.display = 'none';
            }
        }
        
        // Display Account Created date in separate section outside the details box
        const accountCreatedContainer = document.getElementById('account-created-container');
        const accountCreatedDate = document.getElementById('account-created-date');
        if (accountCreatedContainer && accountCreatedDate) {
            // Get user account created date from AuthService (Supabase auth.users table)
            const currentUser = window.AuthService ? window.AuthService.getCurrentUser() : null;
            if (currentUser && currentUser.created_at) {
                accountCreatedDate.textContent = this.formatDate(currentUser.created_at);
                accountCreatedContainer.style.display = 'block';
            } else {
                // Fallback: try to get from session if currentUser doesn't have it
                const session = window.AuthService ? window.AuthService.getSession() : null;
                if (session && session.user && session.user.created_at) {
                    accountCreatedDate.textContent = this.formatDate(session.user.created_at);
                    accountCreatedContainer.style.display = 'block';
                } else {
                    accountCreatedContainer.style.display = 'none';
                }
            }
        }
    },
    
    /**
     * Format date for display
     */
    formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    },
    
    /**
     * Render payment history
     */
    renderPaymentHistory() {
        const historyContainer = document.getElementById('payment-history-container');
        const historyTableBody = document.getElementById('payment-history-tbody');
        
        if (!historyContainer || !historyTableBody) {
            return;
        }
        
        if (!this.paymentHistory || this.paymentHistory.length === 0) {
            historyTableBody.innerHTML = '<tr><td colspan="5" style="text-align: center;">No payment history available</td></tr>';
            return;
        }
        
        historyTableBody.innerHTML = '';
        
        this.paymentHistory.forEach(payment => {
            const row = document.createElement('tr');
            
            const date = new Date(payment.payment_date);
            const formattedDate = date.toLocaleDateString('en-GB', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
            
            const amount = (payment.amount / 100).toFixed(2);
            const currency = payment.currency.toUpperCase();
            
            let statusClass = 'payment-status-pending';
            if (payment.status === 'succeeded') {
                statusClass = 'payment-status-success';
            } else if (payment.status === 'failed') {
                statusClass = 'payment-status-error';
            }
            
            row.innerHTML = `
                <td>${formattedDate}</td>
                <td>${amount} ${currency}</td>
                <td><span class="${statusClass}">${payment.status}</span></td>
                <td>${payment.stripe_payment_intent_id || 'N/A'}</td>
            `;
            
            historyTableBody.appendChild(row);
        });
    },
    
    /**
     * Handle start subscription button click
     */
    async handleStartSubscription() {
        try {
            const button = document.getElementById('start-subscription-button');
            if (button) {
                button.disabled = true;
                button.textContent = 'Processing...';
            }
            
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                throw new Error('User not authenticated');
            }
            
            const currentUser = window.AuthService.getCurrentUser();
            if (!currentUser || !currentUser.email) {
                throw new Error('User email not available');
            }
            
            const currentUrl = window.location.href.split('?')[0];
            const successUrl = `${currentUrl}?payment=success`;
            const cancelUrl = `${currentUrl}?payment=cancelled`;
            
            console.log('[PaymentController] Creating checkout session...');
            
            if (!window.StripeService) {
                throw new Error('StripeService not available');
            }
            
            await window.StripeService.initialize();
            
            // Supabase Edge Function endpoint for creating checkout sessions
            // INSTRUCTIONS: See payments/backend/UPDATE_PAYMENT_CONTROLLER.md
            // Replace 'ofutzrxfbrgtbkyafndv' with your actual Supabase project reference ID if different
            const supabaseProjectUrl = 'https://ofutzrxfbrgtbkyafndv.supabase.co';
            const backendEndpoint = `${supabaseProjectUrl}/functions/v1/create-checkout-session`;
            
            const result = await window.StripeService.createCheckoutSession(
                currentUser.email,
                currentUser.id,
                successUrl,
                cancelUrl,
                backendEndpoint
            );
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to create checkout session');
            }
            
            if (result.sessionId) {
                // Store customer ID if returned (for future payment method updates)
                if (result.customerId && window.SubscriptionService) {
                    const currentUser = window.AuthService.getCurrentUser();
                    if (currentUser && currentUser.id) {
                        // Update subscription with customer ID (non-blocking)
                        window.SubscriptionService.updateSubscription(currentUser.id, {
                            stripe_customer_id: result.customerId
                        }).catch(err => {
                            console.warn('[PaymentController] Failed to store customer ID:', err);
                        });
                    }
                }
                
                const redirectResult = await window.StripeService.redirectToCheckout(result.sessionId);
                if (!redirectResult.success) {
                    throw new Error(redirectResult.error || 'Failed to redirect to checkout');
                }
            } else {
                throw new Error('Checkout session requires backend implementation. Please set up a server endpoint to create Stripe checkout sessions.');
            }
        } catch (error) {
            console.error('[PaymentController] Error starting subscription:', error);
            alert(`Error: ${error.message || 'Failed to start subscription. Please try again.'}`);
            
            const button = document.getElementById('start-subscription-button');
            if (button) {
                button.disabled = false;
                button.textContent = 'Start Subscription';
            }
        }
    },
    
    /**
     * Refresh subscription data
     */
    async refreshSubscriptionData() {
        await this.loadSubscriptionData();
        await this.loadPaymentHistory();
        this.renderSubscriptionStatus();
        this.renderPaymentHistory();
    },
    
    /**
     * Handle manage payment method button click
     * Opens Stripe Customer Portal for updating payment method
     * For trial users without customer ID, creates a customer first
     */
    async handleManagePaymentMethod() {
        console.log('[PaymentController] ========== handleManagePaymentMethod() STARTED ==========');
        const startTime = Date.now();
        
        try {
            console.log('[PaymentController] Step 1: Getting button element...');
            const button = document.getElementById('manage-payment-method-button');
            if (button) {
                button.disabled = true;
                button.textContent = 'Loading...';
                console.log('[PaymentController] ✅ Button found and disabled');
            } else {
                console.warn('[PaymentController] ⚠️ Button element not found');
            }
            
            console.log('[PaymentController] Step 2: Checking authentication...');
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                console.error('[PaymentController] ❌ User not authenticated');
                throw new Error('User not authenticated');
            }
            console.log('[PaymentController] ✅ User authenticated');
            
            console.log('[PaymentController] Step 3: Getting current user...');
            const currentUser = window.AuthService.getCurrentUser();
            if (!currentUser || !currentUser.email) {
                console.error('[PaymentController] ❌ User email not available:', { hasUser: !!currentUser, hasEmail: !!currentUser?.email });
                throw new Error('User email not available');
            }
            console.log('[PaymentController] ✅ Current user:', { userId: currentUser.id, email: currentUser.email });
            
            console.log('[PaymentController] Step 4: Checking subscription state...');
            const hasSubscription = !!this.currentSubscription;
            const existingCustomerId = this.currentSubscription?.stripe_customer_id;
            console.log('[PaymentController] Subscription state:', {
                hasSubscription: hasSubscription,
                subscriptionStatus: this.currentSubscription?.status,
                isPaid: this.currentSubscription?.status === 'active' && !!this.currentSubscription?.stripe_subscription_id,
                hasCustomerId: !!existingCustomerId,
                customerId: existingCustomerId || 'none'
            });
            
            console.log('[PaymentController] Step 5: Checking StripeService availability...');
            if (!window.StripeService) {
                console.error('[PaymentController] ❌ StripeService not available');
                throw new Error('StripeService not available');
            }
            console.log('[PaymentController] ✅ StripeService available');
            
            console.log('[PaymentController] Step 6: Initializing Stripe...');
            await window.StripeService.initialize();
            console.log('[PaymentController] ✅ Stripe initialized');
            
            let customerId = existingCustomerId;
            
            // If no customer ID, create one first (for trial users)
            if (!customerId) {
                console.log('[PaymentController] Step 7: No customer ID found, creating customer...');
                console.log('[PaymentController] Customer creation details:', {
                    email: currentUser.email,
                    userId: currentUser.id
                });
                
                const supabaseProjectUrl = 'https://ofutzrxfbrgtbkyafndv.supabase.co';
                const createCustomerEndpoint = `${supabaseProjectUrl}/functions/v1/create-customer`;
                console.log('[PaymentController] Customer creation endpoint:', createCustomerEndpoint);
                
                const customerStartTime = Date.now();
                const customerResult = await window.StripeService.createCustomer(
                    currentUser.email,
                    currentUser.id,
                    createCustomerEndpoint
                );
                const customerElapsed = Date.now() - customerStartTime;
                
                console.log('[PaymentController] Customer creation result:', {
                    success: customerResult.success,
                    hasCustomerId: !!customerResult.customerId,
                    customerId: customerResult.customerId || 'none',
                    error: customerResult.error || 'none',
                    elapsed: `${customerElapsed}ms`
                });
                
                if (!customerResult.success || !customerResult.customerId) {
                    console.error('[PaymentController] ❌ Customer creation failed:', customerResult.error);
                    throw new Error(customerResult.error || 'Failed to create customer');
                }
                
                customerId = customerResult.customerId;
                console.log('[PaymentController] ✅ Customer created successfully:', customerId);
                
                // Store customer ID in database (non-blocking)
                // If subscription exists, update it; otherwise it will be stored when subscription is created
                if (window.SubscriptionService && this.currentSubscription) {
                    console.log('[PaymentController] Step 8: Storing customer ID in database...');
                    window.SubscriptionService.updateSubscription(currentUser.id, {
                        stripe_customer_id: customerId
                    }).then(() => {
                        console.log('[PaymentController] ✅ Customer ID stored in database');
                    }).catch(err => {
                        console.warn('[PaymentController] ⚠️ Failed to store customer ID in database:', err);
                    });
                } else {
                    console.log('[PaymentController] Step 8: Skipping database update (no subscription or SubscriptionService)');
                }
            } else {
                console.log('[PaymentController] Step 7: Using existing customer ID:', customerId);
            }
            
            console.log('[PaymentController] Step 9: Preparing portal session...');
            const currentUrl = window.location.href.split('?')[0];
            const returnUrl = currentUrl;
            console.log('[PaymentController] Portal session details:', {
                customerId: customerId,
                returnUrl: returnUrl
            });
            
            const supabaseProjectUrl = 'https://ofutzrxfbrgtbkyafndv.supabase.co';
            const backendEndpoint = `${supabaseProjectUrl}/functions/v1/create-portal-session`;
            console.log('[PaymentController] Portal session endpoint:', backendEndpoint);
            
            console.log('[PaymentController] Step 10: Creating portal session...');
            const portalStartTime = Date.now();
            const result = await window.StripeService.createPortalSession(
                customerId,
                returnUrl,
                backendEndpoint
            );
            const portalElapsed = Date.now() - portalStartTime;
            
            console.log('[PaymentController] Portal session result:', {
                success: result.success,
                hasUrl: !!result.url,
                url: result.url || 'none',
                error: result.error || 'none',
                elapsed: `${portalElapsed}ms`
            });
            
            if (!result.success) {
                console.error('[PaymentController] ❌ Portal session creation failed:', result.error);
                throw new Error(result.error || 'Failed to create portal session');
            }
            
            if (result.url) {
                console.log('[PaymentController] Step 11: Redirecting to Stripe Customer Portal...');
                console.log('[PaymentController] Portal URL:', result.url);
                const totalElapsed = Date.now() - startTime;
                console.log('[PaymentController] ========== handleManagePaymentMethod() SUCCESS ==========');
                console.log('[PaymentController] Total time:', `${totalElapsed}ms`);
                // Redirect to Stripe Customer Portal
                window.location.href = result.url;
            } else {
                console.error('[PaymentController] ❌ No portal URL returned');
                throw new Error('No portal URL returned');
            }
        } catch (error) {
            const totalElapsed = Date.now() - startTime;
            console.error('[PaymentController] ========== handleManagePaymentMethod() ERROR ==========');
            console.error('[PaymentController] Error details:', {
                message: error.message,
                stack: error.stack,
                elapsed: `${totalElapsed}ms`
            });
            console.error('[PaymentController] Error opening payment portal:', error);
            alert(`Error: ${error.message || 'Failed to open payment portal. Please try again.'}`);
            
            const button = document.getElementById('manage-payment-method-button');
            if (button) {
                button.disabled = false;
                // Restore original button text based on subscription
                const hasCustomerId = !!this.currentSubscription?.stripe_customer_id;
                button.textContent = hasCustomerId ? 'Update Payment Method' : 'Add Payment Method';
                console.log('[PaymentController] Button re-enabled');
            }
        }
    }
};

if (typeof window !== 'undefined') {
    window.PaymentController = PaymentController;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = PaymentController;
}

