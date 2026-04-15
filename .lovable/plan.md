# Stripe Connect Express — Automated MSP Payments

## Status: Implemented ✅

## What Was Built

### Database Changes
- Added `stripe_connect_id`, `stripe_onboarding_complete`, `base_price_cents`, `model_threshold`, `additional_model_fee_cents` to `branding_settings`
- Added `amount_cents`, `model_count` to `saved_models`
- Removed deprecated `payment_link` and `payment_instructions` columns

### Edge Functions
- `stripe-connect-onboard` — Creates Express account + onboarding link
- `stripe-connect-status` — Checks if MSP's Stripe account is fully onboarded
- `create-connect-checkout` — Creates embedded checkout session on behalf of connected MSP (server-side pricing)
- `payments-webhook` — Updated to handle connected account events (`checkout.session.completed`, `account.updated`)

### MSP Dashboard (Branding Page)
- "Connect with Stripe" button → redirects to Stripe Express onboarding
- "Stripe Connected ✅" badge when complete
- Pricing fields: Base Price, Model Threshold, Additional Model Fee
- Auto-detects return from Stripe onboarding and checks status

### Client Builder (HudBuilderSandbox)
- Dynamic price breakdown card showing model count and total cost
- "I approve this as my finalized presentation" checkbox
- Purchase button → saves presentation → opens embedded Stripe checkout
- Success state with "Download Presentation File" button when `is_released = true`
- Falls back to old request flow if MSP hasn't configured pricing

## Files Changed

| File | Change |
|---|---|
| `supabase/migrations/` | Added pricing + connect columns |
| `supabase/functions/stripe-connect-onboard/index.ts` | New |
| `supabase/functions/stripe-connect-status/index.ts` | New |
| `supabase/functions/create-connect-checkout/index.ts` | New |
| `supabase/functions/payments-webhook/index.ts` | Updated for Connect events |
| `supabase/config.toml` | Added verify_jwt=false for new functions |
| `src/routes/_authenticated.dashboard.branding.tsx` | Connect UI + pricing fields |
| `src/components/portal/HudBuilderSandbox.tsx` | Purchase/Download card |
