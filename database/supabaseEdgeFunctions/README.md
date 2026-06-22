# Supabase Edge Functions

## Overview

These Edge Functions handle subscription, payment, and user lookup operations for Money Tracker.

## Functions

### 1. **checkout-session.ts**
Creates Stripe checkout sessions for subscription upgrades.

- **Purpose**: Handle Premium subscription purchases
- **Trigger**: Called from frontend when user clicks upgrade
- **Deploy**: `supabase functions deploy checkout-session`

### 2. **customer-portal.ts**
Creates Stripe customer portal sessions for managing subscriptions.

- **Purpose**: Allow users to update payment methods, view invoices
- **Trigger**: Called from frontend "Update Payment Method" button
- **Deploy**: `supabase functions deploy customer-portal`

### 3. **stripe-webhook.ts**
Handles Stripe webhook events (subscription updates, payments, cancellations).

- **Purpose**: Keep database in sync with Stripe subscription states
- **Trigger**: Stripe sends webhooks on subscription events
- **Deploy**: `supabase functions deploy stripe-webhook`
- **Setup**: Add webhook URL in Stripe Dashboard

### 4. **user-lookup.ts**
Unified user lookup service handling all user-related queries.

- **Purpose**: Look up users by email or get email by user ID
- **Trigger**: Called from DatabaseService for messaging operations
- **Deploy**: `supabase functions deploy user-lookup`
- **Auth**: Uses service role key to access auth.users table
- **Actions**:
  - `findByEmail`: Look up user ID by email address
  - `getEmailById`: Get email address by user ID

**Example Request:**
```json
{
  "action": "findByEmail",
  "email": "user@example.com"
}
```

**Example Response:**
```json
{
  "userId": "uuid-here"
}
```

## Deployment Instructions

### Prerequisites

1. Install Supabase CLI:
   ```bash
   npm install -g supabase
   ```

2. Login to Supabase:
   ```bash
   supabase login
   ```

3. Link to your project:
   ```bash
   supabase link --project-ref [YOUR_PROJECT_REF]
   ```

### Deploy All Functions

From the root of the repository:

```bash
# Deploy payment functions
supabase functions deploy checkout-session
supabase functions deploy customer-portal
supabase functions deploy stripe-webhook

# Deploy user lookup function
supabase functions deploy user-lookup
```

### Set Environment Variables

All functions need these environment variables (set in Supabase Dashboard):

```bash
SUPABASE_URL=https://[project-id].supabase.co
SUPABASE_SERVICE_ROLE_KEY=[your-service-role-key]
STRIPE_SECRET_KEY=[your-stripe-secret-key]
STRIPE_WEBHOOK_SECRET=[your-stripe-webhook-secret]
```

**To set variables:**
1. Go to Supabase Dashboard → Project Settings → Edge Functions
2. Add each variable under "Secrets"

### Setup Stripe Webhook

1. Go to Stripe Dashboard → Developers → Webhooks
2. Add endpoint: `https://[project-id].supabase.co/functions/v1/stripe-webhook`
3. Select events:
   - `checkout.session.completed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_failed`
4. Copy the webhook signing secret
5. Add it to Supabase as `STRIPE_WEBHOOK_SECRET`

## Testing Functions

### Test user-lookup locally

```bash
# Find user by email
curl -i --location --request POST 'http://localhost:54321/functions/v1/user-lookup' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{"action":"findByEmail","email":"test@example.com"}'

# Get email by user ID
curl -i --location --request POST 'http://localhost:54321/functions/v1/user-lookup' \
  --header 'Authorization: Bearer YOUR_ANON_KEY' \
  --header 'Content-Type: application/json' \
  --data '{"action":"getEmailById","userId":"uuid-here"}'
```

## Monitoring

### Verify Edge Functions

1. Go to Supabase Dashboard → Edge Functions
2. Select a function
3. View "Logs" tab for execution history

## Troubleshooting

### Function not deploying

```bash
# Check you're logged in
supabase status

# Re-link project
supabase link --project-ref [project-id]
```

### Stripe webhook not working

1. Check webhook is active in Stripe Dashboard
2. Verify endpoint URL matches your Supabase project
3. Check edge function logs in Supabase Dashboard
4. Ensure STRIPE_WEBHOOK_SECRET is set correctly
