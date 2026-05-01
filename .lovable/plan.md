# Remove the "must be linked to this MSP" restriction in the Studio Builder

## Problem

A signed-in client/agent visiting `/p/{slug}/builder` for any MSP is blocked from saving and paying with:

> "You are not linked to this provider. Please use your invitation link to access this Studio."

This contradicts the intended product behavior: **anyone signed in should be able to build, pay, and download** a presentation from any MSP whose Studio has Pricing + Stripe Connect configured. The invitation flow is only required for **free** access (the MSP marks an invitee `is_free = true`).

## Root Cause (single location)

In `src/lib/portal.functions.ts`, the `savePresentationRequest` server function (lines ~102–118) hard-blocks any caller whose `client_providers` row is missing for the target MSP:

```ts
const access = Array.isArray(accessRows) ? accessRows[0] : null;
if (!access?.linked) {
  return {
    success: false,
    error: "You are not linked to this provider. Please use your invitation link to access this Studio.",
  };
}
```

This guard is overzealous. It treats "linked" (an entitlement signal for **free** access) as a precondition for **any** access, including paid checkouts. No other layer requires the link:

- **DB / RLS**: `saved_models` INSERT only requires `client_id = auth.uid()`. No FK to `client_providers`.
- **Builder UI**: doesn't gate on `accessState.linked` anywhere — the flag is read but never used to disable the flow.
- **Anonymous viewers**: already see the priced checkout card (recent fix). They just hit the signup/login modal at "Pay & Download" — and once signed in, they hit this wall.
- **Edge function `create-connect-checkout`**: correctly uses `resolve_studio_access` only to detect the **free** path (`isFree === true`); paid path doesn't require linkage.
- **Free-invite flow stays intact**: `accept_invitation_self` and `handle_new_user` still create the `client_providers` row with `is_free` propagated, so `resolve_studio_access` continues to return `is_free: true` for invited free clients, and `create-connect-checkout` still bypasses charging for them.

## Fix (one server function, one block)

Edit `src/lib/portal.functions.ts` in `savePresentationRequest` (lines ~102–118):

1. **Remove** the `if (!access?.linked) { return error }` guard entirely.
2. **Keep** the `resolve_studio_access` RPC call, because we still want to surface a clean "Studio not configured for payments" error before inserting a `saved_models` row. Replace the link check with two honest preconditions derived from the same RPC result:

```ts
const access = Array.isArray(accessRows) ? accessRows[0] : null;

// Block self-checkout: an MSP (or admin viewing as MSP) must not buy
// their own presentation through the client checkout.
if (access?.viewer_matches_provider) {
  return {
    success: false,
    error: "You are signed in as the Studio owner. Sign in with a client account to purchase.",
  };
}

// Free clients skip pricing/payouts checks (charge is bypassed downstream).
const isFree = access?.is_free === true;
if (!isFree) {
  if (!access?.pricing_configured) {
    return {
      success: false,
      error: "This Studio has not finished setting up pricing yet. Please contact the provider.",
    };
  }
  if (!access?.payouts_ready) {
    return {
      success: false,
      error: "This Studio has not finished setting up payments yet. Please contact the provider.",
    };
  }
}
```

3. No other changes. The rest of the handler (insert `saved_models`, create `order_notifications`, etc.) is untouched.

## Why this is safe

- **DB schema/RLS unchanged.** `saved_models` already permits any authenticated user to insert their own rows; no migration needed.
- **Free-invite path preserved.** `is_free` still flows from `invitations → client_providers → resolve_studio_access → create-connect-checkout`. Free invitees continue to bypass payment.
- **Paid path now works for any signed-in user.** They save → `create-connect-checkout` computes the price server-side from `branding_settings` → Stripe Connect collects payment → webhook releases the model. Identical to the existing paid-client experience, just without the prior arbitrary link requirement.
- **No accidental free access.** Removing the link guard cannot grant free access — `is_free` requires a `client_providers` row with `is_free = true`, which only the MSP can create via `invitations`.
- **Self-checkout protection added.** Prevents the MSP from accidentally creating a checkout against their own Stripe Connect account.
- **Honest pre-flight errors.** If the MSP hasn't configured pricing or hasn't completed Stripe onboarding, we still fail fast with a clear message — same conditions the edge function would reject on, just surfaced earlier.
- **UI unchanged.** The builder already shows the priced "Pay $X.XX & Download" card to anonymous and signed-in non-linked users. Today the click flow is: signed-in user clicks Pay → `savePresentationRequest` returns the link error → toast. After the fix: same click flow proceeds to Stripe Embedded Checkout.

## Verification

1. **Anonymous → sign up → pay flow** (the bug case):
   - Open `/p/fbiib/builder` in a private window.
   - Add Property Models; confirm the price card shows live totals.
   - Click "Pay & Download" → sign up with a brand-new email (no invitation).
   - Confirm Stripe Embedded Checkout opens (no "not linked" error).
   - Complete a sandbox payment; confirm the model is released and downloaded.

2. **Free-invite flow** (regression check):
   - Have an MSP send an invitation with `is_free = true`.
   - Accept it, build a presentation, click Download.
   - Confirm the free bypass still kicks in (no Stripe checkout, immediate download).

3. **Self-checkout guard** (new):
   - Sign in as the MSP themselves, open their own `/p/{slug}/builder`, click Pay.
   - Confirm the "signed in as the Studio owner" message appears.

4. **Unconfigured MSP** (negative case):
   - Pick (or temporarily simulate) an MSP with `base_price_cents IS NULL` or `stripe_onboarding_complete = false`.
   - Confirm the matching pre-flight error renders instead of an opaque Stripe failure.

## Files to change

- `src/lib/portal.functions.ts` — `savePresentationRequest` handler only. No other files, no migrations, no edge function changes.
