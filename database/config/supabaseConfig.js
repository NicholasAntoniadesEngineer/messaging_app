/**
 * Supabase Configuration
 * Centralized configuration for the Supabase client.
 *
 * ============================================================================
 * SETUP REQUIRED — point this at YOUR OWN Supabase project
 * ============================================================================
 * Secure Messenger is a standalone app and MUST use its own dedicated Supabase
 * project (do not reuse another app's project).
 *
 *   1. Create a new project at https://supabase.com
 *   2. Settings -> API: copy the Project URL and the publishable/anon API key
 *   3. Replace the two placeholder values below
 *   4. Run database/setup/messaging-schema.sql in the SQL editor
 *   5. Create a private Storage bucket named "message-attachments" (1MB limit)
 *   6. Deploy the user-lookup edge function (database/supabaseEdgeFunctions/)
 *   7. Auth -> URL Configuration: set the Site URL + redirect URLs
 *
 * The anon/publishable key is safe to ship client-side — row-level security
 * (RLS) in messaging-schema.sql is what actually protects the data.
 *
 * NOTE: Global logging configuration lives in shared/config/loggingConfig.js;
 * load loggingConfig.js BEFORE this file to control console logging.
 */

const SupabaseConfig = {
    // TODO: replace with your own Supabase project URL and publishable/anon key
    PROJECT_URL: 'https://YOUR_PROJECT_REF.supabase.co',
    PUBLISHABLE_API_KEY: 'YOUR_SUPABASE_PUBLISHABLE_OR_ANON_KEY',
    _clientInstance: null,
    
    /**
     * Get Supabase client instance (reuses existing instance if available)
     * @returns {Object} Supabase client
     */
    getClient() {
        console.log('[SupabaseConfig] getClient() called');
        
        // Return existing client if available
        if (this._clientInstance) {
            console.log('[SupabaseConfig] Reusing existing Supabase client instance');
            return this._clientInstance;
        }
        
        if (!window.supabase) {
            console.error('[SupabaseConfig] Supabase client library not loaded');
            throw new Error('Supabase client library not loaded. Please include the Supabase script in your HTML.');
        }
        
        console.log('[SupabaseConfig] Creating new Supabase client with URL:', this.PROJECT_URL);
        this._clientInstance = window.supabase.createClient(this.PROJECT_URL, this.PUBLISHABLE_API_KEY);
        console.log('[SupabaseConfig] Supabase client created successfully');
        return this._clientInstance;
    },
    
    /**
     * Wait for Supabase library to load
     * @param {number} maxWaitTime - Maximum time to wait in milliseconds
     * @returns {Promise<void>}
     */
    async waitForLibrary(maxWaitTime = 10000) {
        const startTime = Date.now();
        while (!window.supabase && (Date.now() - startTime) < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        if (!window.supabase) {
            throw new Error('Supabase library failed to load within timeout period');
        }
    },
    
    /**
     * Initialize Supabase client
     * @returns {Promise<Object>} Supabase client instance
     */
    async initialize() {
        console.log('[SupabaseConfig] initialize() called');
        if (typeof window === 'undefined') {
            throw new Error('Supabase config can only be used in browser environment');
        }
        
        if (!window.supabase) {
            console.log('[SupabaseConfig] Waiting for Supabase library to load...');
            await this.waitForLibrary();
            console.log('[SupabaseConfig] Supabase library loaded');
        }
        
        return this.getClient();
    }
};

if (typeof window !== 'undefined') {
    window.SupabaseConfig = SupabaseConfig;
}
