

# Plan: Harden Download Function & Orders Page

## Checklist of Components Reviewed

| Component | File | Status |
|-----------|------|--------|
| `generatePresentation` server fn | `src/lib/portal.functions.ts` | ✅ Implemented — builds self-contained HTML |
| Download button wiring | `HudBuilderSandbox.tsx:354-384` | ✅ Wired — calls `generatePresentationFn`, creates Blob |
| Post-payment polling | `HudBuilderSandbox.tsx:102-127` | ⚠️ Minor gap — no user feedback during polling |
| Stripe Connect Embedded Checkout | `HudBuilderSandbox.tsx:386-410` | ⚠️ Missing `stripeAccount` on provider — Connect sessions require it |
| `create-connect-checkout` edge fn | `supabase/functions/create-connect-checkout/` | ✅ Correct — creates session with `stripeAccount` server-side |
| Webhook handler | `supabase/functions/payments-webhook/` | ✅ Sets `paid` + `is_released` + assigns client role |
| Orders page | `_authenticated.dashboard.orders.tsx` | ⚠️ Minor — no client name resolution, only shows UUID prefix |
| DB triggers | `trg_assign_provider_role`, `trg_assign_client_role` | ✅ Confirmed in DB |
| Config.toml | All edge fns have `verify_jwt = false` | ✅ Correct |

## Issues Found & Fixes

### 1. Stripe Connect Embedded Checkout — missing `stripeAccount` option
The `EmbeddedCheckoutProvider` loads the platform's publishable key via `getStripe()`, but the checkout session is created on the **connected account**. Stripe requires passing `stripeAccount` on the client side for Connect sessions. Without it, the iframe will fail to mount.

**Fix**: Return `stripeConnectAccountId` from the edge function alongside `clientSecret`, then pass it to `getStripe()` using `loadStripe(key, { stripeAccount })`.

Since `getStripe()` caches a singleton and the connected account varies per MSP, we'll create a one-off Stripe promise for Connect sessions instead of reusing the cached instance.

### 2. Polling UX — no feedback during payment detection
After returning from Stripe checkout, the user lands back on the builder with no visual indication that payment is being verified. The polling runs silently for up to 30 seconds.

**Fix**: Add a "Verifying payment…" state that shows a spinner + message while polling is active.

### 3. Orders page — client name resolution
Currently shows `client_id.slice(0, 8)…` which is meaningless. Should show the client's display name or email.

**Fix**: Join with `profiles` table to fetch `display_name` for each unique `client_id`.

### 4. Download filename sanitization
The download filename uses `models[0]?.name` directly which could contain special characters.

**Fix**: Sanitize the filename by replacing non-alphanumeric characters.

## Files Changed

1. **`src/components/portal/HudBuilderSandbox.tsx`**
   - Import `loadStripe` directly for Connect sessions
   - Pass `stripeAccount` from edge function response to Stripe provider
   - Add "Verifying payment…" polling UI state
   - Sanitize download filename

2. **`src/lib/stripe.ts`**
   - Add `getStripeForConnect(accountId)` helper that returns a Stripe instance configured for a connected account

3. **`supabase/functions/create-connect-checkout/index.ts`**
   - Return `stripeConnectAccountId` alongside `clientSecret` in response

4. **`src/routes/_authenticated.dashboard.orders.tsx`**
   - Fetch client profiles to resolve `display_name` for each order
   - Show client name instead of UUID prefix

## Testing Instructions
1. **Download flow**: As a client on `/p/{slug}`, build a presentation, purchase with test card `4242 4242 4242 4242`. After payment returns, verify you see "Verifying payment…" spinner, then the green download card appears. Click "Download Presentation File" — verify a valid `.html` file downloads and opens correctly in a browser.
2. **Orders page**: As the MSP, navigate to `/dashboard/orders`. Verify the order shows the client's name (not UUID), correct amount, model count, "Auto-paid" badge, and no manual action buttons.
3. **Edge case**: Open the downloaded `.html` file — verify the gate screen, model tabs, agent drawer, and Matterport iframe all work. Check Starter tier shows "Powered by Transcendence Media" footer.

