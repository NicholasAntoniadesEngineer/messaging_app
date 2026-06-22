/**
 * Supabase Edge Function: checkout-session
 *
 * Creates a Stripe Checkout session for Premium subscription.
 * Automatically creates Stripe customer if needed.
 *
 * DEPLOYMENT:
 * 1. Supabase Dashboard → Edge Functions → Create function
 * 2. Name: checkout-session
 * 3. Set env: STRIPE_SECRET_KEY
 * 4. Deploy this code
 *
 * USAGE:
 * POST https://xxx.supabase.co/functions/v1/checkout-session
 * Headers: { "Authorization": "Bearer <user-token>" }
 * Body: {
 *   "successUrl": "https://app.com/success",
 *   "cancelUrl": "https://app.com/pricing"
 * }
 *
 * Returns: { "url": "https://checkout.stripe.com/..." }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY") || "", {
  apiVersion: "2023-10-16",
})

const supabaseUrl = Deno.env.get("SUPABASE_URL")!
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

serve(async (req) => {
  // CORS
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    })
  }

  try {
    // Get auth token from header
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      throw new Error("Missing authorization header")
    }

    // Initialize Supabase client with user's token
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    })

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      throw new Error("Authentication failed")
    }

    // Parse request body
    const { successUrl, cancelUrl } = await req.json()
    if (!successUrl || !cancelUrl) {
      throw new Error("successUrl and cancelUrl are required")
    }

    // Get user's subscription
    const { data: subscription, error: subError } = await supabase
      .from("subscriptions")
      .select("*, subscription_plans(*)")
      .eq("user_id", user.id)
      .single()

    if (subError) {
      throw new Error(`Failed to fetch subscription: ${subError.message}`)
    }

    // Get Premium plan
    const { data: premiumPlan, error: planError } = await supabase
      .from("subscription_plans")
      .select("*")
      .eq("name", "Premium")
      .single()

    if (planError || !premiumPlan) {
      throw new Error("Premium plan not found")
    }

    if (!premiumPlan.stripe_price_id) {
      throw new Error("Premium plan missing Stripe price ID")
    }

    // Create or get Stripe customer
    let customerId = subscription.stripe_customer_id

    if (!customerId) {
      console.log("[checkout-session] Creating new Stripe customer...")
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_user_id: user.id,
        },
      })
      customerId = customer.id

      // Save customer ID to database
      await supabase
        .from("subscriptions")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id)

      console.log("[checkout-session] ✓ Customer created:", customerId)
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: premiumPlan.stripe_price_id,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        supabase_user_id: user.id,
        plan_id: premiumPlan.id.toString(),
      },
    })

    console.log("[checkout-session] ✓ Checkout session created:", session.id)

    return new Response(
      JSON.stringify({
        url: session.url,
        session_id: session.id,
      }),
      {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    )

  } catch (error) {
    console.error("[checkout-session] Error:", error)
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    )
  }
})
