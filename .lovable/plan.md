

# Plan: Fix All Critical Gaps

## Summary
Address all audit gaps: auto-assign roles, gate dashboard by tier, fix dead Upgrade button, detect Stripe Connect payment for released state with polling, build .html download generation, and enhance Orders page.

## Technical Details

### Step 1: Database Migration
- Add trigger on `purchases` table: when a row is inserted with `status = 'completed'`, auto-insert `provider` role into `user_roles` (if not exists)
- Add trigger on `client_providers` table: when a row is inserted, auto-insert `client` role into `user_roles` (if not exists)
- No schema changes needed — just two trigger functions

### Step 2: Auto-Assign Roles via DB Triggers
**`assign_provider_role_on_purchase`** trigger function:
```sql
CREATE FUNCTION assign_provider_role_on_purchase() ...
  INSERT INTO user_roles (user_id, role) VALUES (NEW.user_id, 'provider')
  ON CONFLICT (user_id, role) DO NOTHING;
```

**`assign_client_role_on_link`** trigger function:
```sql
CREATE FUNCTION assign_client_role_on_link() ...
  INSERT INTO user_roles (user_id, role) VALUES (NEW.client_id, 'client')
  ON CONFLICT (user_id, role) DO NOTHING;
```

Both use `SECURITY DEFINER` to bypass RLS on `user_roles`.

### Step 3: Gate Dashboard by Tier Purchase
Update `_authenticated.dashboard.tsx` layout:
- After auth check, query `purchases` table for the current user (environment = `sandbox` for now)
- If no completed purchase exists, redirect to `/dashboard/pricing` (still allow pricing page itself)
- Show a banner on pricing page: "Purchase a plan to access the full dashboard"

### Step 4: Fix Dead Upgrade Button (Branding Page)
The "Upgrade to Pro — $199" button on line 465 of `branding.tsx` currently has no `onClick`. Wire it to `useStripeCheckout` with `priceId: "pro_upgrade_onetime"`. On successful checkout return, the webhook already updates `branding_settings.tier` to `pro`.

### Step 5: Post-Payment Polling on Client Builder
After Stripe Embedded Checkout completes (user returns to `returnUrl`), the component needs to detect that payment went through. Currently `returnUrl` is `window.location.href` which reloads the same page with no session detection.

Fix:
- Set `returnUrl` to include `?checkout_model_id={modelId}&session_id={CHECKOUT_SESSION_ID}`
- On component mount, detect these URL params
- Poll `saved_models` for `status = 'paid'` every 2 seconds (up to 15 attempts)
- When paid, set `isReleased = true` and show download card
- The webhook already sets `status: 'paid'` and `is_released: true` on `saved_models`

### Step 6: Build Self-Contained .html Generation
Create a server function `generatePresentation` in `src/lib/portal.functions.ts`:
- Takes `modelId` as input, validates via `checkFulfillmentStatus`
- Constructs a single HTML file with:
  - Matterport SDK embed (via showcase iframe URLs)
  - All branding (colors, logo as Base64 data URI, agent contact) inlined
  - Property model data Base64-encoded in a CONFIG variable
  - Navigation HUD UI (tabs for each model, agent drawer)
  - Starter tier: "Powered by Transcendence Media" footer injected
  - Pro tier: clean output
- Returns the HTML as a string
- Client triggers download via `Blob` + anchor click

Wire the "Download Presentation File" button (line 328) to call this function.

### Step 7: Enhance Orders Page
- Add `amount_cents` and `model_count` columns to the orders table display
- Fetch these from `saved_models` (already stored there by the connect-checkout function)
- Show "Auto-paid (Stripe)" badge when `model_status === 'paid'` and hide the manual "Mark Paid" button for auto-paid orders
- Remove the manual "Release" button for auto-released orders

### Step 8: Webhook Fixes
- The webhook `handleConnectCheckoutCompleted` already sets `status: 'paid'` and `is_released: true` — this is correct
- Ensure the webhook also assigns `client` role if not yet assigned (belt-and-suspenders alongside the DB trigger)

## Files Changed
1. **New migration** — role assignment triggers
2. `src/routes/_authenticated.dashboard.tsx` — tier gating
3. `src/routes/_authenticated.dashboard.branding.tsx` — wire Upgrade button
4. `src/components/portal/HudBuilderSandbox.tsx` — post-payment polling + download wiring
5. `src/lib/portal.functions.ts` — add `generatePresentation` server function
6. `src/routes/_authenticated.dashboard.orders.tsx` — show amount, model count, auto-paid status
7. `supabase/functions/payments-webhook/index.ts` — minor: add client role assignment

## Testing Instructions
1. **Platform tier purchase**: Go to `/dashboard/pricing`, buy Starter with test card `4242 4242 4242 4242` (any future expiry, any CVC). Verify dashboard unlocks and `provider` role is assigned.
2. **Upgrade button**: On `/dashboard/branding`, click "Upgrade to Pro — $199". Complete checkout. Verify tier changes to Pro and whitelabel fields unlock.
3. **Client flow**: Set up Stripe Connect + pricing as MSP. Visit `/p/{slug}` as a new user. Build a presentation, approve, purchase. Verify payment detection, download button appears, and .html file downloads correctly.
4. **Orders page**: Verify the MSP sees the order with amount and model count, and auto-paid orders don't show manual action buttons.

