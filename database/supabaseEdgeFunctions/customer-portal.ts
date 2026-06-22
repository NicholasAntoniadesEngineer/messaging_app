/**
 * Supabase Edge Function: create-portal-session
 * 
 * This function creates a Stripe Customer Portal session for managing subscriptions.
 * Allows users to update payment methods, view invoices, and manage billing.
 * 
 * DEPLOYMENT INSTRUCTIONS:
 * 1. In Supabase Dashboard, go to Edge Functions
 * 2. Click "Create a new function"
 * 3. Name it: create-portal-session
 * 4. Copy the code from this file into the function
 * 5. Set environment variable: STRIPE_RESTRICTED_KEY = your_stripe_restricted_key_here
 * 6. Deploy the function
 * 
 * USAGE:
 * POST https://your-project.supabase.co/functions/v1/create-portal-session
 * Headers: { "Content-Type": "application/json" }
 * Body: {
 *   "customerId": "cus_xxxxx",
 *   "returnUrl": "https://your-app.com/payment"
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno"

// Initialize Stripe with restricted key (safer) or secret key (fallback)
const stripeKey = Deno.env.get("STRIPE_RESTRICTED_KEY") || Deno.env.get("STRIPE_SECRET_KEY")

if (!stripeKey) {
  throw new Error("STRIPE_RESTRICTED_KEY or STRIPE_SECRET_KEY environment variable is required")
}

const stripe = new Stripe(stripeKey, {
  apiVersion: "2023-10-16",
})

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    })
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { 
        status: 405,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        } 
      }
    )
  }

  try {
    console.log("[create-portal-session] ========== REQUEST RECEIVED ==========")
    const startTime = Date.now()
    
    // Parse request body
    console.log("[create-portal-session] Step 1: Parsing request body...")
    const { customerId, returnUrl } = await req.json()
    console.log("[create-portal-session] Request data:", { customerId, returnUrl })

    // Validate required fields
    console.log("[create-portal-session] Step 2: Validating input...")
    if (!customerId) {
      console.error("[create-portal-session] ❌ customerId is required")
      return new Response(
        JSON.stringify({ error: "customerId is required" }),
        { 
          status: 400,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          } 
        }
      )
    }

    if (!returnUrl) {
      console.error("[create-portal-session] ❌ returnUrl is required")
      return new Response(
        JSON.stringify({ error: "returnUrl is required" }),
        { 
          status: 400,
          headers: { 
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          } 
        }
      )
    }
    console.log("[create-portal-session] ✅ Input validated")

    // Create Customer Portal session
    console.log("[create-portal-session] Step 3: Creating Stripe Customer Portal session...")
    const portalStartTime = Date.now()
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    })
    const portalElapsed = Date.now() - portalStartTime
    console.log("[create-portal-session] ✅ Portal session created:", {
      sessionId: session.id,
      url: session.url,
      elapsed: `${portalElapsed}ms`
    })

    const totalElapsed = Date.now() - startTime
    console.log("[create-portal-session] ========== REQUEST SUCCESS ==========")
    console.log("[create-portal-session] Portal URL:", session.url)
    console.log("[create-portal-session] Total time:", `${totalElapsed}ms`)

    // Return portal session URL
    return new Response(
      JSON.stringify({ 
        url: session.url,
      }),
      { 
        status: 200,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        } 
      }
    )
  } catch (error) {
    console.error("[create-portal-session] ========== REQUEST ERROR ==========")
    console.error("[create-portal-session] Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name
    })
    
    return new Response(
      JSON.stringify({ 
        error: error.message || "Failed to create portal session",
        details: error.toString(),
      }),
      { 
        status: 500,
        headers: { 
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        } 
      }
    )
  }
})

