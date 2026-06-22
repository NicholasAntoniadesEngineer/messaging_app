import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

/**
 * User Lookup Edge Function
 *
 * Handles all user lookup operations using admin privileges.
 *
 * Operations:
 * - findByEmail: Look up user ID by email address
 * - getEmailById: Look up email by user ID
 */
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Create Supabase client with service role access (bypasses RLS)
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })

    // Parse request body
    const body = await req.json()
    const { action, email, userId } = body

    // Validate action parameter
    if (!action) {
      return new Response(
        JSON.stringify({ error: 'Action parameter is required' }),
        {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    // Route to appropriate handler
    switch (action) {
      case 'findByEmail':
        return await handleFindByEmail(supabaseAdmin, email)

      case 'getEmailById':
        return await handleGetEmailById(supabaseAdmin, userId)

      default:
        return new Response(
          JSON.stringify({ error: `Unknown action: ${action}` }),
          {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
    }

  } catch (error) {
    console.error('Exception in user-lookup:', error)
    return new Response(
      JSON.stringify({ error: error.message || 'An unexpected error occurred' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

/**
 * Find user ID by email address
 */
async function handleFindByEmail(supabaseAdmin: any, email: string) {
  if (!email) {
    return new Response(
      JSON.stringify({ error: 'Email is required' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }

  // Look up user by email using admin client
  const { data, error } = await supabaseAdmin.auth.admin.listUsers()

  if (error) {
    console.error('Error listing users:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to search for user' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }

  // Find user with matching email (case-insensitive)
  const user = data.users.find((u: any) => u.email?.toLowerCase() === email.toLowerCase())

  if (!user) {
    return new Response(
      JSON.stringify({ error: 'User not found' }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }

  // Return user ID
  return new Response(
    JSON.stringify({ userId: user.id }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  )
}

/**
 * Get email by user ID
 */
async function handleGetEmailById(supabaseAdmin: any, userId: string) {
  if (!userId) {
    return new Response(
      JSON.stringify({ error: 'User ID is required' }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }

  // Look up user by ID using admin client
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId)

  if (error) {
    console.error('Error getting user by ID:', error)

    if (error.message?.includes('not found')) {
      return new Response(
        JSON.stringify({ error: 'User not found' }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Failed to get user' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }

  if (!data.user || !data.user.email) {
    return new Response(
      JSON.stringify({ error: 'User email not found' }),
      {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }

  // Return user email
  return new Response(
    JSON.stringify({ email: data.user.email }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    }
  )
}
