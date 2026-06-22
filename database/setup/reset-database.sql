-- ============================================================
-- RESET DATABASE - COMPLETE WIPE
-- ============================================================
-- WARNING: This script will DELETE ALL DATA in the database
-- Use this to start completely fresh without migration history
-- ============================================================

-- Note: We use CASCADE on all DROP statements to automatically
-- handle dependencies (RLS policies, triggers, constraints, etc.)
-- Drop tables first, then functions (tables have triggers that depend on functions)

DO $$
BEGIN
    RAISE NOTICE '============================================================';
    RAISE NOTICE 'RESET DATABASE - Starting complete wipe...';
    RAISE NOTICE '============================================================';
END $$;

-- ============================================================
-- DROP ALL TABLES (in correct order for foreign keys)
-- ============================================================

DO $$ BEGIN RAISE NOTICE 'Dropping encryption and messaging tables...'; END $$;
DROP TABLE IF EXISTS message_attachments CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS identity_key_backups CASCADE;
DROP TABLE IF EXISTS conversation_session_keys CASCADE;
DROP TABLE IF EXISTS conversation_participants CASCADE;
DROP TABLE IF EXISTS conversations CASCADE;
DROP TABLE IF EXISTS key_rotation_locks CASCADE;
DROP TABLE IF EXISTS device_keys CASCADE;
DROP TABLE IF EXISTS paired_devices CASCADE;
DROP TABLE IF EXISTS public_key_history CASCADE;
DROP TABLE IF EXISTS identity_keys CASCADE;

DO $$ BEGIN RAISE NOTICE 'Dropping social features tables...'; END $$;
DROP TABLE IF EXISTS blocked_users CASCADE;
DROP TABLE IF EXISTS friends CASCADE;

DO $$ BEGIN RAISE NOTICE 'Dropping notifications tables...'; END $$;
DROP TABLE IF EXISTS notification_preferences CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;

DO $$ BEGIN RAISE NOTICE 'Dropping data sharing tables...'; END $$;
DROP TABLE IF EXISTS field_locks CASCADE;
DROP TABLE IF EXISTS data_shares CASCADE;

DO $$ BEGIN RAISE NOTICE 'Dropping budget data tables...'; END $$;
DROP TABLE IF EXISTS user_months CASCADE;
DROP TABLE IF EXISTS example_months CASCADE;
DROP TABLE IF EXISTS pots CASCADE;

DO $$ BEGIN RAISE NOTICE 'Dropping settings table...'; END $$;
DROP TABLE IF EXISTS settings CASCADE;

DO $$ BEGIN RAISE NOTICE 'Dropping payments and subscriptions tables...'; END $$;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS subscription_plans CASCADE;

-- ============================================================
-- DROP ALL FUNCTIONS (now that tables/triggers are gone)
-- ============================================================

DO $$ BEGIN RAISE NOTICE 'Dropping trigger functions...'; END $$;
DROP FUNCTION IF EXISTS create_trial_subscription() CASCADE;
DROP FUNCTION IF EXISTS update_key_backups_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_session_keys_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_conversations_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_messages_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_user_months_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_notifications_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_subscriptions_updated_at() CASCADE;
DROP FUNCTION IF EXISTS update_share_status() CASCADE;

DO $$ BEGIN RAISE NOTICE 'Dropping subscription helper functions...'; END $$;
DROP FUNCTION IF EXISTS is_free_plan(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS is_on_trial(TEXT, TIMESTAMPTZ) CASCADE;
DROP FUNCTION IF EXISTS get_price_dollars(BIGINT) CASCADE;
DROP FUNCTION IF EXISTS get_subscription_type(BIGINT, TEXT) CASCADE;
DROP FUNCTION IF EXISTS is_recurring_billing_enabled(BOOLEAN) CASCADE;

DO $$ BEGIN RAISE NOTICE 'Dropping messaging and attachment functions...'; END $$;
DROP FUNCTION IF EXISTS update_identity_keys_updated_at() CASCADE;
DROP FUNCTION IF EXISTS create_notification(UUID, TEXT, UUID, BIGINT, TEXT, BIGINT, BIGINT, BIGINT, BIGINT) CASCADE;
DROP FUNCTION IF EXISTS cleanup_expired_attachments() CASCADE;
DROP FUNCTION IF EXISTS debug_attachment_rls(BIGINT, UUID) CASCADE;

-- ============================================================
-- DROP STORAGE POLICIES
-- ============================================================

DO $$ BEGIN RAISE NOTICE 'Dropping storage policies...'; END $$;
DROP POLICY IF EXISTS "Users can upload attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can read attachments" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete attachments" ON storage.objects;

-- ============================================================
-- CLEAR ALL USERS
-- ============================================================

DO $$ BEGIN RAISE NOTICE 'Deleting all users from auth.users...'; END $$;
DELETE FROM auth.users;

-- ============================================================
-- RESET COMPLETE
-- ============================================================

DO $$
DECLARE
    table_count INTEGER;
    function_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO table_count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

    SELECT COUNT(*) INTO function_count FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_type = 'FUNCTION';

    RAISE NOTICE '============================================================';
    RAISE NOTICE 'RESET COMPLETE';
    RAISE NOTICE 'Remaining tables in public schema: %', table_count;
    RAISE NOTICE 'Remaining functions in public schema: %', function_count;
    RAISE NOTICE 'You can now run: database/setup/fresh-install-complete.sql';
    RAISE NOTICE '============================================================';
END $$;
