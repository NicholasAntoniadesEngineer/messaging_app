-- ============================================================================
-- Secure Messenger — SUBSCRIPTION SCHEMA (optional, additive)
-- ============================================================================
-- Run this AFTER messaging-schema.sql. It adds the subscription/billing system:
--   subscription_plans, subscriptions, payments  (+ RLS, grants, helpers)
--   a 30-day trial auto-created for every new user (trigger on auth.users)
--
-- Stripe is OPTIONAL until a user upgrades: new users get a 30-day Premium
-- trial automatically, so the app is fully usable before any Stripe setup.
-- To enable paid upgrades:
--   1. Create your products/prices in Stripe and put the price IDs in
--      subscription_plans.stripe_price_id (UPDATE the rows below, or edit here).
--   2. Deploy the edge functions in ../supabaseEdgeFunctions/ (checkout-session,
--      customer-portal, stripe-webhook) with your Stripe keys.
--   3. Set the Stripe publishable key + endpoints in
--      payments/config/moneyTrackerConfig.js (internal config name kept as-is).
-- ============================================================================

-- Idempotent drops
DROP TRIGGER IF EXISTS trigger_create_trial_subscription ON auth.users;
DROP TRIGGER IF EXISTS trigger_update_subscriptions_updated_at ON subscriptions;
DROP FUNCTION IF EXISTS create_trial_subscription() CASCADE;
DROP FUNCTION IF EXISTS update_subscriptions_updated_at() CASCADE;
DROP FUNCTION IF EXISTS is_free_plan(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS is_on_trial(TEXT, TIMESTAMPTZ) CASCADE;
DROP FUNCTION IF EXISTS get_price_dollars(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS get_subscription_type(BIGINT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS is_recurring_billing_enabled(BOOLEAN) CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS subscription_plans CASCADE;

-- ============================================================
-- SUBSCRIPTION SYSTEM
-- ============================================================

CREATE TABLE IF NOT EXISTS subscription_plans (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,  -- Plan description for UI display
    stripe_price_id TEXT UNIQUE,  -- Stripe's price ID (null until you create one)
    price_cents INT NOT NULL,  -- 0 for Free, 999 for $9.99/month
    interval TEXT NOT NULL CHECK (interval IN ('month', 'year')),
    features JSONB DEFAULT '[]',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS but allow all authenticated users to read (public plan data)
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_plans_select_all ON subscription_plans
    FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS subscriptions (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id BIGINT NOT NULL REFERENCES subscription_plans(id),

    -- Stripe integration (null for Free plan users)
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT UNIQUE,
    stripe_price_id TEXT,

    -- Subscription status (source of truth from Stripe)
    status TEXT NOT NULL DEFAULT 'trial' CHECK (status IN (
        'trial',      -- 30-day trial (new users)
        'active',     -- Active subscription (Free or Premium)
        'past_due',   -- Payment failed
        'canceled',   -- Canceled by user
        'unpaid'      -- Payment failed multiple times
    )),

    -- Billing period (from Stripe, updated by webhook)
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,  -- This IS the next billing date!

    -- Trial management
    trial_end TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),

    -- Cancellation tracking
    cancel_at_period_end BOOLEAN DEFAULT false,
    canceled_at TIMESTAMPTZ,

    -- Downgrade scheduling (null if no pending change)
    pending_plan_id BIGINT REFERENCES subscription_plans(id),
    pending_change_at TIMESTAMPTZ,  -- When downgrade takes effect (= current_period_end)

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscriptions_select_own ON subscriptions
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY subscriptions_update_own ON subscriptions
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY subscriptions_insert_own ON subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_subscriptions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_subscriptions_updated_at();

GRANT SELECT ON subscription_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON subscriptions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE subscriptions_id_seq TO authenticated;

CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    stripe_payment_intent_id TEXT UNIQUE,
    amount_cents INT NOT NULL,
    currency TEXT DEFAULT 'usd',
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY payments_select_own ON payments
    FOR SELECT USING (auth.uid() = user_id);

GRANT SELECT ON payments TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE payments_id_seq TO authenticated;

-- Populate subscription plans (rebranded for Secure Messenger).
-- Set stripe_price_id to your real Stripe price IDs to enable paid upgrades.
INSERT INTO subscription_plans (name, description, stripe_price_id, price_cents, interval, features, is_active)
VALUES
    ('Free', 'Limited access after your trial ends', NULL, 0, 'month', '["Account & contacts", "Upgrade to send encrypted messages"]'::jsonb, true),
    -- stripe_price_id: Stripe test Price (Secure Messenger Premium, £9.99/mo). Replace for prod/live.
    ('Premium', 'Full end-to-end encrypted messaging', 'price_1Tl87aClUqvgxZvpUn4uUrx6', 999, 'month', '["Unlimited E2E encrypted messaging", "Encrypted file attachments", "Multi-device sync", "Priority support"]'::jsonb, true)
ON CONFLICT (name) DO UPDATE SET
    description = EXCLUDED.description,
    price_cents = EXCLUDED.price_cents,
    features = EXCLUDED.features,
    is_active = EXCLUDED.is_active;

-- ============================================================
-- SUBSCRIPTION HELPER FUNCTIONS (Derived Data)
-- ============================================================

-- Check if subscription is on Free plan
CREATE OR REPLACE FUNCTION is_free_plan(sub_plan_id BIGINT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
    RETURN (SELECT name FROM subscription_plans WHERE id = sub_plan_id) = 'Free';
END;
$$;

-- Check if subscription is on trial
CREATE OR REPLACE FUNCTION is_on_trial(sub_status TEXT, trial_end_date TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
    RETURN sub_status = 'trial' AND trial_end_date > NOW();
END;
$$;

-- Get plan price in dollars (for display)
CREATE OR REPLACE FUNCTION get_price_dollars(sub_plan_id BIGINT)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
    RETURN (SELECT price_cents FROM subscription_plans WHERE id = sub_plan_id) / 100.0;
END;
$$;

-- Get subscription type (derived from plan and status)
CREATE OR REPLACE FUNCTION get_subscription_type(sub_plan_id BIGINT, sub_status TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
    IF sub_status = 'trial' THEN
        RETURN 'trial';
    ELSIF is_free_plan(sub_plan_id) THEN
        RETURN 'free';
    ELSE
        RETURN 'paid';
    END IF;
END;
$$;

-- Check if recurring billing is enabled (inverse of cancel_at_period_end)
CREATE OR REPLACE FUNCTION is_recurring_billing_enabled(cancel_at_end BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
    RETURN NOT cancel_at_end;
END;
$$;

GRANT EXECUTE ON FUNCTION is_free_plan(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_on_trial(TEXT, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION get_price_dollars(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_subscription_type(BIGINT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION is_recurring_billing_enabled(BOOLEAN) TO authenticated;

-- ============================================================
-- AUTO-CREATE TRIAL SUBSCRIPTION ON SIGNUP
-- ============================================================

-- Automatically create a 30-day Premium trial when a user signs up
CREATE OR REPLACE FUNCTION create_trial_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    premium_plan_id BIGINT;
BEGIN
    -- Get Premium plan ID
    SELECT id INTO premium_plan_id
    FROM subscription_plans
    WHERE name = 'Premium'
    LIMIT 1;

    -- Create trial subscription for new user
    INSERT INTO subscriptions (
        user_id,
        plan_id,
        status,
        trial_end
    ) VALUES (
        NEW.id,
        premium_plan_id,
        'trial',
        NOW() + INTERVAL '30 days'
    );

    RETURN NEW;
END;
$$;

-- Trigger on user creation
DROP TRIGGER IF EXISTS trigger_create_trial_subscription ON auth.users;
CREATE TRIGGER trigger_create_trial_subscription
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION create_trial_subscription();
