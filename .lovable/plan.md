

# Fix Stripe Pricing Logic

## Problem
The Stripe checkout shows $100 (Starter) and $250 (Pro) due today, which doesn't match the marketed prices of $149 and $299. The screenshot confirms "$100.00" is displayed instead of "$149.00".

## Root Cause
`SETUP_FEES` in `create-checkout/index.ts` are set to `10000` ($100) and `25000` ($250) — these were the old "setup fee only" amounts. They need to be the full advertised price since the subscription trial covers the first year free.

## Changes

**File: `supabase/functions/create-checkout/index.ts`**

1. Update `SETUP_FEES` constants:
   - `starter_annual`: `10000` → `14900` ($149.00)
   - `pro_annual`: `25000` → `29900` ($299.00)

That's the only change needed. The rest of the logic is already correct:
- `trial_period_days: 365` is already set (line 73)
- The setup fee is already added as a one-time `price_data` line item with the label "Studio Setup & Franchise Fee" (lines 76-84)
- The recurring $49/year subscription line item is included but won't charge until the trial ends

## Expected Result
- Starter checkout: **$149.00 due today**, then $49/year starting after 365 days
- Pro checkout: **$299.00 due today**, then $49/year starting after 365 days

After the code change, the edge function will be redeployed automatically.

