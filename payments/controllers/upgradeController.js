/**
 * Upgrade Controller
 * Handles subscription upgrade/downgrade page logic
 * VERSION: 2.0.0-with-session-wait
 * LAST_UPDATED: 2025-12-25T18:53:00Z
 */

// Log immediately when file loads to verify latest code
const BUILD_ID = Date.now();
const FILE_LOAD_TIME = new Date().toISOString();
console.log('═══════════════════════════════════════════════════════════════');
console.log('[UpgradeController] ═════ FILE LOADED ═════');
console.log('[UpgradeController] BUILD_ID:', BUILD_ID);
console.log('[UpgradeController] File loaded at:', FILE_LOAD_TIME);
console.log('═══════════════════════════════════════════════════════════════');

const UpgradeController = {
    VERSION: '2.0.0-with-session-wait',
    LAST_UPDATED: '2025-12-25T18:53:00Z',
    currentSubscription: null,
    availablePlans: [],
    currentPlan: null,
    
    /**
     * Initialize the upgrade page
     */
    async init() {
        console.log('[UpgradeController] ========== INIT STARTED ==========');
        console.log('[UpgradeController] VERSION:', this.VERSION);
        console.log('[UpgradeController] LAST_UPDATED:', this.LAST_UPDATED);
        console.log('[UpgradeController] Code loaded at:', new Date().toISOString());
        console.log('[UpgradeController] File location:', window.location.href);
        
        try {
            // Check for success/cancel redirects (store for later processing after auth)
            const urlParams = new URLSearchParams(window.location.search);
            const upgradeStatus = urlParams.get('upgrade');
            const planId = urlParams.get('plan');
            let shouldHandleUpgradeSuccess = false;
            
            if (upgradeStatus === 'success') {
                console.log('[UpgradeController] Upgrade successful, plan:', planId);
                shouldHandleUpgradeSuccess = true;
                // Will handle after authentication is confirmed
            } else if (upgradeStatus === 'cancelled') {
                console.log('[UpgradeController] Upgrade cancelled');
                alert('Subscription upgrade was cancelled.');
                // Remove query params
                window.history.replaceState({}, document.title, window.location.pathname);
            }
            
            // Wait for SupabaseConfig to be available
            console.log('[UpgradeController] Waiting for SupabaseConfig...');
            let waitCount = 0;
            const maxWait = 50; // Wait up to 5 seconds (50 * 100ms)
            while (!window.SupabaseConfig && waitCount < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }
            
            if (!window.SupabaseConfig) {
                console.error('[UpgradeController] SupabaseConfig not available after waiting');
                this.showError('Configuration not available. Please refresh the page.');
                return;
            }
            
            // Wait for AuthService to be available and initialized
            console.log('[UpgradeController] Waiting for AuthService...');
            waitCount = 0;
            while (!window.AuthService && waitCount < maxWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
                waitCount++;
            }
            
            if (!window.AuthService) {
                console.error('[UpgradeController] AuthService not available after waiting');
                this.showError('Authentication service not available. Please refresh the page.');
                return;
            }
            
            // Initialize AuthService if needed
            if (!window.AuthService.client) {
                console.log('[UpgradeController] AuthService client not initialized, initializing...');
                try {
                    await window.AuthService.initialize();
                    console.log('[UpgradeController] AuthService initialized');
                } catch (initError) {
                    console.error('[UpgradeController] Failed to initialize AuthService:', initError);
                    this.showError('Failed to initialize authentication. Please refresh the page.');
                    return;
                }
            }
            
            // Wait for session check to complete - poll until session is loaded or timeout
            console.log('[UpgradeController] ========== SESSION WAIT STARTED (NEW CODE PATH) ==========');
            console.log('[UpgradeController] This is the NEW code with session polling - VERSION:', this.VERSION);
            console.log('[UpgradeController] Waiting for session check to complete...');
            let sessionCheckWaitCount = 0;
            const maxSessionWait = 30; // Wait up to 3 seconds (30 * 100ms)
            console.log('[UpgradeController] Max session wait configured:', maxSessionWait, 'iterations (3 seconds)');
            
            // Check if session is loaded by checking both isAuthenticated() and direct state
            while (sessionCheckWaitCount < maxSessionWait) {
                const isAuthenticated = window.AuthService.isAuthenticated();
                const hasDirectSession = window.AuthService.currentUser !== null && window.AuthService.session !== null;
                const hasClient = !!window.AuthService.client;
                
                console.log('[UpgradeController] Session check attempt', sessionCheckWaitCount + 1, '/', maxSessionWait, ':', {
                    isAuthenticated: isAuthenticated,
                    hasDirectSession: hasDirectSession,
                    hasClient: hasClient,
                    hasCurrentUser: !!window.AuthService.currentUser,
                    hasSession: !!window.AuthService.session,
                    currentUserEmail: window.AuthService.currentUser?.email
                });
                
                // If we have authentication (either method), break
                if (isAuthenticated || hasDirectSession) {
                    console.log('[UpgradeController] ✅ Session found on attempt', sessionCheckWaitCount + 1, '- authentication confirmed');
                    console.log('[UpgradeController] Session detection method:', isAuthenticated ? 'isAuthenticated()' : 'direct state check');
                    break;
                }
                
                // If client exists but no session yet, wait a bit more
                if (hasClient) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    sessionCheckWaitCount++;
                } else {
                    // Client not ready yet, wait longer
                    await new Promise(resolve => setTimeout(resolve, 200));
                    sessionCheckWaitCount += 2;
                }
            }
            
            console.log('[UpgradeController] Session polling completed after', sessionCheckWaitCount, 'iterations');
            
            // Final authentication check
            const isAuthenticated = window.AuthService.isAuthenticated();
            const hasDirectSession = window.AuthService.currentUser !== null && window.AuthService.session !== null;
            const finalAuthCheck = isAuthenticated || hasDirectSession;
            
            console.log('[UpgradeController] ========== FINAL AUTHENTICATION CHECK ==========');
            console.log('[UpgradeController] Final authentication check results:', {
                isAuthenticated: isAuthenticated,
                hasDirectSession: hasDirectSession,
                finalAuthCheck: finalAuthCheck,
                hasCurrentUser: !!window.AuthService.currentUser,
                userEmail: window.AuthService.currentUser?.email,
                hasSession: !!window.AuthService.session
            });
            
            if (!finalAuthCheck) {
                console.warn('[UpgradeController] ❌ User not authenticated after waiting', sessionCheckWaitCount, 'iterations');
                console.warn('[UpgradeController] Redirecting to auth page...');
                const baseUrl = window.location.origin;
                const currentPath = window.location.pathname;
                const basePath = currentPath.includes('/payments/') ? '../../../' : '';
                const authUrl = `${baseUrl}/${basePath}auth/views/auth.html`;
                console.warn('[UpgradeController] Auth URL:', authUrl);
                window.location.href = authUrl;
                return;
            }
            
            console.log('[UpgradeController] ✅ User authenticated successfully, proceeding with upgrade page initialization...');
            console.log('[UpgradeController] Authenticated user:', window.AuthService.currentUser?.email);
            
            // Handle upgrade success if needed (after authentication is confirmed)
            if (shouldHandleUpgradeSuccess && planId) {
                console.log('[UpgradeController] Authentication confirmed, now handling upgrade success...');
                await this.handleUpgradeSuccess(planId);
            }
            
            // Load current subscription and available plans
            await Promise.all([
                this.loadCurrentSubscription(),
                this.loadAvailablePlans()
            ]);
            
            // Render plans
            this.renderPlans();
            
            console.log('[UpgradeController] ========== INIT COMPLETE ==========');
        } catch (error) {
            console.error('[UpgradeController] Error initializing:', error);
            this.showError('Failed to load subscription information. Please try again.');
        }
    },
    
    /**
     * Load current user subscription
     */
    async loadCurrentSubscription() {
        console.log('[UpgradeController] ========== loadCurrentSubscription() STARTED ==========');
        const startTime = Date.now();
        
        try {
            console.log('[UpgradeController] Step 1: Checking SubscriptionService availability...');
            if (!window.SubscriptionService) {
                console.error('[UpgradeController] ❌ SubscriptionService not available');
                throw new Error('SubscriptionService not available');
            }
            console.log('[UpgradeController] ✅ SubscriptionService available');
            
            console.log('[UpgradeController] Step 2: Calling getCurrentUserSubscription()...');
            const result = await window.SubscriptionService.getCurrentUserSubscription();
            const elapsed = Date.now() - startTime;
            console.log('[UpgradeController] getCurrentUserSubscription() completed in', elapsed, 'ms');
            console.log('[UpgradeController] Result structure:', {
                hasResult: !!result,
                success: result?.success,
                hasSubscription: !!result?.subscription,
                hasPlan: !!result?.plan,
                error: result?.error || null
            });
            
            if (result.success && result.subscription) {
                console.log('[UpgradeController] Step 3: Processing successful subscription result...');
                this.currentSubscription = result.subscription;
                this.currentPlan = result.plan;
                
                console.log('[UpgradeController] ✅ Subscription data assigned:', {
                    subscriptionKeys: Object.keys(this.currentSubscription || {}),
                    planKeys: Object.keys(this.currentPlan || {}),
                    planId: this.currentSubscription?.plan_id,
                    planName: this.currentPlan?.plan_name || this.currentPlan?.name,
                    status: this.currentSubscription?.status,
                    hasStripeSubscriptionId: !!this.currentSubscription?.stripe_subscription_id,
                    cancelAtPeriodEnd: this.currentSubscription?.cancel_at_period_end,
                    currentPeriodEnd: this.currentSubscription?.current_period_end,
                    trialEnd: this.currentSubscription?.trial_end
                });
                
                console.log('[UpgradeController] Step 4: Calling displayCurrentSubscription()...');
                this.displayCurrentSubscription();
                console.log('[UpgradeController] displayCurrentSubscription() call completed');
                
                // Load recent invoices if user has a paid subscription
                if (this.currentSubscription && this.currentSubscription.stripe_customer_id) {
                    console.log('[UpgradeController] Step 5: Loading recent invoices...');
                    this.loadRecentInvoices();
                }
            } else {
                console.warn('[UpgradeController] ⚠️ No subscription found or result unsuccessful:', {
                    success: result?.success,
                    hasSubscription: !!result?.subscription,
                    error: result?.error || null
                });
                this.currentSubscription = null;
                this.currentPlan = null;
                console.log('[UpgradeController] Step 4: Calling hideCurrentSubscription()...');
                this.hideCurrentSubscription();
            }
            
            const totalElapsed = Date.now() - startTime;
            console.log('[UpgradeController] ========== loadCurrentSubscription() COMPLETE in', totalElapsed, 'ms ==========');
        } catch (error) {
            const totalElapsed = Date.now() - startTime;
            console.error('[UpgradeController] ========== loadCurrentSubscription() ERROR after', totalElapsed, 'ms ==========');
            console.error('[UpgradeController] Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            this.currentSubscription = null;
            this.currentPlan = null;
            console.log('[UpgradeController] Calling hideCurrentSubscription() due to error...');
            this.hideCurrentSubscription();
        }
    },
    
    /**
     * Load all available subscription plans
     */
    async loadAvailablePlans() {
        console.log('[UpgradeController] Loading available plans...');
        
        try {
            if (!window.DatabaseService) {
                throw new Error('DatabaseService not available');
            }
            
            const result = await window.DatabaseService.querySelect('subscription_plans', {
                filter: { is_active: true },
                order: [{ column: 'price_cents', ascending: true }]
            });
            
            if (result.error) {
                throw new Error(result.error.message || 'Failed to load plans');
            }
            
            this.availablePlans = result.data || [];
            console.log('[UpgradeController] Available plans loaded:', this.availablePlans.length);
        } catch (error) {
            console.error('[UpgradeController] Error loading plans:', error);
            throw error;
        }
    },
    
    /**
     * Render subscription plans
     */
    renderPlans() {
        console.log('[UpgradeController] ========== renderPlans() CALLED ==========');
        
        const container = document.getElementById('plans-container');
        const loadingMessage = document.getElementById('loading-message');
        const errorMessage = document.getElementById('error-message');
        
        if (!container) {
            console.error('[UpgradeController] Plans container not found');
            return;
        }
        
        // Hide loading/error messages
        if (loadingMessage) loadingMessage.style.display = 'none';
        if (errorMessage) errorMessage.style.display = 'none';
        
        if (this.availablePlans.length === 0) {
            console.warn('[UpgradeController] No plans available');
            if (errorMessage) {
                errorMessage.style.display = 'block';
                errorMessage.textContent = 'No subscription plans available.';
            }
            return;
        }
        
        container.innerHTML = '';
        
        const currentPlanId = this.currentSubscription?.plan_id;
        
        // Sort plans for mobile: paid plans first, then free plans
        // This ensures Premium appears before Free on mobile
        const sortedPlans = [...this.availablePlans].sort((a, b) => {
            // Paid plans (price > 0) come first, sorted by price descending
            // Free plans (price === 0) come last
            if (a.price_cents === 0 && b.price_cents > 0) return 1;
            if (a.price_cents > 0 && b.price_cents === 0) return -1;
            // Both paid or both free: sort by price descending
            return b.price_cents - a.price_cents;
        });
        
        sortedPlans.forEach((plan, index) => {
            const isCurrentPlan = currentPlanId === plan.id;
            // Recommended is the first paid plan (highest tier) - which is now index 0 after sorting
            const isRecommended = index === 0 && plan.price_cents > 0;

            const planCard = document.createElement('div');
            planCard.className = `plan-card ${isCurrentPlan ? 'current' : ''} ${isRecommended ? 'recommended' : ''}`;

            const priceInCents = plan.price_cents;
            const priceInDollars = priceInCents / 100;
            const priceFormatted = priceInCents === 0 ? '0' : priceInDollars.toFixed(2);
            const currency = plan.currency ? plan.currency.toUpperCase() : 'USD';

            // Determine button text based on upgrade/downgrade direction
            let buttonText = 'Subscribe';
            if (currentPlanId && this.currentPlan) {
                const currentPrice = this.currentPlan.price_cents || 0;
                const newPrice = plan.price_cents || 0;
                if (newPrice > currentPrice) {
                    buttonText = 'Upgrade';
                } else if (newPrice < currentPrice) {
                    buttonText = 'Downgrade';
                } else {
                    buttonText = 'Current Plan';
                }
            } else if (currentPlanId && !this.currentPlan) {
                // If we have a current plan ID but no plan details, check subscription
                const currentPrice = this.currentSubscription?.plan?.price_cents || 0;
                const newPrice = plan.price_cents || 0;
                if (newPrice > currentPrice) {
                    buttonText = 'Upgrade';
                } else if (newPrice < currentPrice) {
                    buttonText = 'Downgrade';
                }
            }
            
            planCard.innerHTML = `
                <div class="plan-header">
                    <div class="plan-name">
                        ${plan.name}
                        ${isCurrentPlan ? '<span class="current-plan-badge">Current</span>' : ''}
                    </div>
                    <div class="plan-price">
                        ${plan.price_cents === 0 ? 'Free' : `$${priceFormatted}`}
                        ${plan.price_cents > 0 ? `<span class="plan-price-period">/${plan.interval}</span>` : ''}
                    </div>
                </div>
                <div class="plan-description">
                    ${plan.description || (plan.name === 'Free' ? 'Limited access after your trial ends' : 'Full end-to-end encrypted messaging')}
                </div>
                <ul class="plan-features">
                    ${plan.features && Array.isArray(plan.features)
                        ? plan.features.map(feature => `<li>${feature}</li>`).join('')
                        : '<li>Access to Secure Messenger features</li>'}
                </ul>
                <div class="plan-actions">
                    ${isCurrentPlan ?
                        `<div class="plan-status current">You are currently on this plan</div>` :
                        `<button class="btn btn-action upgrade-btn" data-plan-id="${plan.id}" data-plan-name="${plan.name}" data-price-amount="${priceInCents}">
                            ${buttonText}
                        </button>`
                    }
                </div>
            `;
            
            container.appendChild(planCard);
        });
        
        // Attach event listeners
        this.setupEventListeners();
        
        console.log('[UpgradeController] Plans rendered:', this.availablePlans.length);
    },
    
    /**
     * Setup event listeners
     */
    setupEventListeners() {
        const upgradeButtons = document.querySelectorAll('.upgrade-btn');
        upgradeButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const planId = parseInt(button.dataset.planId);
                const planName = button.dataset.planName;
                const priceAmount = parseInt(button.dataset.priceAmount);
                this.handleUpgrade(planId, planName, priceAmount);
            });
        });
        
        // Update Payment Method button
        const updatePaymentBtn = document.getElementById('update-payment-button');
        if (updatePaymentBtn) {
            updatePaymentBtn.addEventListener('click', () => this.handleUpdatePayment());
        }
        
        // View Invoices button
        const viewInvoicesBtn = document.getElementById('view-invoices-button');
        if (viewInvoicesBtn) {
            viewInvoicesBtn.addEventListener('click', () => this.handleViewInvoices());
        }
        
        // Invoice modal close button
        const invoiceModalClose = document.getElementById('invoice-modal-close');
        if (invoiceModalClose) {
            invoiceModalClose.addEventListener('click', () => this.closeInvoiceModal());
        }
        
        // Close invoice modal when clicking outside
        const invoiceModal = document.getElementById('invoice-modal');
        if (invoiceModal) {
            invoiceModal.addEventListener('click', (e) => {
                if (e.target === invoiceModal) {
                    this.closeInvoiceModal();
                }
            });
        }
    },
    
    /**
     * Handle subscription upgrade/downgrade
     */
    async handleUpgrade(planId, planName, priceAmount) {
        console.log('[UpgradeController] ========== handleUpgrade() STARTED ==========');
        console.log('[UpgradeController] Upgrade details:', { planId, planName, priceAmount });
        
        try {
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                throw new Error('User not authenticated');
            }
            
            const currentUser = window.AuthService.getCurrentUser();
            if (!currentUser || !currentUser.email) {
                throw new Error('User email not available');
            }
            
            // Determine if this is an upgrade or downgrade
            const currentPlan = this.currentPlan;
            const currentPlanPrice = currentPlan ? currentPlan.price_cents : 0; // Already in cents
            const isUpgrade = !currentPlan || priceAmount > currentPlanPrice;
            const isDowngrade = currentPlan && priceAmount < currentPlanPrice;
            const isSamePlan = currentPlan && priceAmount === currentPlanPrice;
            
            console.log('[UpgradeController] Plan change analysis:', {
                currentPlanId: currentPlan?.id,
                newPlanId: planId,
                currentPrice: currentPlanPrice,
                newPrice: priceAmount,
                isUpgrade: isUpgrade,
                isDowngrade: isDowngrade,
                isSamePlan: isSamePlan
            });
            
            // If same plan, do nothing
            if (isSamePlan) {
                alert('You are already on this plan.');
                return;
            }
            
            // For Free plan (€0): update directly without Stripe checkout
            // This handles both new subscriptions to Free and downgrades to Free
            if (priceAmount === 0) {
                console.log('[UpgradeController] Processing Free plan selection (no payment required)...');
                
                if (!window.SubscriptionService) {
                    throw new Error('SubscriptionService not available');
                }
                
                // Check if user has an active paid subscription with Stripe
                const subscriptionResult = await window.SubscriptionService.getCurrentUserSubscription();
                const hasStripeSubscription = subscriptionResult.success &&
                    subscriptionResult.subscription &&
                    subscriptionResult.subscription.status === 'active' &&
                    subscriptionResult.subscription.stripe_subscription_id;
                
                // If user has a Stripe subscription, cancel it via update-subscription Edge Function
                if (hasStripeSubscription) {
                    console.log('[UpgradeController] Cancelling Stripe subscription before switching to Free...');
                    
                    const supabaseProjectUrl = 'https://ofutzrxfbrgtbkyafndv.supabase.co';
                    const updateEndpoint = `${supabaseProjectUrl}/functions/v1/update-subscription`;
                    
                    // Get auth token
                    let authToken = null;
                    if (window.AuthService && window.AuthService.isAuthenticated()) {
                        authToken = window.AuthService.getAccessToken();
                    }
                    
                    const headers = {
                        'Content-Type': 'application/json'
                    };
                    
                    if (authToken) {
                        headers['Authorization'] = `Bearer ${authToken}`;
                    }
                    
                    // Cancel Stripe subscription immediately and update to Free
                    const response = await fetch(updateEndpoint, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            userId: currentUser.id,
                            customerId: subscriptionResult.subscription.stripe_customer_id,
                            currentSubscriptionId: subscriptionResult.subscription.stripe_subscription_id,
                            newPlanId: planId,
                            changeType: 'downgrade',
                            recurringBillingEnabled: false // Disable recurring billing for Free plan
                        }),
                        credentials: 'omit'
                    });
                    
                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({ error: 'Failed to cancel subscription' }));
                        console.warn('[UpgradeController] Failed to cancel Stripe subscription, proceeding with direct update:', errorData.error);
                        // Continue with direct update even if Stripe cancellation fails
                    } else {
                        const result = await response.json();
                        if (result.success) {
                            console.log('[UpgradeController] Stripe subscription cancelled successfully');
                        }
                    }
                }
                
                // Update subscription directly to Free plan
                // Clear Stripe fields since Free plan has no billing
                const updateResult = await window.SubscriptionService.updateSubscription(currentUser.id, {
                    plan_id: planId,
                    status: 'active',  // Free plan is active (not trial)
                    stripe_subscription_id: null, // Clear Stripe subscription ID
                    stripe_customer_id: null, // Clear Stripe customer ID
                    stripe_price_id: null, // Clear Stripe price ID
                    current_period_start: null, // Clear billing period
                    current_period_end: null,
                    trial_end: null, // Clear trial end
                    cancel_at_period_end: false
                });
                
                if (updateResult.success) {
                    alert(`Successfully switched to ${planName}!`);
                    
                    // Reload subscription and plans to refresh the display
                    await this.loadCurrentSubscription();
                    await this.loadAvailablePlans();
                    await this.renderPlans();
                    this.displayCurrentSubscription();
                } else {
                    throw new Error(updateResult.error || 'Failed to switch to Free plan');
                }
                
                return;
            }
            
            // For paid plans (priceAmount > 0): need StripeService for checkout (or use fallback)
            let useStripeService = false;
            if (priceAmount > 0) {
                console.log('[UpgradeController] Processing paid plan, checking StripeService...');
                
                // Brief wait for StripeService to be available
                const maxWaitTime = 250;
                const startWaitTime = Date.now();
                
                if (!window.StripeService) {
                    await new Promise(resolve => setTimeout(resolve, maxWaitTime));
                }
                
                if (window.StripeService) {
                    console.log('[UpgradeController] ✅ StripeService available, initializing...');
                    await window.StripeService.initialize();
                    useStripeService = true;
                } else {
                    console.log('[UpgradeController] ⚠️ StripeService not available, will use direct Edge Function call as fallback');
                    useStripeService = false;
                }
            }
            
            // For downgrades (to paid plans): use update-subscription Edge Function (scheduled)
            if (isDowngrade) {
                console.log('[UpgradeController] Processing downgrade (scheduled)...');
                
                if (!window.SubscriptionService) {
                    throw new Error('SubscriptionService not available');
                }
                
                // Check if user has an active paid subscription
                const subscriptionResult = await window.SubscriptionService.getCurrentUserSubscription();
                if (!subscriptionResult.success || !subscriptionResult.subscription ||
                    subscriptionResult.subscription.status !== 'active' ||
                    !subscriptionResult.subscription.stripe_subscription_id) {
                    throw new Error('No active paid subscription found. Please subscribe first.');
                }
                
                // Call update-subscription Edge Function for scheduled downgrade
                const supabaseProjectUrl = 'https://ofutzrxfbrgtbkyafndv.supabase.co';
                const updateEndpoint = `${supabaseProjectUrl}/functions/v1/update-subscription`;
                
                // Get auth token
                let authToken = null;
                if (window.AuthService && window.AuthService.isAuthenticated()) {
                    authToken = window.AuthService.getAccessToken();
                }
                
                const headers = {
                    'Content-Type': 'application/json'
                };
                
                if (authToken) {
                    headers['Authorization'] = `Bearer ${authToken}`;
                }
                
                const response = await fetch(updateEndpoint, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({
                        userId: currentUser.id,
                        customerId: subscriptionResult.subscription.stripe_customer_id,
                        currentSubscriptionId: subscriptionResult.subscription.stripe_subscription_id,
                        newPlanId: planId,
                        changeType: 'downgrade',
                        recurringBillingEnabled: !subscriptionResult.subscription.cancel_at_period_end  // Inverted logic
                    }),
                    credentials: 'omit'
                });
                
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to schedule downgrade');
                }
                
                const result = await response.json();
                
                if (result.success) {
                    // Sync subscription dates from Stripe to ensure they're up to date
                    console.log('[UpgradeController] Syncing subscription dates after downgrade scheduling...');
                    try {
                        const supabaseProjectUrl = window.SupabaseConfig?.PROJECT_URL || 'https://ofutzrxfbrgtbkyafndv.supabase.co';
                        const syncEndpoint = `${supabaseProjectUrl}/functions/v1/update-subscription`;
                        
                        let accessToken = null;
                        if (window.AuthService && window.AuthService.getSession) {
                            try {
                                const session = await window.AuthService.getSession();
                                if (session && session.access_token) {
                                    accessToken = session.access_token;
                                }
                            } catch (sessionError) {
                                console.warn('[UpgradeController] Error getting session:', sessionError);
                            }
                        }
                        
                        await fetch(syncEndpoint, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
                            },
                            body: JSON.stringify({
                                userId: currentUser.id,
                                syncDates: true
                            })
                        }).catch(err => {
                            console.warn('[UpgradeController] Date sync failed (non-critical):', err);
                        });
                    } catch (syncError) {
                        console.warn('[UpgradeController] Error syncing dates (non-critical):', syncError);
                    }
                    
                    alert(`Downgrade scheduled! You will be moved to ${planName} at the end of your current billing period (${new Date(result.changeDate).toLocaleDateString()}). You will continue to have access to your current plan features until then.`);
                    
                    // Reload subscription and plans to refresh the display
                    await this.loadCurrentSubscription();
                    await this.loadAvailablePlans();
                    await this.renderPlans();
                    this.displayCurrentSubscription();
                } else {
                    throw new Error(result.error || 'Failed to schedule downgrade');
                }
                
                return;
            }
            
            // For upgrades or new subscriptions: use checkout (immediate)
            console.log('[UpgradeController] Processing upgrade/new subscription (immediate)...');
            
            const currentUrl = window.location.href.split('?')[0];
            const successUrl = `${currentUrl}?upgrade=success&plan=${planId}`;
            const cancelUrl = `${currentUrl}?upgrade=cancelled`;
            
            console.log('[UpgradeController] Creating checkout session for upgrade...');
            
            const supabaseProjectUrl = window.SupabaseConfig?.PROJECT_URL || 'https://ofutzrxfbrgtbkyafndv.supabase.co';
            const backendEndpoint = `${supabaseProjectUrl}/functions/v1/create-checkout-session`;
            
            let result;
            
            if (useStripeService && window.StripeService && typeof window.StripeService.createCheckoutSession === 'function') {
                console.log('[UpgradeController] Using StripeService to create checkout session...');
                result = await window.StripeService.createCheckoutSession(
                    currentUser.email,
                    currentUser.id,
                    successUrl,
                    cancelUrl,
                    backendEndpoint,
                    planId,
                    priceAmount
                );
            } else {
                console.log('[UpgradeController] Using direct Edge Function call to create checkout session...');
                
                // Get access token from AuthService
                let accessToken = null;
                if (window.AuthService && window.AuthService.getSession) {
                    try {
                        const session = await window.AuthService.getSession();
                        if (session && session.access_token) {
                            accessToken = session.access_token;
                            console.log('[UpgradeController] ✅ Access token obtained');
                        }
                    } catch (sessionError) {
                        console.warn('[UpgradeController] ⚠️ Error getting session:', sessionError);
                    }
                }
                
                console.log('[UpgradeController] Calling create-checkout-session Edge Function:', {
                    endpoint: backendEndpoint,
                    email: currentUser.email,
                    userId: currentUser.id,
                    planId: planId,
                    priceAmount: priceAmount,
                    hasAccessToken: !!accessToken
                });
                
                const response = await fetch(backendEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
                    },
                    body: JSON.stringify({
                        customerEmail: currentUser.email,
                        userId: currentUser.id,
                        successUrl: successUrl,
                        cancelUrl: cancelUrl,
                        planId: planId,
                        priceAmount: priceAmount
                    })
                });
                
                console.log('[UpgradeController] Edge Function response:', {
                    status: response.status,
                    statusText: response.statusText,
                    ok: response.ok
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    throw new Error(errorData.error || `Server error: ${response.status}`);
                }
                
                const data = await response.json();
                console.log('[UpgradeController] Edge Function response data:', data);
                
                result = {
                    success: data.url ? true : false,
                    sessionId: data.sessionId || null,
                    customerId: data.customerId || null,
                    url: data.url || null,
                    error: data.error || null
                };
            }
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to create checkout session');
            }
            
            if (result.sessionId || result.url) {
                // Store customer ID if returned (non-blocking - webhook will also update this)
                // Use a timeout to ensure redirect happens even if update is slow
                if (result.customerId && window.SubscriptionService) {
                    const customerIdUpdatePromise = window.SubscriptionService.updateSubscription(currentUser.id, {
                        stripe_customer_id: result.customerId
                    }).catch(err => {
                        console.warn('[UpgradeController] Failed to store customer ID (non-critical - webhook will handle):', err.message || err);
                    });
                    
                    // Don't wait for customer ID update - redirect immediately
                    // The webhook will update the customer ID when checkout completes
                    console.log('[UpgradeController] Customer ID update initiated (non-blocking)');
                }
                
                console.log('[UpgradeController] Redirecting to Stripe Checkout...');
                
                // If we have a direct URL (from fallback), use it
                if (result.url) {
                    console.log('[UpgradeController] Using direct checkout URL:', result.url);
                    window.location.href = result.url;
                } else if (result.sessionId && window.StripeService && typeof window.StripeService.redirectToCheckout === 'function') {
                    // If we have StripeService, use its redirect method
                    console.log('[UpgradeController] Using StripeService.redirectToCheckout()');
                    const redirectResult = await window.StripeService.redirectToCheckout(result.sessionId);
                    if (!redirectResult.success) {
                        throw new Error(redirectResult.error || 'Failed to redirect to checkout');
                    }
                } else {
                    throw new Error('No checkout URL or session ID available for redirect');
                }
            } else {
                throw new Error('Checkout session requires backend implementation.');
            }
        } catch (error) {
            console.error('[UpgradeController] Error upgrading subscription:', error);
            alert(`Error: ${error.message || 'Failed to upgrade subscription. Please try again.'}`);
        }
    },
    
    /**
     * Handle successful upgrade - update subscription and refresh display
     */
    async handleUpgradeSuccess(planId) {
        console.log('[UpgradeController] ========== HANDLING UPGRADE SUCCESS ==========');
        console.log('[UpgradeController] New plan ID:', planId);
        
        try {
            // Ensure authentication is ready
            if (!window.AuthService) {
                console.warn('[UpgradeController] AuthService not available, waiting...');
                let authWaitCount = 0;
                const maxAuthWait = 50;
                while (!window.AuthService && authWaitCount < maxAuthWait) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    authWaitCount++;
                }
            }
            
            // Wait for authentication to be confirmed
            let authCheckCount = 0;
            const maxAuthCheck = 50;
            while (authCheckCount < maxAuthCheck) {
                if (window.AuthService && window.AuthService.isAuthenticated() && window.AuthService.currentUser) {
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 100));
                authCheckCount++;
            }
            
            if (!window.AuthService || !window.AuthService.isAuthenticated() || !window.AuthService.currentUser) {
                console.warn('[UpgradeController] User not authenticated after waiting, cannot update subscription');
                alert('Subscription upgrade successful! Please refresh the page to see your updated plan.');
                window.history.replaceState({}, document.title, window.location.pathname);
                return;
            }
            
            const currentUser = window.AuthService.currentUser;
            console.log('[UpgradeController] User authenticated, proceeding with subscription update:', currentUser.id);
            
            // Wait for SubscriptionService and DatabaseService to be available
            let serviceWaitCount = 0;
            const maxServiceWait = 30;
            while ((!window.SubscriptionService || !window.DatabaseService) && serviceWaitCount < maxServiceWait) {
                await new Promise(resolve => setTimeout(resolve, 100));
                serviceWaitCount++;
            }
            
            if (!window.SubscriptionService) {
                console.warn('[UpgradeController] SubscriptionService not available');
                alert('Subscription upgrade successful! Please refresh the page to see your updated plan.');
                window.history.replaceState({}, document.title, window.location.pathname);
                return;
            }
            
            if (!window.DatabaseService) {
                console.warn('[UpgradeController] DatabaseService not available');
                alert('Subscription upgrade successful! Please refresh the page to see your updated plan.');
                window.history.replaceState({}, document.title, window.location.pathname);
                return;
            }
            
            // Ensure DatabaseService is initialized
            if (!window.DatabaseService.client) {
                console.log('[UpgradeController] DatabaseService not initialized, initializing...');
                await window.DatabaseService.initialize();
            }
            
            // Get plan details to determine tier
            console.log('[UpgradeController] Fetching plan details for plan ID:', planId);
            let planName = null;
            const planResult = await window.DatabaseService.querySelect('subscription_plans', {
                filter: { id: parseInt(planId) },
                limit: 1
            });
            
            if (planResult.data && planResult.data.length > 0) {
                planName = planResult.data[0].plan_name;
                console.log('[UpgradeController] Plan name for tier calculation:', planName);
            } else {
                console.warn('[UpgradeController] Plan not found in database for plan ID:', planId);
            }
            
            // Update subscription with new plan ID
            console.log('[UpgradeController] Updating subscription with plan ID:', planId, 'plan name:', planName);
            const updateResult = await window.SubscriptionService.updateSubscription(currentUser.id, {
                plan_id: parseInt(planId),
                status: 'active',  // Status will be synced from Stripe webhook
                updated_at: new Date().toISOString()
            });
            
            console.log('[UpgradeController] Update result:', {
                success: updateResult.success,
                hasSubscription: !!updateResult.subscription,
                error: updateResult.error
            });
            
            // Log tier information
            if (updateResult.success && updateResult.subscription) {
                const tier = window.SubscriptionService.getSubscriptionTier(planName, 'paid');
                console.log('[UpgradeController] ✅ Subscription updated with tier:', tier);
                console.log('[UpgradeController] Updated subscription:', {
                    planId: updateResult.subscription.plan_id,
                    planName: planName,
                    tier: tier,
                    status: updateResult.subscription.status
                });
            }
            
            if (updateResult.success) {
                console.log('[UpgradeController] ✅ Subscription updated successfully:', updateResult.subscription);
                console.log('[UpgradeController] Subscription details for sync check:', {
                    hasSubscription: !!updateResult.subscription,
                    hasStripeSubscriptionId: !!(updateResult.subscription && updateResult.subscription.stripe_subscription_id),
                    hasStripeCustomerId: !!(updateResult.subscription && updateResult.subscription.stripe_customer_id),
                    stripeSubscriptionId: updateResult.subscription?.stripe_subscription_id || 'null',
                    stripeCustomerId: updateResult.subscription?.stripe_customer_id || 'null',
                    status: updateResult.subscription?.status,
                    isPaid: updateResult.subscription?.status === 'active' && !!updateResult.subscription?.stripe_subscription_id
                });
                
                // Attempt to sync subscription dates from Stripe
                // Try if user has active Stripe subscription
                if (updateResult.subscription && updateResult.subscription.status === 'active' && updateResult.subscription.stripe_subscription_id) {
                    console.log('[UpgradeController] ========== ATTEMPTING DATE SYNC ==========');
                    console.log('[UpgradeController] Sync attempt details:', {
                        hasStripeSubscriptionId: !!(updateResult.subscription.stripe_subscription_id),
                        hasStripeCustomerId: !!(updateResult.subscription.stripe_customer_id),
                        willAttemptSync: true
                    });
                    
                    // If we don't have stripe_subscription_id yet, wait a bit for webhook to fire
                    let retryCount = 0;
                    const maxRetries = 3;
                    const retryDelay = 2000; // 2 seconds
                    
                    const attemptSync = async () => {
                        try {
                            const supabaseProjectUrl = window.SupabaseConfig?.PROJECT_URL || 'https://ofutzrxfbrgtbkyafndv.supabase.co';
                            const syncEndpoint = `${supabaseProjectUrl}/functions/v1/update-subscription`;
                            
                            console.log('[UpgradeController] Sync attempt', retryCount + 1, 'of', maxRetries);
                            console.log('[UpgradeController] Calling sync endpoint:', syncEndpoint);
                            
                            let accessToken = null;
                            if (window.AuthService && window.AuthService.getSession) {
                                try {
                                    const session = await window.AuthService.getSession();
                                    if (session && session.access_token) {
                                        accessToken = session.access_token;
                                        console.log('[UpgradeController] ✅ Access token obtained for sync');
                                    } else {
                                        console.warn('[UpgradeController] ⚠️ No access token in session');
                                    }
                                } catch (sessionError) {
                                    console.warn('[UpgradeController] ⚠️ Error getting session for sync:', sessionError);
                                }
                            }
                            
                            const syncPayload = {
                                userId: currentUser.id,
                                syncDates: true // Flag to sync dates from Stripe
                            };
                            
                            console.log('[UpgradeController] Sync request payload:', syncPayload);
                            
                            // Call update-subscription with syncDates flag to fetch dates from Stripe
                            const syncResponse = await fetch(syncEndpoint, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
                                },
                                body: JSON.stringify(syncPayload),
                                credentials: 'omit'
                            });
                            
                            console.log('[UpgradeController] Sync response status:', syncResponse.status, syncResponse.statusText);
                            console.log('[UpgradeController] Sync response ok:', syncResponse.ok);
                            
                            if (syncResponse.ok) {
                                const syncResult = await syncResponse.json();
                                console.log('[UpgradeController] ✅ Subscription dates synced from Stripe successfully');
                                console.log('[UpgradeController] Sync result:', syncResult);
                                return { success: true, result: syncResult };
                            } else {
                                const errorText = await syncResponse.text();
                                console.warn('[UpgradeController] ⚠️ Sync failed with status', syncResponse.status);
                                console.warn('[UpgradeController] Sync error response:', errorText);
                                return { success: false, error: errorText, status: syncResponse.status };
                            }
                        } catch (syncError) {
                            console.error('[UpgradeController] ❌ Exception during sync attempt:', syncError);
                            console.error('[UpgradeController] Sync error details:', {
                                message: syncError.message,
                                stack: syncError.stack,
                                name: syncError.name
                            });
                            return { success: false, error: syncError.message };
                        }
                    };
                    
                    // Try sync immediately
                    let syncResult = await attemptSync();
                    
                    // If sync failed and we don't have stripe_subscription_id, retry after delays
                    if (!syncResult.success && !updateResult.subscription.stripe_subscription_id && retryCount < maxRetries) {
                        console.log('[UpgradeController] ⏳ No stripe_subscription_id yet, waiting for webhook...');
                        for (let i = 0; i < maxRetries; i++) {
                            retryCount++;
                            console.log('[UpgradeController] Waiting', retryDelay, 'ms before retry', retryCount, 'of', maxRetries);
                            await new Promise(resolve => setTimeout(resolve, retryDelay));
                            
                            // Reload subscription to check if webhook has updated it
                            console.log('[UpgradeController] Reloading subscription to check for stripe_subscription_id...');
                            const reloadResult = await window.SubscriptionService.getCurrentUserSubscription();
                            if (reloadResult.success && reloadResult.subscription && reloadResult.subscription.stripe_subscription_id) {
                                console.log('[UpgradeController] ✅ Found stripe_subscription_id after retry:', reloadResult.subscription.stripe_subscription_id);
                                // Update our local subscription object
                                updateResult.subscription = reloadResult.subscription;
                                // Try sync again
                                syncResult = await attemptSync();
                                if (syncResult.success) {
                                    break;
                                }
                            } else {
                                console.log('[UpgradeController] Still no stripe_subscription_id, will retry...');
                            }
                        }
                    }
                    
                    if (!syncResult.success) {
                        console.warn('[UpgradeController] ⚠️ Date sync failed after all attempts (webhook will handle it eventually)');
                        console.warn('[UpgradeController] Final sync error:', syncResult.error);
                    }
                } else {
                    console.log('[UpgradeController] ⏭️ Skipping date sync - subscription status:', updateResult.subscription?.status);
                }
                
                alert(`Subscription upgrade successful! You are now on the ${planName || 'new'} plan.`);
                
                // Reload subscription and plans to refresh the display
                await this.loadCurrentSubscription();
                await this.loadAvailablePlans();
                await this.renderPlans();
                this.displayCurrentSubscription();
            } else {
                console.error('[UpgradeController] ❌ Failed to update subscription:', updateResult.error);
                console.error('[UpgradeController] Error details:', {
                    error: updateResult.error,
                    hasSubscription: !!updateResult.subscription
                });
                // Still show success message - webhook will update it eventually
                alert(`Subscription upgrade successful! Your new plan will be active shortly. If you don't see the update, please refresh the page.`);
            }
            
            // Remove query params
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (error) {
            console.error('[UpgradeController] Error handling upgrade success:', error);
            console.error('[UpgradeController] Error stack:', error.stack);
            // Still show success message - webhook will update it eventually
            alert(`Subscription upgrade successful! Your new plan will be active shortly. If you don't see the update, please refresh the page.`);
            window.history.replaceState({}, document.title, window.location.pathname);
        }
    },
    
    /**
     * Show error message
     */
    showError(message) {
        const errorMessage = document.getElementById('error-message');
        const loadingMessage = document.getElementById('loading-message');
        
        if (loadingMessage) loadingMessage.style.display = 'none';
        if (errorMessage) {
            errorMessage.style.display = 'block';
            errorMessage.textContent = message;
        }
    },
    
    /**
     * Handle update payment button click
     * Opens Stripe Customer Portal for updating payment method
     * For trial users without customer ID, creates a customer first
     */
    async handleUpdatePayment() {
        console.log('[UpgradeController] ========== handleUpdatePayment() STARTED ==========');
        const startTime = Date.now();
        
        try {
            console.log('[UpgradeController] Step 1: Getting button element...');
            const button = document.getElementById('update-payment-button');
            if (button) {
                button.disabled = true;
                button.textContent = 'Loading...';
                console.log('[UpgradeController] ✅ Button found and disabled');
            } else {
                console.warn('[UpgradeController] ⚠️ Button element not found');
            }
            
            console.log('[UpgradeController] Step 2: Checking authentication...');
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                console.error('[UpgradeController] ❌ User not authenticated');
                throw new Error('User not authenticated');
            }
            console.log('[UpgradeController] ✅ User authenticated');
            
            console.log('[UpgradeController] Step 3: Getting current user...');
            const currentUser = window.AuthService.getCurrentUser();
            if (!currentUser || !currentUser.email) {
                console.error('[UpgradeController] ❌ User email not available:', { hasUser: !!currentUser, hasEmail: !!currentUser?.email });
                throw new Error('User email not available');
            }
            console.log('[UpgradeController] ✅ Current user:', { userId: currentUser.id, email: currentUser.email });
            
            console.log('[UpgradeController] Step 4: Loading subscription state...');
            let subscription = null;
            if (window.SubscriptionService) {
                const subscriptionResult = await window.SubscriptionService.getCurrentUserSubscription();
                if (subscriptionResult.success && subscriptionResult.subscription) {
                    subscription = subscriptionResult.subscription;
                }
            }
            const existingCustomerId = subscription?.stripe_customer_id;
            console.log('[UpgradeController] Subscription state:', {
                hasSubscription: !!subscription,
                subscriptionStatus: subscription?.status,
                isPaid: subscription?.status === 'active' && !!subscription?.stripe_subscription_id,
                hasCustomerId: !!existingCustomerId,
                customerId: existingCustomerId || 'none'
            });
            
            console.log('[UpgradeController] Step 5: Checking StripeService availability...');
            if (!window.StripeService) {
                console.error('[UpgradeController] ❌ StripeService not available');
                throw new Error('StripeService not available');
            }
            console.log('[UpgradeController] ✅ StripeService available');
            
            console.log('[UpgradeController] Step 6: Initializing Stripe...');
            await window.StripeService.initialize();
            console.log('[UpgradeController] ✅ Stripe initialized');
            
            let customerId = existingCustomerId;
            
            // If no customer ID, create one first (for trial users)
            if (!customerId) {
                console.log('[UpgradeController] Step 7: No customer ID found, creating customer...');
                console.log('[UpgradeController] Customer creation details:', {
                    email: currentUser.email,
                    userId: currentUser.id
                });
                
                const supabaseProjectUrl = 'https://ofutzrxfbrgtbkyafndv.supabase.co';
                const createCustomerEndpoint = `${supabaseProjectUrl}/functions/v1/create-customer`;
                console.log('[UpgradeController] Customer creation endpoint:', createCustomerEndpoint);
                
                const customerStartTime = Date.now();
                const customerResult = await window.StripeService.createCustomer(
                    currentUser.email,
                    currentUser.id,
                    createCustomerEndpoint
                );
                const customerElapsed = Date.now() - customerStartTime;
                
                console.log('[UpgradeController] Customer creation result:', {
                    success: customerResult.success,
                    hasCustomerId: !!customerResult.customerId,
                    customerId: customerResult.customerId || 'none',
                    error: customerResult.error || 'none',
                    elapsed: `${customerElapsed}ms`
                });
                
                if (!customerResult.success || !customerResult.customerId) {
                    console.error('[UpgradeController] ❌ Customer creation failed:', customerResult.error);
                    throw new Error(customerResult.error || 'Failed to create customer');
                }
                
                customerId = customerResult.customerId;
                console.log('[UpgradeController] ✅ Customer created successfully:', customerId);
                
                // Store customer ID in database (non-blocking)
                if (window.SubscriptionService && subscription) {
                    console.log('[UpgradeController] Step 8: Storing customer ID in database...');
                    window.SubscriptionService.updateSubscription(currentUser.id, {
                        stripe_customer_id: customerId
                    }).then(() => {
                        console.log('[UpgradeController] ✅ Customer ID stored in database');
                    }).catch(err => {
                        console.warn('[UpgradeController] ⚠️ Failed to store customer ID in database:', err);
                    });
                } else {
                    console.log('[UpgradeController] Step 8: Skipping database update (no subscription or SubscriptionService)');
                }
            } else {
                console.log('[UpgradeController] Step 7: Using existing customer ID:', customerId);
            }
            
            console.log('[UpgradeController] Step 9: Preparing portal session...');
            const currentUrl = window.location.href.split('?')[0];
            const returnUrl = currentUrl;
            console.log('[UpgradeController] Portal session details:', {
                customerId: customerId,
                returnUrl: returnUrl
            });
            
            const supabaseProjectUrl = 'https://ofutzrxfbrgtbkyafndv.supabase.co';
            const backendEndpoint = `${supabaseProjectUrl}/functions/v1/create-portal-session`;
            console.log('[UpgradeController] Portal session endpoint:', backendEndpoint);
            
            console.log('[UpgradeController] Step 10: Creating portal session...');
            const portalStartTime = Date.now();
            const result = await window.StripeService.createPortalSession(
                customerId,
                returnUrl,
                backendEndpoint
            );
            const portalElapsed = Date.now() - portalStartTime;
            
            console.log('[UpgradeController] Portal session result:', {
                success: result.success,
                hasUrl: !!result.url,
                url: result.url || 'none',
                error: result.error || 'none',
                elapsed: `${portalElapsed}ms`
            });
            
            if (!result.success) {
                console.error('[UpgradeController] ❌ Portal session creation failed:', result.error);
                throw new Error(result.error || 'Failed to create portal session');
            }
            
            if (result.url) {
                console.log('[UpgradeController] Step 11: Redirecting to Stripe Customer Portal...');
                console.log('[UpgradeController] Portal URL:', result.url);
                const totalElapsed = Date.now() - startTime;
                console.log('[UpgradeController] ========== handleUpdatePayment() SUCCESS ==========');
                console.log('[UpgradeController] Total time:', `${totalElapsed}ms`);
                // Redirect to Stripe Customer Portal
                window.location.href = result.url;
            } else {
                console.error('[UpgradeController] ❌ No portal URL returned');
                throw new Error('No portal URL returned');
            }
        } catch (error) {
            const totalElapsed = Date.now() - startTime;
            console.error('[UpgradeController] ========== handleUpdatePayment() ERROR ==========');
            console.error('[UpgradeController] Error details:', {
                message: error.message,
                stack: error.stack,
                elapsed: `${totalElapsed}ms`
            });
            console.error('[UpgradeController] Error opening payment portal:', error);
            
            alert(`Error: ${error.message || 'Failed to open payment portal. Please try again.'}`);
            
            const button = document.getElementById('update-payment-button');
            if (button) {
                button.disabled = false;
                button.textContent = 'Update Payment Method';
                console.log('[UpgradeController] Button re-enabled');
            }
        }
    },
    
    /**
     * Handle view invoices button click
     * Fetches and displays invoices for the current user
     */
    async handleViewInvoices() {
        console.log('[UpgradeController] ========== handleViewInvoices() STARTED ==========');
        const startTime = Date.now();
        console.log('[UpgradeController] Start time:', new Date().toISOString());
        
        try {
            console.log('[UpgradeController] Step 1: Getting button element...');
            const button = document.getElementById('view-invoices-button');
            console.log('[UpgradeController] Button element check:', {
                found: !!button,
                id: button?.id,
                currentText: button?.textContent,
                currentDisabled: button?.disabled
            });
            if (button) {
                button.disabled = true;
                button.textContent = 'Loading...';
                console.log('[UpgradeController] ✅ Button found and disabled');
                console.log('[UpgradeController] Button state after update:', {
                    disabled: button.disabled,
                    textContent: button.textContent
                });
            } else {
                console.warn('[UpgradeController] ⚠️ Button element not found');
            }
            
            console.log('[UpgradeController] Step 2: Checking authentication...');
            console.log('[UpgradeController] AuthService check:', {
                hasAuthService: !!window.AuthService,
                authServiceType: typeof window.AuthService,
                hasIsAuthenticated: !!(window.AuthService && typeof window.AuthService.isAuthenticated === 'function')
            });
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                console.error('[UpgradeController] ❌ User not authenticated');
                console.error('[UpgradeController] AuthService state:', {
                    hasAuthService: !!window.AuthService,
                    isAuthenticated: window.AuthService ? window.AuthService.isAuthenticated() : 'N/A'
                });
                throw new Error('User not authenticated');
            }
            const currentUser = window.AuthService.getCurrentUser();
            console.log('[UpgradeController] ✅ User authenticated');
            console.log('[UpgradeController] Current user:', {
                hasUser: !!currentUser,
                userId: currentUser?.id,
                userEmail: currentUser?.email
            });
            
            console.log('[UpgradeController] Step 3: Getting subscription data...');
            console.log('[UpgradeController] Current subscription state:', {
                hasCurrentSubscription: !!this.currentSubscription,
                subscriptionKeys: this.currentSubscription ? Object.keys(this.currentSubscription) : [],
                hasStripeCustomerId: !!(this.currentSubscription?.stripe_customer_id),
                stripeCustomerId: this.currentSubscription?.stripe_customer_id || null,
                status: this.currentSubscription?.status || null,
                isPaid: this.currentSubscription?.status === 'active' && !!this.currentSubscription?.stripe_subscription_id
            });
            if (!this.currentSubscription || !this.currentSubscription.stripe_customer_id) {
                console.error('[UpgradeController] ❌ No Stripe customer ID found');
                console.error('[UpgradeController] Subscription data available:', {
                    hasSubscription: !!this.currentSubscription,
                    subscriptionData: this.currentSubscription ? JSON.stringify(this.currentSubscription, null, 2) : 'null'
                });
                throw new Error('No active subscription found. Invoices are only available for paid subscriptions.');
            }
            
            const customerId = this.currentSubscription.stripe_customer_id;
            console.log('[UpgradeController] ✅ Customer ID:', customerId);
            console.log('[UpgradeController] Customer ID details:', {
                customerId: customerId,
                length: customerId?.length,
                startsWithCus: customerId?.startsWith('cus_'),
                type: typeof customerId
            });
            
            console.log('[UpgradeController] Step 4: Opening invoice modal...');
            const modalOpenResult = this.openInvoiceModal();
            console.log('[UpgradeController] Modal open result:', modalOpenResult);
            
            console.log('[UpgradeController] Step 5: Checking StripeService availability...');
            console.log('[UpgradeController] Window object check:', {
                hasWindow: typeof window !== 'undefined',
                windowType: typeof window
            });
            console.log('[UpgradeController] StripeService check:', {
                hasStripeService: !!window.StripeService,
                stripeServiceType: typeof window.StripeService,
                stripeServiceValue: window.StripeService,
                hasListInvoices: !!(window.StripeService && typeof window.StripeService.listInvoices === 'function')
            });
            
            // Check for script loading issues
            console.log('[UpgradeController] Checking for StripeService script tag...');
            const stripeServiceScript = document.querySelector('script[src*="StripeService"]');
            console.log('[UpgradeController] StripeService script tag:', {
                found: !!stripeServiceScript,
                src: stripeServiceScript?.src,
                loaded: stripeServiceScript?.getAttribute('data-loaded') || 'unknown'
            });
            
            // Check all window properties that might be related
            console.log('[UpgradeController] Window properties check:', {
                hasStripe: !!window.Stripe,
                hasStripeConfig: !!window.StripeConfig,
                hasStripeService: !!window.StripeService,
                windowKeys: Object.keys(window).filter(key => key.toLowerCase().includes('stripe'))
            });
            
            // Brief wait for StripeService to be available
            const maxWaitTime = 250; 
            const startWaitTime = Date.now();
            
            console.log('[UpgradeController] Brief check for StripeService availability...');
            if (!window.StripeService) {
                // Wait up to 30ms for StripeService to load
                await new Promise(resolve => setTimeout(resolve, maxWaitTime));
            }
            
            const elapsed = Date.now() - startWaitTime;
            console.log('[UpgradeController] StripeService check completed:', {
                elapsed: elapsed,
                hasStripeService: !!window.StripeService,
                stripeServiceType: typeof window.StripeService
            });
            
            // Fallback: Call Edge Function directly if StripeService is not available
            const supabaseProjectUrl = window.SupabaseConfig?.PROJECT_URL || 'https://ofutzrxfbrgtbkyafndv.supabase.co';
            const backendEndpoint = `${supabaseProjectUrl}/functions/v1/list-invoices`;
            
            let result;
            
            if (!window.StripeService) {
                console.warn('[UpgradeController] ⚠️ StripeService not available, using direct Edge Function call as fallback');
                console.log('[UpgradeController] Calling Edge Function directly...');
                
                // Get access token from AuthService
                let accessToken = null;
                if (window.AuthService && window.AuthService.getSession) {
                    try {
                        const session = await window.AuthService.getSession();
                        if (session && session.access_token) {
                            accessToken = session.access_token;
                            console.log('[UpgradeController] ✅ Access token obtained');
                        } else {
                            console.warn('[UpgradeController] ⚠️ No access token in session');
                        }
                    } catch (sessionError) {
                        console.warn('[UpgradeController] ⚠️ Error getting session:', sessionError);
                    }
                }
                
                console.log('[UpgradeController] Direct Edge Function call:', {
                    endpoint: backendEndpoint,
                    customerId: customerId,
                    limit: 20,
                    hasAccessToken: !!accessToken
                });
                
                const response = await fetch(backendEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
                    },
                    body: JSON.stringify({
                        customerId: customerId,
                        limit: 20
                    })
                });
                
                console.log('[UpgradeController] Edge Function response:', {
                    status: response.status,
                    statusText: response.statusText,
                    ok: response.ok
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    throw new Error(errorData.error || `Server error: ${response.status}`);
                }
                
                const data = await response.json();
                console.log('[UpgradeController] Edge Function response data:', {
                    success: data.success,
                    hasInvoices: !!(data.invoices && data.invoices.length > 0),
                    invoiceCount: data.invoices ? data.invoices.length : 0
                });
                
                result = {
                    success: data.success || false,
                    invoices: data.invoices || [],
                    count: data.count || (data.invoices ? data.invoices.length : 0),
                    error: data.error || null
                };
            } else {
                if (typeof window.StripeService.listInvoices !== 'function') {
                    console.error('[UpgradeController] ❌ StripeService.listInvoices is not a function');
                    console.error('[UpgradeController] StripeService methods:', Object.keys(window.StripeService));
                    throw new Error('StripeService.listInvoices method not available. The service may not be fully loaded.');
                }
                
                console.log('[UpgradeController] ✅ StripeService available with listInvoices method');
                console.log('[UpgradeController] Step 6: Fetching invoices from Stripe...');
                console.log('[UpgradeController] SupabaseConfig check:', {
                    hasSupabaseConfig: !!window.SupabaseConfig,
                    supabaseConfigType: typeof window.SupabaseConfig,
                    hasProjectUrl: !!(window.SupabaseConfig?.PROJECT_URL),
                    projectUrl: window.SupabaseConfig?.PROJECT_URL || 'not found'
                });
                console.log('[UpgradeController] Backend endpoint constructed:', {
                    supabaseProjectUrl: supabaseProjectUrl,
                    backendEndpoint: backendEndpoint,
                    endpointLength: backendEndpoint.length
                });
                
                console.log('[UpgradeController] Calling StripeService.listInvoices with:', {
                    customerId: customerId,
                    customerIdType: typeof customerId,
                    customerIdLength: customerId?.length,
                    limit: 20,
                    limitType: typeof 20,
                    backendEndpoint: backendEndpoint,
                    backendEndpointType: typeof backendEndpoint
                });
                console.log('[UpgradeController] About to call StripeService.listInvoices...');
                
                result = await window.StripeService.listInvoices(customerId, 20, backendEndpoint);
            }
            
            console.log('[UpgradeController] StripeService.listInvoices result:', {
                success: result.success,
                hasInvoices: !!(result.invoices && result.invoices.length > 0),
                invoiceCount: result.invoices ? result.invoices.length : 0,
                error: result.error || null
            });
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch invoices');
            }
            
            console.log('[UpgradeController] Step 7: Displaying invoices...');
            console.log('[UpgradeController] Invoices to display:', {
                invoiceCount: result.invoices ? result.invoices.length : 0,
                hasInvoices: !!(result.invoices && result.invoices.length > 0),
                invoiceData: result.invoices ? result.invoices.map(inv => ({
                    id: inv.id,
                    number: inv.number,
                    amount: inv.amount_paid,
                    status: inv.status
                })) : []
            });
            this.displayInvoices(result.invoices || []);
            
            const totalElapsed = Date.now() - startTime;
            console.log('[UpgradeController] ========== handleViewInvoices() SUCCESS ==========');
            console.log('[UpgradeController] Total time:', `${totalElapsed}ms`);
            console.log('[UpgradeController] End time:', new Date().toISOString());
        } catch (error) {
            const totalElapsed = Date.now() - startTime;
            console.error('[UpgradeController] ========== handleViewInvoices() ERROR ==========');
            console.error('[UpgradeController] Error occurred after:', `${totalElapsed}ms`);
            console.error('[UpgradeController] Error time:', new Date().toISOString());
            console.error('[UpgradeController] Error details:', {
                message: error.message,
                name: error.name,
                stack: error.stack,
                elapsed: `${totalElapsed}ms`,
                errorType: typeof error,
                errorConstructor: error.constructor?.name
            });
            console.error('[UpgradeController] Full error object:', error);
            
            console.log('[UpgradeController] Step 8: Displaying error in modal...');
            const errorMessage = error.message || 'Failed to load invoices. Please try again.';
            console.log('[UpgradeController] Error message to display:', errorMessage);
            this.displayInvoiceError(errorMessage);
            
            console.log('[UpgradeController] Step 9: Re-enabling button...');
            const button = document.getElementById('view-invoices-button');
            console.log('[UpgradeController] Button element check for re-enable:', {
                found: !!button,
                id: button?.id,
                currentDisabled: button?.disabled,
                currentText: button?.textContent
            });
            if (button) {
                button.disabled = false;
                button.textContent = 'View Invoices';
                console.log('[UpgradeController] ✅ Button re-enabled');
                console.log('[UpgradeController] Button state after re-enable:', {
                    disabled: button.disabled,
                    textContent: button.textContent
                });
            } else {
                console.warn('[UpgradeController] ⚠️ Button element not found for re-enable');
            }
            
            console.error('[UpgradeController] ========== handleViewInvoices() ERROR HANDLING COMPLETE ==========');
        }
    },
    
    /**
     * Open invoice modal
     */
    openInvoiceModal() {
        console.log('[UpgradeController] ========== openInvoiceModal() CALLED ==========');
        const modal = document.getElementById('invoice-modal');
        console.log('[UpgradeController] Modal element check:', {
            found: !!modal,
            id: modal?.id,
            currentClasses: modal?.className,
            currentDisplay: modal ? window.getComputedStyle(modal).display : 'N/A'
        });
        
        if (modal) {
            modal.classList.add('active');
            console.log('[UpgradeController] Modal classes after adding active:', modal.className);
            const body = document.getElementById('invoice-modal-body');
            console.log('[UpgradeController] Modal body check:', {
                found: !!body,
                id: body?.id,
                currentInnerHTML: body ? body.innerHTML.substring(0, 100) : 'N/A'
            });
            if (body) {
                body.innerHTML = '<div class="invoice-loading">Loading invoices...</div>';
                console.log('[UpgradeController] ✅ Modal body updated with loading message');
            } else {
                console.warn('[UpgradeController] ⚠️ Modal body element not found');
            }
            console.log('[UpgradeController] Modal display after update:', window.getComputedStyle(modal).display);
            return { success: true, modalFound: true, bodyFound: !!body };
        } else {
            console.error('[UpgradeController] ❌ Modal element not found');
            return { success: false, modalFound: false, bodyFound: false };
        }
    },
    
    /**
     * Close invoice modal
     */
    closeInvoiceModal() {
        console.log('[UpgradeController] ========== closeInvoiceModal() CALLED ==========');
        const modal = document.getElementById('invoice-modal');
        console.log('[UpgradeController] Modal element check:', {
            found: !!modal,
            id: modal?.id,
            currentClasses: modal?.className,
            hasActiveClass: modal?.classList.contains('active')
        });
        
        if (modal) {
            modal.classList.remove('active');
            console.log('[UpgradeController] ✅ Modal active class removed');
            console.log('[UpgradeController] Modal classes after removal:', modal.className);
            console.log('[UpgradeController] Modal display after update:', window.getComputedStyle(modal).display);
        } else {
            console.warn('[UpgradeController] ⚠️ Modal element not found');
        }
        
        const button = document.getElementById('view-invoices-button');
        console.log('[UpgradeController] Button element check:', {
            found: !!button,
            id: button?.id,
            currentDisabled: button?.disabled,
            currentText: button?.textContent
        });
        if (button) {
            button.disabled = false;
            button.textContent = 'View Invoices';
            console.log('[UpgradeController] ✅ Button re-enabled');
            console.log('[UpgradeController] Button state after update:', {
                disabled: button.disabled,
                textContent: button.textContent
            });
        } else {
            console.warn('[UpgradeController] ⚠️ Button element not found');
        }
    },
    
    /**
     * Display invoices in modal
     */
    displayInvoices(invoices) {
        console.log('[UpgradeController] ========== displayInvoices() CALLED ==========');
        console.log('[UpgradeController] Input invoices:', {
            invoiceCount: invoices ? invoices.length : 0,
            isArray: Array.isArray(invoices),
            invoices: invoices ? invoices.map(inv => ({
                id: inv.id,
                number: inv.number,
                amount: inv.amount_paid,
                status: inv.status,
                hasHostedUrl: !!inv.hosted_invoice_url,
                hasPdf: !!inv.invoice_pdf
            })) : []
        });
        
        const body = document.getElementById('invoice-modal-body');
        console.log('[UpgradeController] Modal body element check:', {
            found: !!body,
            id: body?.id,
            currentInnerHTML: body ? body.innerHTML.substring(0, 200) : 'N/A'
        });
        if (!body) {
            console.error('[UpgradeController] ❌ Modal body element not found');
            return;
        }
        
        if (invoices.length === 0) {
            console.log('[UpgradeController] No invoices to display, showing empty message');
            body.innerHTML = '<div class="invoice-empty">No invoices found.</div>';
            console.log('[UpgradeController] ✅ Empty message displayed');
            return;
        }
        
        console.log('[UpgradeController] Processing', invoices.length, 'invoices for display...');
        
        const formatDate = (dateString) => {
            console.log('[UpgradeController] formatDate called with:', dateString);
            if (!dateString) {
                console.log('[UpgradeController] No date string provided, returning N/A');
                return 'N/A';
            }
            try {
                const date = new Date(dateString);
                const formatted = date.toLocaleString('en-GB', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
                console.log('[UpgradeController] Date formatted:', { input: dateString, output: formatted });
                return formatted;
            } catch (error) {
                console.error('[UpgradeController] Error formatting date:', error);
                return 'Invalid Date';
            }
        };
        
        const formatCurrency = (amount, currency) => {
            console.log('[UpgradeController] formatCurrency called with:', { amount, currency });
            try {
                const formatted = new Intl.NumberFormat('en-GB', {
                    style: 'currency',
                    currency: currency || 'EUR'
                }).format(amount);
                console.log('[UpgradeController] Currency formatted:', { input: { amount, currency }, output: formatted });
                return formatted;
            } catch (error) {
                console.error('[UpgradeController] Error formatting currency:', error);
                return `${amount} ${currency || 'EUR'}`;
            }
        };
        
        const getStatusClass = (status) => {
            console.log('[UpgradeController] getStatusClass called with:', status);
            const statusMap = {
                'paid': 'paid',
                'open': 'open',
                'draft': 'draft',
                'void': 'draft',
                'uncollectible': 'draft'
            };
            const statusLower = status ? status.toLowerCase() : '';
            const mappedClass = statusMap[statusLower] || 'draft';
            console.log('[UpgradeController] Status class mapped:', { input: status, output: mappedClass });
            return mappedClass;
        };
        
        console.log('[UpgradeController] Generating HTML for invoices...');
        const invoiceHTMLParts = invoices.map((invoice, index) => {
            console.log(`[UpgradeController] Processing invoice ${index + 1}/${invoices.length}:`, {
                id: invoice.id,
                number: invoice.number,
                amount: invoice.amount_paid,
                status: invoice.status,
                hasHostedUrl: !!invoice.hosted_invoice_url,
                hasPdf: !!invoice.invoice_pdf
            });
            
            const formattedDate = formatDate(invoice.created);
            const formattedAmount = formatCurrency(invoice.amount_paid, invoice.currency);
            const statusClass = getStatusClass(invoice.status);
            
            return `
                    <li class="invoice-item">
                        <div class="invoice-item-info">
                            <div class="invoice-item-number">Invoice ${invoice.number || invoice.id}</div>
                            <div class="invoice-item-date">${formattedDate}</div>
                            <div class="invoice-item-amount">${formattedAmount}</div>
                        </div>
                        <div>
                            <span class="invoice-item-status ${statusClass}">${invoice.status}</span>
                        </div>
                        <div class="invoice-item-actions">
                            ${invoice.hosted_invoice_url ? `
                                <a href="${invoice.hosted_invoice_url}" target="_blank" class="btn btn-action" style="text-decoration: none;">
                                    View Invoice
                                </a>
                            ` : ''}
                            ${invoice.invoice_pdf ? `
                                <a href="${invoice.invoice_pdf}" target="_blank" class="btn btn-action" style="text-decoration: none;">
                                    Download PDF
                                </a>
                            ` : ''}
                        </div>
                    </li>
                `;
        });
        
        const invoicesHTML = `
            <ul class="invoice-list">
                ${invoiceHTMLParts.join('')}
            </ul>
        `;
        
        console.log('[UpgradeController] HTML generated, length:', invoicesHTML.length);
        console.log('[UpgradeController] HTML preview (first 500 chars):', invoicesHTML.substring(0, 500));
        
        body.innerHTML = invoicesHTML;
        console.log('[UpgradeController] ✅ Invoices HTML inserted into modal body');
        console.log('[UpgradeController] Modal body after update:', {
            innerHTMLLength: body.innerHTML.length,
            childElementCount: body.children.length,
            firstChildTag: body.firstElementChild?.tagName
        });
    },
    
    /**
     * Display invoice error in modal
     */
    displayInvoiceError(errorMessage) {
        console.log('[UpgradeController] ========== displayInvoiceError() CALLED ==========');
        console.log('[UpgradeController] Error message:', errorMessage);
        const body = document.getElementById('invoice-modal-body');
        console.log('[UpgradeController] Modal body element check:', {
            found: !!body,
            id: body?.id,
            currentInnerHTML: body ? body.innerHTML.substring(0, 200) : 'N/A'
        });
        if (body) {
            body.innerHTML = `<div class="invoice-error">${errorMessage}</div>`;
            console.log('[UpgradeController] ✅ Error message displayed in modal');
            console.log('[UpgradeController] Modal body after error update:', {
                innerHTMLLength: body.innerHTML.length,
                innerHTML: body.innerHTML
            });
        } else {
            console.error('[UpgradeController] ❌ Modal body element not found');
        }
    },
    
    /**
     * Display current subscription details including recurring billing status
     */
    displayCurrentSubscription() {
        console.log('[UpgradeController] ========== displayCurrentSubscription() CALLED ==========');
        const startTime = Date.now();
        console.log('[UpgradeController] Call stack:', new Error().stack);
        
        console.log('[UpgradeController] Step 1: Checking DOM elements...');
        console.log('[UpgradeController] Document ready state:', document.readyState);
        console.log('[UpgradeController] Document body exists:', !!document.body);
        
        const container = document.getElementById('current-subscription-details');
        const content = document.getElementById('current-subscription-content');
        
        console.log('[UpgradeController] Step 1 results - DOM elements:', {
            hasContainer: !!container,
            containerId: container?.id || 'NOT FOUND',
            containerTagName: container?.tagName || 'N/A',
            containerDisplay: container?.style?.display || 'N/A',
            containerComputedDisplay: container ? window.getComputedStyle(container).display : 'N/A',
            hasContent: !!content,
            contentId: content?.id || 'NOT FOUND',
            contentTagName: content?.tagName || 'N/A',
            hasSubscription: !!this.currentSubscription,
            hasPlan: !!this.currentPlan,
            subscriptionType: typeof this.currentSubscription,
            planType: typeof this.currentPlan
        });
        
        // Check if elements exist in DOM
        if (!container) {
            console.error('[UpgradeController] ❌ Container element NOT FOUND: current-subscription-details');
            console.error('[UpgradeController] Searching for all elements with "subscription" in id...');
            const allElements = document.querySelectorAll('[id*="subscription"]');
            console.log('[UpgradeController] Found elements with "subscription" in id:', Array.from(allElements).map(el => el.id));
            console.error('[UpgradeController] Aborting displayCurrentSubscription() - container missing');
            return;
        }
        
        if (!content) {
            console.error('[UpgradeController] ❌ Content element NOT FOUND: current-subscription-content');
            console.error('[UpgradeController] Container children:', Array.from(container.children).map(child => ({
                tagName: child.tagName,
                id: child.id,
                className: child.className
            })));
            console.error('[UpgradeController] Aborting displayCurrentSubscription() - content missing');
            return;
        }
        
        console.log('[UpgradeController] ✅ Both DOM elements found');
        console.log('[UpgradeController] Step 2: Checking subscription data...');
        
        if (!this.currentSubscription) {
            console.warn('[UpgradeController] ⚠️ No subscription data available');
            console.warn('[UpgradeController] this.currentSubscription value:', this.currentSubscription);
            console.warn('[UpgradeController] Hiding container...');
            container.style.display = 'none';
            console.log('[UpgradeController] Container display set to "none"');
            return;
        }
        
        console.log('[UpgradeController] ✅ Subscription data available');
        const subscription = this.currentSubscription;
        const plan = this.currentPlan;
        const detailsHtml = [];
        
        console.log('[UpgradeController] Step 3: Analyzing subscription data...');
        console.log('[UpgradeController] Full subscription object:', JSON.stringify(subscription, null, 2));
        console.log('[UpgradeController] Full plan object:', JSON.stringify(plan, null, 2));
        console.log('[UpgradeController] Subscription keys:', Object.keys(subscription));
        console.log('[UpgradeController] Plan keys:', plan ? Object.keys(plan) : 'plan is null/undefined');
        
        console.log('[UpgradeController] Step 4: Building details HTML...');
        
        // Plan Name
        console.log('[UpgradeController] Checking plan name...', {
            hasPlan: !!plan,
            planName: plan?.plan_name,
            planNameType: typeof plan?.plan_name,
            willAdd: !!(plan && plan.plan_name)
        });
        if (plan && plan.plan_name) {
            const planHtml = `<div style="display: flex; justify-content: space-between; padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));"><strong>Plan:</strong><span>${plan.plan_name}</span></div>`;
            detailsHtml.push(planHtml);
            console.log('[UpgradeController] ✅ Added Plan name:', plan.plan_name);
        } else {
            console.log('[UpgradeController] ⏭️ Skipping Plan name (plan:', plan, ', plan_name:', plan?.plan_name, ')');
        }
        
        // Subscription Status
        console.log('[UpgradeController] Checking subscription status...', {
            hasStatus: !!subscription.status,
            status: subscription.status,
            statusType: typeof subscription.status
        });
        if (subscription.status) {
            const statusColor = subscription.status === 'active' ? 'var(--success-color, #28a745)' : 'var(--text-secondary)';
            const statusHtml = `<div style="display: flex; justify-content: space-between; padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));"><strong>Status:</strong><span style="color: ${statusColor};">${subscription.status.charAt(0).toUpperCase() + subscription.status.slice(1)}</span></div>`;
            detailsHtml.push(statusHtml);
            console.log('[UpgradeController] ✅ Added Status:', subscription.status, 'with color:', statusColor);
        } else {
            console.log('[UpgradeController] ⏭️ Skipping Status (status:', subscription.status, ')');
        }
        
        // Subscription Type (derived from status and stripe_subscription_id)
        console.log('[UpgradeController] Checking subscription type...', {
            status: subscription.status,
            hasStripeSubscriptionId: !!subscription.stripe_subscription_id
        });
        const subscriptionType = subscription.status === 'trial' ? 'Trial' :
                                subscription.status === 'active' && subscription.stripe_subscription_id ? 'Paid' : 'Free';
        const typeHtml = `<div style="display: flex; justify-content: space-between; padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));"><strong>Type:</strong><span>${subscriptionType}</span></div>`;
        detailsHtml.push(typeHtml);
        console.log('[UpgradeController] ✅ Added Type:', subscriptionType);
        
        // Next Billing Date (current_period_end for paid subscriptions)
        console.log('[UpgradeController] Checking next billing date...', {
            hasCurrentPeriodEnd: !!subscription.current_period_end,
            currentPeriodEnd: subscription.current_period_end
        });
        if (subscription.current_period_end) {
            const nextBilling = new Date(subscription.current_period_end);
            const nextBillingHtml = `<div style="display: flex; justify-content: space-between; padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));"><strong>Next Billing:</strong><span>${nextBilling.toLocaleDateString()}</span></div>`;
            detailsHtml.push(nextBillingHtml);
            console.log('[UpgradeController] ✅ Added Next Billing:', nextBilling.toLocaleDateString());
        } else {
            console.log('[UpgradeController] ⏭️ Skipping Next Billing (no current_period_end)');
        }
        
        // Subscription End Date (current_period_end for paid, trial_end for trial)
        const endDateField = subscription.current_period_end || subscription.trial_end;
        console.log('[UpgradeController] Checking subscription end date...', {
            hasEndDate: !!endDateField,
            endDate: endDateField
        });
        if (endDateField) {
            const endDate = new Date(endDateField);
            const endDateHtml = `<div style="display: flex; justify-content: space-between; padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));"><strong>Ends:</strong><span>${endDate.toLocaleDateString()}</span></div>`;
            detailsHtml.push(endDateHtml);
            console.log('[UpgradeController] ✅ Added Ends:', endDate.toLocaleDateString());
        } else {
            console.log('[UpgradeController] ⏭️ Skipping Ends (no end date found)');
        }
        
        // Recurring Billing Toggle (Auto-Renewal) - show for paid subscriptions
        const isPaidSubscription = subscription.status === 'active' && subscription.stripe_subscription_id;
        console.log('[UpgradeController] Checking recurring billing status...', {
            status: subscription.status,
            isPaid: isPaidSubscription,
            hasStripeSubscriptionId: !!subscription.stripe_subscription_id,
            cancelAtPeriodEnd: subscription.cancel_at_period_end
        });
        if (isPaidSubscription) {
            const recurringBillingEnabled = !subscription.cancel_at_period_end; // Inverted logic
            const toggleId = 'recurring-billing-toggle-upgrade';
            const recurringHtml = `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: var(--spacing-xs) 0; border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.1));">
                    <strong>Auto-Renewal (Recurring):</strong>
                    <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
                        <input type="checkbox" id="${toggleId}" ${recurringBillingEnabled ? 'checked' : ''} style="cursor: pointer;">
                        <span>${recurringBillingEnabled ? 'Enabled' : 'Disabled'}</span>
                    </label>
                </div>
            `;
            detailsHtml.push(recurringHtml);
            console.log('[UpgradeController] ✅ Added Auto-Renewal (Recurring) toggle:', recurringBillingEnabled ? 'Enabled' : 'Disabled', 'with toggle ID:', toggleId);
        } else {
            console.log('[UpgradeController] ⏭️ Skipping Auto-Renewal (not a paid subscription)');
        }
        
        console.log('[UpgradeController] Step 5: Finalizing HTML generation...');
        console.log('[UpgradeController] Total details HTML items generated:', detailsHtml.length);
        console.log('[UpgradeController] Details HTML preview (first 200 chars):', detailsHtml.join('').substring(0, 200));
        
        if (detailsHtml.length > 0) {
            console.log('[UpgradeController] Step 6: Updating DOM with subscription details...');
            console.log('[UpgradeController] Content element before update:', {
                innerHTML: content.innerHTML.substring(0, 100),
                innerHTMLLength: content.innerHTML.length,
                childElementCount: content.childElementCount
            });
            
            content.innerHTML = detailsHtml.join('');
            console.log('[UpgradeController] Content innerHTML set, new length:', content.innerHTML.length);
            
            console.log('[UpgradeController] Container before display change:', {
                display: container.style.display,
                computedDisplay: window.getComputedStyle(container).display,
                visibility: window.getComputedStyle(container).visibility,
                opacity: window.getComputedStyle(container).opacity
            });
            
            container.style.display = 'block';
            console.log('[UpgradeController] Container display set to "block"');
            
            console.log('[UpgradeController] Container after display change:', {
                display: container.style.display,
                computedDisplay: window.getComputedStyle(container).display,
                visibility: window.getComputedStyle(container).visibility,
                opacity: window.getComputedStyle(container).opacity,
                offsetHeight: container.offsetHeight,
                offsetWidth: container.offsetWidth
            });
            
            console.log('[UpgradeController] Content element after update:', {
                innerHTML: content.innerHTML.substring(0, 200),
                innerHTMLLength: content.innerHTML.length,
                childElementCount: content.childElementCount,
                children: Array.from(content.children).map(child => ({
                    tagName: child.tagName,
                    textContent: child.textContent?.substring(0, 50)
                }))
            });
            
            // Set up recurring billing toggle event listener
            console.log('[UpgradeController] Step 7: Setting up recurring billing toggle event listener...');
            const toggle = document.getElementById('recurring-billing-toggle-upgrade');
            console.log('[UpgradeController] Toggle element:', {
                found: !!toggle,
                id: toggle?.id || 'NOT FOUND',
                checked: toggle?.checked,
                disabled: toggle?.disabled
            });
            
            if (toggle) {
                // Remove existing listeners to prevent duplicates
                const newToggle = toggle.cloneNode(true);
                toggle.parentNode.replaceChild(newToggle, toggle);
                
                newToggle.addEventListener('change', async (e) => {
                    console.log('[UpgradeController] Recurring billing toggle changed:', e.target.checked);
                    await this.handleRecurringBillingToggle(e.target.checked);
                });
                console.log('[UpgradeController] ✅ Recurring billing toggle event listener attached');
            } else {
                console.warn('[UpgradeController] ⚠️ Recurring billing toggle not found, cannot attach event listener');
            }
            
            const totalElapsed = Date.now() - startTime;
            console.log('[UpgradeController] ✅ Subscription details displayed successfully in', totalElapsed, 'ms');
        } else {
            console.warn('[UpgradeController] ⚠️ No details to display, hiding container');
            console.warn('[UpgradeController] This means no fields matched the conditions to be displayed');
            container.style.display = 'none';
            console.log('[UpgradeController] Container display set to "none"');
        }
        
        const totalElapsed = Date.now() - startTime;
        console.log('[UpgradeController] ========== displayCurrentSubscription() COMPLETE in', totalElapsed, 'ms ==========');
    },
    
    /**
     * Load and display recent invoices (last 3)
     */
    async loadRecentInvoices() {
        console.log('[UpgradeController] ========== loadRecentInvoices() STARTED ==========');
        const startTime = Date.now();
        
        try {
            const section = document.getElementById('recent-invoices-section');
            const content = document.getElementById('recent-invoices-content');
            
            if (!section || !content) {
                console.warn('[UpgradeController] Recent invoices section not found');
                return;
            }
            
            if (!this.currentSubscription || !this.currentSubscription.stripe_customer_id) {
                console.log('[UpgradeController] No customer ID, hiding recent invoices section');
                section.style.display = 'none';
                return;
            }
            
            const customerId = this.currentSubscription.stripe_customer_id;
            console.log('[UpgradeController] Fetching recent invoices for customer:', customerId);
            
            const supabaseProjectUrl = window.SupabaseConfig?.PROJECT_URL || 'https://ofutzrxfbrgtbkyafndv.supabase.co';
            const backendEndpoint = `${supabaseProjectUrl}/functions/v1/list-invoices`;
            
            // Show loading state
            section.style.display = 'block';
            content.innerHTML = '<div class="invoice-loading-small">Loading invoices...</div>';
            
            let result;
            
            // Try to use StripeService if available, otherwise use direct call
            if (window.StripeService && typeof window.StripeService.listInvoices === 'function') {
                console.log('[UpgradeController] Using StripeService to fetch invoices');
                result = await window.StripeService.listInvoices(customerId, 3, backendEndpoint);
            } else {
                console.log('[UpgradeController] Using direct Edge Function call');
                let accessToken = null;
                if (window.AuthService && window.AuthService.getSession) {
                    try {
                        const session = await window.AuthService.getSession();
                        if (session && session.access_token) {
                            accessToken = session.access_token;
                        }
                    } catch (sessionError) {
                        console.warn('[UpgradeController] Error getting session:', sessionError);
                    }
                }
                
                const response = await fetch(backendEndpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(accessToken && { 'Authorization': `Bearer ${accessToken}` })
                    },
                    body: JSON.stringify({
                        customerId: customerId,
                        limit: 3
                    })
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    throw new Error(errorData.error || `Server error: ${response.status}`);
                }
                
                const data = await response.json();
                result = {
                    success: data.success || false,
                    invoices: data.invoices || [],
                    count: data.count || (data.invoices ? data.invoices.length : 0),
                    error: data.error || null
                };
            }
            
            if (!result.success) {
                throw new Error(result.error || 'Failed to fetch invoices');
            }
            
            const invoices = result.invoices || [];
            console.log('[UpgradeController] Recent invoices fetched:', invoices.length);
            
            this.displayRecentInvoices(invoices);
            
            const totalElapsed = Date.now() - startTime;
            console.log('[UpgradeController] ========== loadRecentInvoices() COMPLETE in', totalElapsed, 'ms ==========');
        } catch (error) {
            console.error('[UpgradeController] Error loading recent invoices:', error);
            const section = document.getElementById('recent-invoices-section');
            const content = document.getElementById('recent-invoices-content');
            if (section && content) {
                section.style.display = 'block';
                content.innerHTML = '<div class="invoice-error-small">Unable to load invoices</div>';
            }
        }
    },
    
    /**
     * Display recent invoices in the compact section
     */
    displayRecentInvoices(invoices) {
        console.log('[UpgradeController] ========== displayRecentInvoices() CALLED ==========');
        console.log('[UpgradeController] Invoices to display:', invoices.length);
        
        const content = document.getElementById('recent-invoices-content');
        if (!content) {
            console.error('[UpgradeController] Recent invoices content element not found');
            return;
        }
        
        if (invoices.length === 0) {
            content.innerHTML = '<div class="invoice-empty-small">No invoices found</div>';
            return;
        }
        
        const formatDate = (dateString) => {
            if (!dateString) return 'N/A';
            try {
                const date = new Date(dateString);
                return date.toLocaleString('en-GB', { 
                    day: '2-digit', 
                    month: '2-digit', 
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
            } catch (error) {
                return 'Invalid Date';
            }
        };
        
        const formatCurrency = (amount, currency) => {
            try {
                return new Intl.NumberFormat('en-GB', {
                    style: 'currency',
                    currency: currency || 'EUR'
                }).format(amount);
            } catch (error) {
                return `${amount} ${currency || 'EUR'}`;
            }
        };
        
        const getStatusClass = (status) => {
            const statusMap = {
                'paid': 'paid',
                'open': 'open',
                'draft': 'draft',
                'void': 'draft',
                'uncollectible': 'draft'
            };
            return statusMap[status ? status.toLowerCase() : ''] || 'draft';
        };
        
        const invoicesHTML = invoices.map(invoice => {
            const formattedDate = formatDate(invoice.created);
            const formattedAmount = formatCurrency(invoice.amount_paid, invoice.currency);
            const statusClass = getStatusClass(invoice.status);
            const invoiceNumber = invoice.number || invoice.id.substring(invoice.id.lastIndexOf('_') + 1);
            
            return `
                <div class="recent-invoice-item">
                    <div class="recent-invoice-item-left">
                        <div class="recent-invoice-item-number">Invoice ${invoiceNumber}</div>
                        <div class="recent-invoice-item-date">${formattedDate}</div>
                    </div>
                    <div class="recent-invoice-item-right">
                        <div class="recent-invoice-item-amount">${formattedAmount}</div>
                        <span class="recent-invoice-item-status ${statusClass}">${invoice.status}</span>
                    </div>
                </div>
            `;
        }).join('');
        
        content.innerHTML = invoicesHTML;
        console.log('[UpgradeController] ✅ Recent invoices displayed');
    },
    
    /**
     * Hide current subscription details
     */
    hideCurrentSubscription() {
        console.log('[UpgradeController] ========== hideCurrentSubscription() CALLED ==========');
        const container = document.getElementById('current-subscription-details');
        console.log('[UpgradeController] Container element:', {
            found: !!container,
            id: container?.id || 'NOT FOUND',
            currentDisplay: container?.style?.display || 'N/A',
            computedDisplay: container ? window.getComputedStyle(container).display : 'N/A'
        });
        
        if (container) {
            container.style.display = 'none';
            console.log('[UpgradeController] ✅ Container display set to "none"');
            console.log('[UpgradeController] Container after hide:', {
                display: container.style.display,
                computedDisplay: window.getComputedStyle(container).display
            });
        } else {
            console.warn('[UpgradeController] ⚠️ Container element not found, cannot hide');
        }
        
        console.log('[UpgradeController] ========== hideCurrentSubscription() COMPLETE ==========');
    },
    
    /**
     * Handle recurring billing toggle
     * Updates the recurring_billing_enabled field in the database (linked to user_id)
     */
    async handleRecurringBillingToggle(enabled) {
        console.log('[UpgradeController] ========== handleRecurringBillingToggle() STARTED ==========');
        console.log('[UpgradeController] Recurring billing enabled:', enabled);
        const startTime = Date.now();
        
        try {
            console.log('[UpgradeController] Step 1: Checking authentication...');
            if (!window.AuthService || !window.AuthService.isAuthenticated()) {
                console.error('[UpgradeController] ❌ User not authenticated');
                throw new Error('User not authenticated');
            }
            console.log('[UpgradeController] ✅ User authenticated');
            
            const currentUser = window.AuthService.getCurrentUser();
            console.log('[UpgradeController] Step 2: Getting current user...', {
                hasUser: !!currentUser,
                userId: currentUser?.id || 'NOT FOUND'
            });
            
            if (!currentUser || !currentUser.id) {
                console.error('[UpgradeController] ❌ User ID not available');
                throw new Error('User ID not available');
            }
            console.log('[UpgradeController] ✅ User ID:', currentUser.id);
            
            console.log('[UpgradeController] Step 3: Checking SubscriptionService...');
            if (!window.SubscriptionService) {
                console.error('[UpgradeController] ❌ SubscriptionService not available');
                throw new Error('SubscriptionService not available');
            }
            console.log('[UpgradeController] ✅ SubscriptionService available');
            
            // Show loading state
            console.log('[UpgradeController] Step 4: Updating toggle UI state...');
            const toggle = document.getElementById('recurring-billing-toggle-upgrade');
            if (toggle) {
                toggle.disabled = true;
                console.log('[UpgradeController] ✅ Toggle disabled for loading state');
            } else {
                console.warn('[UpgradeController] ⚠️ Toggle element not found');
            }
            
            console.log('[UpgradeController] Step 5: Calling SubscriptionService to', enabled ? 'enable' : 'disable', 'recurring billing...');
            let result;
            if (enabled) {
                result = await window.SubscriptionService.enableRecurringBilling(currentUser.id);
            } else {
                result = await window.SubscriptionService.disableRecurringBilling(currentUser.id);
            }
            
            console.log('[UpgradeController] SubscriptionService result:', {
                success: result?.success,
                error: result?.error || null
            });
            
            if (result.success) {
                console.log('[UpgradeController] ✅ Recurring billing updated successfully');
                console.log('[UpgradeController] Step 6: Reloading subscription to refresh display...');
                
                // Reload subscription and refresh display
                await this.loadCurrentSubscription();
                
                const message = enabled 
                    ? 'Auto-renewal enabled. Your subscription will automatically renew at the end of each billing period.'
                    : 'Auto-renewal disabled. Your subscription will cancel at the end of the current billing period, but you will continue to have access until then.';
                
                console.log('[UpgradeController] Step 7: Showing success message...');
                alert(message);
                
                const totalElapsed = Date.now() - startTime;
                console.log('[UpgradeController] ========== handleRecurringBillingToggle() SUCCESS in', totalElapsed, 'ms ==========');
            } else {
                console.error('[UpgradeController] ❌ Failed to update recurring billing:', result.error);
                throw new Error(result.error || 'Failed to update recurring billing');
            }
        } catch (error) {
            const totalElapsed = Date.now() - startTime;
            console.error('[UpgradeController] ========== handleRecurringBillingToggle() ERROR after', totalElapsed, 'ms ==========');
            console.error('[UpgradeController] Error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            console.error('[UpgradeController] Error toggling recurring billing:', error);
            alert(`Error: ${error.message || 'Failed to update recurring billing. Please try again.'}`);
            
            // Reload subscription to reset toggle state
            console.log('[UpgradeController] Reloading subscription to reset toggle state...');
            await this.loadCurrentSubscription();
        } finally {
            // Re-enable toggle
            console.log('[UpgradeController] Step 8: Re-enabling toggle...');
            const toggle = document.getElementById('recurring-billing-toggle-upgrade');
            if (toggle) {
                toggle.disabled = false;
                console.log('[UpgradeController] ✅ Toggle re-enabled');
            } else {
                console.warn('[UpgradeController] ⚠️ Toggle element not found for re-enabling');
            }
        }
    }
};

if (typeof window !== 'undefined') {
    window.UpgradeController = UpgradeController;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = UpgradeController;
}

