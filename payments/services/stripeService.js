/**
 * Stripe Service
 * Handles all Stripe API interactions
 * Uses Stripe.js for client-side operations
 */

console.log('[StripeService] ========== STRIPE SERVICE SCRIPT LOADING ==========');
console.log('[StripeService] Script execution started at:', new Date().toISOString());
console.log('[StripeService] Window object available:', typeof window !== 'undefined');

const StripeService = {
    stripeInstance: null,
    
    /**
     * Initialize Stripe with publishable key
     * Requires configuration to be set via PaymentsModule.initialize()
     * @returns {Promise<Object>} Stripe instance
     * @throws {Error} If config is not available or Stripe.js is not loaded
     */
    async initialize() {
        if (this.stripeInstance) {
            return this.stripeInstance;
        }
        
        if (typeof ConfigHelper === 'undefined') {
            throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
        }
        
        const publishableKey = ConfigHelper.getStripePublishableKey(this);
        
        if (!window.Stripe) {
            throw new Error('Stripe.js library not loaded. Please include Stripe.js script in your HTML.');
        }
        
        this.stripeInstance = window.Stripe(publishableKey);
        
        console.log('[StripeService] Stripe initialized with publishable key');
        return this.stripeInstance;
    },
    
    /**
     * Create a Stripe Checkout session for subscription
     * Note: This requires a backend endpoint to create the session securely
     * The backend should use the restricted key (rk_test_...) or secret key (sk_test_...)
     * @param {string} customerEmail - Customer email
     * @param {string} userId - User ID from Supabase
     * @param {string} successUrl - URL to redirect after successful payment
     * @param {string} cancelUrl - URL to redirect after cancelled payment
     * @param {string} backendEndpoint - Optional backend endpoint URL for creating checkout session
     * @param {number} planId - Optional plan ID for upgrade/downgrade
     * @param {number} priceAmount - Optional price amount in cents (overrides plan price)
     * @returns {Promise<{success: boolean, sessionId: string|null, customerId: string|null, error: string|null}>}
     */
    async createCheckoutSession(customerEmail, userId, successUrl, cancelUrl, backendEndpoint = null, planId = null, priceAmount = null) {
        console.log('[StripeService] ========== createCheckoutSession() STARTED ==========');
        const startTime = Date.now();
        
        try {
            console.log('[StripeService] Step 1: Checking Stripe instance...');
            if (!this.stripeInstance) {
                console.log('[StripeService] Stripe instance not found, initializing...');
                await this.initialize();
            }
            console.log('[StripeService] ✅ Stripe instance ready');
            
            console.log('[StripeService] Step 2: Validating input...');
            console.log('[StripeService] Checkout session params:', {
                email: customerEmail,
                userId: userId,
                successUrl: successUrl,
                cancelUrl: cancelUrl,
                hasBackendEndpoint: !!backendEndpoint
            });
            
            // If backend endpoint is provided, use it
            if (backendEndpoint) {
                console.log('[StripeService] Step 3: Calling backend endpoint...');
                console.log('[StripeService] Endpoint:', backendEndpoint);
                console.log('[StripeService] Request payload:', {
                    customerEmail: customerEmail,
                    userId: userId,
                    successUrl: successUrl,
                    cancelUrl: cancelUrl
                });
                
                try {
                    if (typeof ConfigHelper === 'undefined') {
                        throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
                    }
                    
                    const headers = await ConfigHelper.getAuthHeaders(this);
                    
                    const requestBody = {
                        customerEmail: customerEmail,
                        userId: userId,
                        successUrl: successUrl,
                        cancelUrl: cancelUrl
                    };
                    
                    // Add plan ID and price if provided (for upgrades)
                    if (planId !== null) {
                        requestBody.planId = planId;
                    }
                    if (priceAmount !== null) {
                        requestBody.priceAmount = priceAmount;
                    }
                    
                    console.log('[StripeService] Request body:', requestBody);
                    
                    const fetchStartTime = Date.now();
                    let response;
                    try {
                        response = await fetch(backendEndpoint, {
                        method: 'POST',
                        headers: headers,
                            body: JSON.stringify(requestBody),
                            // Add credentials to help with CORS
                            credentials: 'omit'
                        });
                    } catch (fetchError) {
                        // Handle CORS/preflight errors specifically
                        if (fetchError.message.includes('CORS') || fetchError.message.includes('preflight') || fetchError.message.includes('Load failed')) {
                            console.error('[StripeService] ❌ CORS/Preflight error:', fetchError.message);
                            console.error('[StripeService] This usually means:');
                            console.error('[StripeService] 1. The Edge Function is not deployed or not accessible');
                            console.error('[StripeService] 2. The Edge Function is not handling OPTIONS requests correctly');
                            console.error('[StripeService] 3. There is a network/CORS configuration issue');
                            throw new Error(`CORS error: The backend endpoint may not be properly configured. Please check that the Edge Function is deployed and handles OPTIONS requests. Original error: ${fetchError.message}`);
                        }
                        throw fetchError;
                    }
                    const fetchElapsed = Date.now() - fetchStartTime;
                    
                    console.log('[StripeService] Fetch response received:', {
                        status: response.status,
                        statusText: response.statusText,
                        ok: response.ok,
                        elapsed: `${fetchElapsed}ms`
                    });
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('[StripeService] ❌ Backend error response:', {
                            status: response.status,
                            statusText: response.statusText,
                            errorText: errorText
                        });
                        
                        // Provide more helpful error messages
                        if (response.status === 400) {
                            throw new Error(`Bad request (400): ${errorText || 'Invalid request parameters. Please check the request data.'}`);
                        } else if (response.status === 401) {
                            throw new Error(`Unauthorized (401): ${errorText || 'Authentication failed. Please ensure you are logged in.'}`);
                        } else if (response.status === 500) {
                            throw new Error(`Server error (500): ${errorText || 'The backend encountered an error. Please try again later.'}`);
                        } else {
                            throw new Error(`Backend error (${response.status}): ${errorText || response.statusText}`);
                        }
                    }
                    
                    console.log('[StripeService] Step 4: Parsing response...');
                    const result = await response.json();
                    console.log('[StripeService] Response data:', {
                        hasSessionId: !!result.sessionId,
                        sessionId: result.sessionId || 'none',
                        hasCustomerId: !!result.customerId,
                        customerId: result.customerId || 'none',
                        error: result.error || 'none'
                    });
                    
                    if (result.sessionId) {
                        const totalElapsed = Date.now() - startTime;
                        console.log('[StripeService] ========== createCheckoutSession() SUCCESS ==========');
                        console.log('[StripeService] Session ID:', result.sessionId);
                        console.log('[StripeService] Customer ID:', result.customerId || 'none');
                        console.log('[StripeService] Total time:', `${totalElapsed}ms`);
                        return {
                            success: true,
                            sessionId: result.sessionId,
                            customerId: result.customerId || null,  // Include customer ID if returned
                            error: null
                        };
                    } else {
                        console.error('[StripeService] ❌ No session ID in response:', result);
                        throw new Error(result.error || 'No session ID returned from backend');
                    }
                } catch (fetchError) {
                    const totalElapsed = Date.now() - startTime;
                    console.error('[StripeService] ========== createCheckoutSession() FETCH ERROR ==========');
                    console.error('[StripeService] Fetch error details:', {
                        message: fetchError.message,
                        stack: fetchError.stack,
                        name: fetchError.name,
                        elapsed: `${totalElapsed}ms`
                    });
                    return {
                        success: false,
                        sessionId: null,
                        error: `Backend endpoint error: ${fetchError.message}`
                    };
                }
            }
            
            // No backend endpoint provided - return error with instructions
            console.warn('[StripeService] ⚠️ No backend endpoint provided');
            return {
                success: false,
                sessionId: null,
                error: 'Checkout session creation requires a backend endpoint. Please set up a server endpoint (Supabase Edge Function or separate server) that uses your Stripe restricted key (rk_test_...) or secret key (sk_test_...) to create checkout sessions. See StripeConfig for the keys.'
            };
        } catch (error) {
            const totalElapsed = Date.now() - startTime;
            console.error('[StripeService] ========== createCheckoutSession() EXCEPTION ==========');
            console.error('[StripeService] Exception details:', {
                message: error.message,
                stack: error.stack,
                name: error.name,
                elapsed: `${totalElapsed}ms`
            });
            return {
                success: false,
                sessionId: null,
                error: error.message || 'Failed to create checkout session'
            };
        }
    },
    
    /**
     * Redirect to Stripe Checkout
     * @param {string} sessionId - Stripe Checkout session ID
     * @returns {Promise<{success: boolean, error: string|null}>}
     */
    async redirectToCheckout(sessionId) {
        try {
            if (!this.stripeInstance) {
                await this.initialize();
            }
            
            const result = await this.stripeInstance.redirectToCheckout({
                sessionId: sessionId
            });
            
            if (result.error) {
                console.error('[StripeService] Checkout redirect error:', result.error);
                return {
                    success: false,
                    error: result.error.message
                };
            }
            
            return {
                success: true,
                error: null
            };
        } catch (error) {
            console.error('[StripeService] Error redirecting to checkout:', error);
            return {
                success: false,
                error: error.message || 'Failed to redirect to checkout'
            };
        }
    },
    
    /**
     * Create a Customer Portal session for managing subscription
     * Allows users to update payment methods, view invoices, cancel subscription
     * @param {string} customerId - Stripe customer ID
     * @param {string} returnUrl - URL to return to after portal session
     * @param {string} backendEndpoint - Backend endpoint URL for creating portal session
     * @returns {Promise<{success: boolean, url: string|null, error: string|null}>}
     */
    async createPortalSession(customerId, returnUrl, backendEndpoint = null) {
        console.log('[StripeService] ========== createPortalSession() STARTED ==========');
        const startTime = Date.now();
        
        try {
            console.log('[StripeService] Step 1: Validating input...');
            if (!customerId) {
                console.error('[StripeService] ❌ Customer ID is required');
                throw new Error('Customer ID is required');
            }
            
            if (!returnUrl) {
                console.error('[StripeService] ❌ Return URL is required');
                throw new Error('Return URL is required');
            }
            
            console.log('[StripeService] ✅ Input validated:', {
                customerId: customerId,
                returnUrl: returnUrl,
                hasBackendEndpoint: !!backendEndpoint
            });
            
            // If backend endpoint is provided, use it
            if (backendEndpoint) {
                console.log('[StripeService] Step 2: Calling backend endpoint...');
                console.log('[StripeService] Endpoint:', backendEndpoint);
                console.log('[StripeService] Request payload:', {
                    customerId: customerId,
                    returnUrl: returnUrl
                });
                
                try {
                    if (typeof ConfigHelper === 'undefined') {
                        throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
                    }
                    
                    const headers = await ConfigHelper.getAuthHeaders(this);
                    
                    const fetchStartTime = Date.now();
                    const response = await fetch(backendEndpoint, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            customerId: customerId,
                            returnUrl: returnUrl
                        })
                    });
                    const fetchElapsed = Date.now() - fetchStartTime;
                    
                    console.log('[StripeService] Fetch response received:', {
                        status: response.status,
                        statusText: response.statusText,
                        ok: response.ok,
                        elapsed: `${fetchElapsed}ms`
                    });
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('[StripeService] ❌ Backend error response:', {
                            status: response.status,
                            statusText: response.statusText,
                            errorText: errorText
                        });
                        throw new Error(`Backend error: ${errorText}`);
                    }
                    
                    console.log('[StripeService] Step 3: Parsing response...');
                    const result = await response.json();
                    console.log('[StripeService] Response data:', {
                        hasUrl: !!result.url,
                        url: result.url || 'none',
                        error: result.error || 'none'
                    });
                    
                    if (result.url) {
                        const totalElapsed = Date.now() - startTime;
                        console.log('[StripeService] ========== createPortalSession() SUCCESS ==========');
                        console.log('[StripeService] Portal URL:', result.url);
                        console.log('[StripeService] Total time:', `${totalElapsed}ms`);
                        return {
                            success: true,
                            url: result.url,
                            error: null
                        };
                    } else {
                        console.error('[StripeService] ❌ No portal URL in response:', result);
                        throw new Error(result.error || 'No portal URL returned from backend');
                    }
                } catch (fetchError) {
                    const totalElapsed = Date.now() - startTime;
                    console.error('[StripeService] ========== createPortalSession() FETCH ERROR ==========');
                    console.error('[StripeService] Fetch error details:', {
                        message: fetchError.message,
                        stack: fetchError.stack,
                        name: fetchError.name,
                        elapsed: `${totalElapsed}ms`
                    });
                    return {
                        success: false,
                        url: null,
                        error: `Backend endpoint error: ${fetchError.message}`
                    };
                }
            }
            
            // No backend endpoint provided - return error with instructions
            return {
                success: false,
                url: null,
                error: 'Portal session creation requires a backend endpoint. Please set up a server endpoint (Supabase Edge Function) that uses your Stripe restricted key to create portal sessions.'
            };
        } catch (error) {
            console.error('[StripeService] Error creating portal session:', error);
            return {
                success: false,
                url: null,
                error: error.message || 'Failed to create portal session'
            };
        }
    },
    
    /**
     * Create or get Stripe customer
     * Used for trial users who want to add a payment method
     * @param {string} customerEmail - Customer email
     * @param {string} userId - User ID from Supabase
     * @param {string} backendEndpoint - Backend endpoint URL for creating customer
     * @returns {Promise<{success: boolean, customerId: string|null, error: string|null}>}
     */
    async createCustomer(customerEmail, userId, backendEndpoint = null) {
        console.log('[StripeService] ========== createCustomer() STARTED ==========');
        const startTime = Date.now();
        
        try {
            console.log('[StripeService] Step 1: Validating input...');
            if (!customerEmail) {
                console.error('[StripeService] ❌ Customer email is required');
                throw new Error('Customer email is required');
            }
            console.log('[StripeService] ✅ Input validated:', {
                email: customerEmail,
                userId: userId || 'none',
                hasBackendEndpoint: !!backendEndpoint
            });
            
            // If backend endpoint is provided, use it
            if (backendEndpoint) {
                console.log('[StripeService] Step 2: Calling backend endpoint...');
                console.log('[StripeService] Endpoint:', backendEndpoint);
                console.log('[StripeService] Request payload:', {
                    customerEmail: customerEmail,
                    userId: userId
                });
                
                try {
                    if (typeof ConfigHelper === 'undefined') {
                        throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
                    }
                    
                    const headers = await ConfigHelper.getAuthHeaders(this);
                    
                    const fetchStartTime = Date.now();
                    const response = await fetch(backendEndpoint, {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({
                            customerEmail: customerEmail,
                            userId: userId
                        })
                    });
                    const fetchElapsed = Date.now() - fetchStartTime;
                    
                    console.log('[StripeService] Fetch response received:', {
                        status: response.status,
                        statusText: response.statusText,
                        ok: response.ok,
                        elapsed: `${fetchElapsed}ms`
                    });
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('[StripeService] ❌ Backend error response:', {
                            status: response.status,
                            statusText: response.statusText,
                            errorText: errorText
                        });
                        throw new Error(`Backend error: ${errorText}`);
                    }
                    
                    console.log('[StripeService] Step 3: Parsing response...');
                    const result = await response.json();
                    console.log('[StripeService] Response data:', result);
                    
                    if (result.customerId) {
                        const totalElapsed = Date.now() - startTime;
                        console.log('[StripeService] ========== createCustomer() SUCCESS ==========');
                        console.log('[StripeService] Customer ID:', result.customerId);
                        console.log('[StripeService] Total time:', `${totalElapsed}ms`);
                        return {
                            success: true,
                            customerId: result.customerId,
                            error: null
                        };
                    } else {
                        console.error('[StripeService] ❌ No customer ID in response:', result);
                        throw new Error(result.error || 'No customer ID returned from backend');
                    }
                } catch (fetchError) {
                    const totalElapsed = Date.now() - startTime;
                    console.error('[StripeService] ========== createCustomer() FETCH ERROR ==========');
                    console.error('[StripeService] Fetch error details:', {
                        message: fetchError.message,
                        stack: fetchError.stack,
                        name: fetchError.name,
                        elapsed: `${totalElapsed}ms`
                    });
                    return {
                        success: false,
                        customerId: null,
                        error: `Backend endpoint error: ${fetchError.message}`
                    };
                }
            }
            
            // No backend endpoint provided - return error with instructions
            console.warn('[StripeService] ⚠️ No backend endpoint provided');
            return {
                success: false,
                customerId: null,
                error: 'Customer creation requires a backend endpoint. Please set up a server endpoint (Supabase Edge Function) that uses your Stripe restricted key to create customers.'
            };
        } catch (error) {
            const totalElapsed = Date.now() - startTime;
            console.error('[StripeService] ========== createCustomer() EXCEPTION ==========');
            console.error('[StripeService] Exception details:', {
                message: error.message,
                stack: error.stack,
                name: error.name,
                elapsed: `${totalElapsed}ms`
            });
            return {
                success: false,
                customerId: null,
                error: error.message || 'Failed to create customer'
            };
        }
    },
    
    /**
     * Update subscription (upgrade, downgrade, or toggle recurring billing)
     * @param {string} userId - User ID from Supabase
     * @param {number|null} planId - Optional: New plan ID for upgrade/downgrade
     * @param {string|null} changeType - Optional: 'upgrade' or 'downgrade'
     * @param {boolean|null} recurringBillingEnabled - Optional: Toggle recurring billing on/off
     * @param {string} backendEndpoint - Backend endpoint URL for update-subscription Edge Function
     * @returns {Promise<{success: boolean, message: string|null, error: string|null}>}
     */
    async updateSubscription(userId, planId = null, changeType = null, recurringBillingEnabled = null, backendEndpoint = null) {
        console.log('[StripeService] ========== updateSubscription() STARTED ==========');
        const startTime = Date.now();
        
        try {
            console.log('[StripeService] Step 1: Validating input...');
            if (!userId) {
                throw new Error('User ID is required');
            }
            
            if (planId === null && recurringBillingEnabled === null) {
                throw new Error('Either planId or recurringBillingEnabled must be provided');
            }
            
            // Use default endpoint if not provided
            if (!backendEndpoint) {
                if (typeof ConfigHelper === 'undefined') {
                    throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
                }
                backendEndpoint = ConfigHelper.getBackendEndpoint(this, 'updateSubscription');
            }
            
            console.log('[StripeService] Step 2: Calling update-subscription Edge Function...');
            console.log('[StripeService] Endpoint:', backendEndpoint);
            console.log('[StripeService] Request payload:', {
                userId: userId,
                planId: planId,
                changeType: changeType,
                recurringBillingEnabled: recurringBillingEnabled
            });
            
            if (typeof ConfigHelper === 'undefined') {
                throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
            }
            
            const headers = await ConfigHelper.getAuthHeaders(this);
            
            const requestBody = {
                userId: userId
            };
            
            if (planId !== null) {
                requestBody.planId = planId;
            }
            if (changeType !== null) {
                requestBody.changeType = changeType;
            }
            if (recurringBillingEnabled !== null) {
                requestBody.recurringBillingEnabled = recurringBillingEnabled;
            }
            
            console.log('[StripeService] Request body:', requestBody);
            
            const fetchStartTime = Date.now();
            let response;
            try {
                response = await fetch(backendEndpoint, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(requestBody),
                    credentials: 'omit'
                });
            } catch (fetchError) {
                if (fetchError.message.includes('CORS') || fetchError.message.includes('preflight') || fetchError.message.includes('Load failed')) {
                    console.error('[StripeService] ❌ CORS/Preflight error:', fetchError.message);
                    throw new Error(`CORS error: The update-subscription Edge Function may not be properly configured. Original error: ${fetchError.message}`);
                }
                throw fetchError;
            }
            const fetchElapsed = Date.now() - fetchStartTime;
            
            console.log('[StripeService] Fetch response received:', {
                status: response.status,
                statusText: response.statusText,
                ok: response.ok,
                elapsed: `${fetchElapsed}ms`
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                let errorData;
                try {
                    errorData = JSON.parse(errorText);
                } catch (e) {
                    errorData = { error: errorText };
                }
                
                console.error('[StripeService] ❌ Update subscription failed:', errorData);
                return {
                    success: false,
                    message: null,
                    error: errorData.error || `HTTP ${response.status}: ${errorText}`
                };
            }
            
            console.log('[StripeService] Step 3: Parsing response...');
            const result = await response.json();
            const totalElapsed = Date.now() - startTime;
            
            console.log('[StripeService] Response data:', result);
            console.log('[StripeService] ========== updateSubscription() SUCCESS ==========');
            console.log('[StripeService] Total time:', `${totalElapsed}ms`);
            
            return {
                success: result.success || true,
                message: result.message || 'Subscription updated successfully',
                error: null,
                data: result
            };
            
        } catch (error) {
            const totalElapsed = Date.now() - startTime;
            console.error('[StripeService] ========== updateSubscription() EXCEPTION ==========');
            console.error('[StripeService] Exception details:', {
                message: error.message,
                stack: error.stack,
                name: error.name,
                elapsed: `${totalElapsed}ms`
            });
            return {
                success: false,
                message: null,
                error: error.message || 'Failed to update subscription'
            };
        }
    },
    
    /**
     * Get Stripe instance
     * @returns {Object|null} Stripe instance
     */
    getStripeInstance() {
        return this.stripeInstance;
    },
    
    /**
     * List invoices for a customer
     * @param {string} customerId - Stripe customer ID
     * @param {number} limit - Maximum number of invoices to return (default: 10)
     * @param {string} backendEndpoint - Backend endpoint URL for listing invoices
     * @returns {Promise<{success: boolean, invoices: Array|null, error: string|null}>}
     */
    async listInvoices(customerId, limit = 10, backendEndpoint = null) {
        console.log('[StripeService] ========== listInvoices() STARTED ==========');
        const startTime = Date.now();
        
        try {
            console.log('[StripeService] Step 1: Validating input...');
            if (!customerId) {
                console.error('[StripeService] ❌ Customer ID is required');
                throw new Error('Customer ID is required');
            }
            console.log('[StripeService] ✅ Input validated:', {
                customerId: customerId,
                limit: limit,
                hasBackendEndpoint: !!backendEndpoint
            });
            
            // If backend endpoint is provided, use it
            if (backendEndpoint) {
                console.log('[StripeService] Step 2: Calling backend endpoint...');
                console.log('[StripeService] Endpoint:', backendEndpoint);
                console.log('[StripeService] Request payload:', {
                    customerId: customerId,
                    limit: limit
                });
                
                if (typeof ConfigHelper === 'undefined') {
                    throw new Error('ConfigHelper not available. Ensure config-helper.js is loaded and PaymentsModule.initialize() has been called.');
                }
                
                const headers = await ConfigHelper.getAuthHeaders(this);
                
                const requestBody = {
                    customerId: customerId,
                    limit: limit
                };
                
                console.log('[StripeService] Request body:', requestBody);
                
                const response = await fetch(backendEndpoint, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(requestBody)
                });
                
                const elapsed = Date.now() - startTime;
                console.log('[StripeService] Fetch response received:', {
                    status: response.status,
                    statusText: response.statusText,
                    ok: response.ok,
                    elapsed: `${elapsed}ms`
                });
                
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                    console.error('[StripeService] ❌ List invoices failed:', errorData);
                    throw new Error(errorData.error || `Server error: ${response.status}`);
                }
                
                const data = await response.json();
                console.log('[StripeService] Step 3: Parsing response...');
                console.log('[StripeService] Response data:', data);
                
                if (data.success && data.invoices) {
                    console.log('[StripeService] ========== listInvoices() SUCCESS ==========');
                    console.log('[StripeService] Total time:', `${Date.now() - startTime}ms`);
                    return {
                        success: true,
                        invoices: data.invoices,
                        count: data.count || data.invoices.length,
                        error: null
                    };
                } else {
                    throw new Error(data.error || 'Failed to list invoices');
                }
            }
            
            // No backend endpoint provided - return error with instructions
            return {
                success: false,
                invoices: null,
                count: 0,
                error: 'Invoice listing requires a backend endpoint. Please set up a server endpoint (Supabase Edge Function) that uses your Stripe restricted key to list invoices.'
            };
        } catch (error) {
            console.error('[StripeService] Error listing invoices:', error);
            return {
                success: false,
                invoices: null,
                count: 0,
                error: error.message || 'Failed to list invoices'
            };
        }
    }
};

try {
    if (typeof window !== 'undefined') {
        console.log('[StripeService] Exposing StripeService to window object...');
        window.StripeService = StripeService;
        console.log('[StripeService] ✅ StripeService exposed to window');
        console.log('[StripeService] Verification:', {
            hasWindowStripeService: !!window.StripeService,
            hasListInvoices: typeof window.StripeService.listInvoices === 'function',
            serviceKeys: Object.keys(window.StripeService).slice(0, 10)
        });
    } else {
        console.warn('[StripeService] ⚠️ Window object not available, cannot expose StripeService');
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = StripeService;
        console.log('[StripeService] ✅ StripeService exported as module');
    }

    console.log('[StripeService] ========== STRIPE SERVICE SCRIPT LOADED ==========');
} catch (error) {
    console.error('[StripeService] ❌ ERROR during StripeService initialization:', {
        message: error.message,
        stack: error.stack,
        name: error.name
    });
    // Still try to expose it even if there was an error
    if (typeof window !== 'undefined') {
        try {
            window.StripeService = StripeService;
            console.log('[StripeService] StripeService exposed despite error');
        } catch (exposeError) {
            console.error('[StripeService] Failed to expose StripeService:', exposeError);
        }
    }
}

