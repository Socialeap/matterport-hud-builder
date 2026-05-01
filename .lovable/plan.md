## Problem

Visiting `https://3dps.transcendencemedia.com/p/fbiib/builder` (or any MSP's builder URL) **without being signed in** shows:

> "Pricing Unavailable — We couldn't load pricing for this Studio right now."

…even though the same MSP's pricing renders fine on the landing page (`/p/fbiib`). The builder is supposed to compute the price from the formula × the number of Property Models the visitor adds.

## Root Cause

In `src/components/portal/HudBuilderSandbox.tsx`, the access resolver effect at lines 759–772 runs on mount:

```js
if (!userId) {
  setAccessState({
    linked: false,
    isFree: false,
    pricingConfigured: false,   // ← wrong for anon visitors
    payoutsReady: false,
    ...
    loaded: true,                // ← marks "verified"
    error: null,
  });
  return;
}
```

Then at lines 513–522:

```js
const accessVerified = accessState.loaded && !accessState.error;   // true
const pricingConfigured = accessVerified
  ? accessState.pricingConfigured                                  // false
  : pricing.configured;                                            // (skipped)
const checkoutReady = accessVerified && pricingConfigured && payoutsReady;
```

So the JSX falls through `isFreeClient` → `checkoutReady` → `pricingConfigured ?` and lands on the final "Pricing Unavailable" branch (line 1912–1923).

This is wrong because:

1. The `branding_settings` row — which already contains `use_flat_pricing`, `flat_price_per_model_cents`, `base_price_cents`, `tier3_price_cents`, `additional_model_fee_cents`, `stripe_connect_id`, and `stripe_onboarding_complete` — is **publicly readable** (RLS policy "Anyone can view branding by slug"), and the route loader already fetches the full row into `branding`.
2. The `resolve_studio_access` Postgres function early-returns all-false when `auth.uid() IS NULL`, never reading branding. That's correct (it's an entitlement resolver), but the client must not interpret "no user" as "pricing not configured".
3. The price formula is the same as the landing page (`calculatePresentationPrice` from `src/lib/portal/pricing.ts`), already computed in the component (`pricing`, `totalCents`) from the loader-supplied `branding` — it works regardless of auth.

The pricing block on the public landing page works precisely because it doesn't gate on `accessState`; the builder block does, incorrectly.

## Fix (single file change: `src/components/portal/HudBuilderSandbox.tsx`)

Make the anonymous-visitor branch of the resolver effect set the access state from the **publicly available branding row** instead of hard-coding all-false. Specifically:

1. In the `if (!userId)` branch of the effect (~lines 760–772), compute `pricingConfigured` and `payoutsReady` from the already-loaded `branding` prop using the same rules the SQL function uses:

   ```js
   const flat = Boolean((branding as any).use_flat_pricing);
   const flatCents = (branding as any).flat_price_per_model_cents ?? 0;
   const baseCents = branding.base_price_cents ?? 0;
   const pricingConfigured = flat ? flatCents > 0 : baseCents > 0;
   const payoutsReady =
     Boolean(branding.stripe_onboarding_complete) &&
     !!branding.stripe_connect_id;
   ```

   Then set:
   ```js
   setAccessState({
     linked: false,
     isFree: false,
     pricingConfigured,
     payoutsReady,
     providerBrandName: branding.brand_name ?? "",
     viewerRole: "unknown",
     viewerMatchesProvider: false,
     loaded: true,
     error: null,
   });
   ```

2. **No JSX changes required.** With `pricingConfigured=true` and `payoutsReady=true`, `checkoutReady` becomes true for the anonymous viewer and the existing **"Download Your Presentation"** card with the priced "Pay $X.XX & Download" button renders. The price already updates live as the visitor adds Property Models because `modelCount` flows into `calculatePresentationPrice` on every render.

3. If the MSP truly has no pricing configured, `pricingConfigured` will still be `false` and the existing "Pricing Unavailable" copy will correctly render — preserving the honest case.

4. If `stripe_onboarding_complete = false`, `payoutsReady` will be `false` and the existing "Payment Temporarily Unavailable" branch (which still shows the price breakdown) renders — also correct.

5. Authenticated flows (logged-in clients, MSPs, admins) are **untouched**: the `else` branch still calls `getStudioAccessStateFn(...)` exactly as before, so entitlement (free vs paid, link status, wrong-account, etc.) keeps working through the server resolver.

## Why this is safe

- **No schema changes.** No migration. No RPC change.
- **No new server endpoint.** No new public surface area.
- **No data exposed that isn't already public.** Every field the anon branch now reads (`use_flat_pricing`, `*_cents`, `stripe_connect_id` presence, `stripe_onboarding_complete`, `brand_name`) is already returned by the public `branding_settings` SELECT policy and is already in the `branding` prop the loader passed in.
- **Pricing math unchanged.** Same `calculatePresentationPrice` shared with the edge function (`supabase/functions/_shared/pricing.ts`), so checkout charges remain server-validated.
- **Authenticated path unchanged.** `getStudioAccessState` server function and `resolve_studio_access` SQL stay exactly as they are; only the no-userId branch of the React effect changes.
- **Honest fallbacks preserved.** Genuine "no pricing" and "payouts not onboarded" cases still render their accurate messages.
- **Checkout safety preserved.** Clicking "Pay & Download" while unauthenticated already triggers the existing signup/login modal flow before charging — that gate is unchanged.

## Verification after change

1. Open `https://3dps.transcendencemedia.com/p/fbiib/builder` in a private window (anonymous).
2. Add 1, then 2, then 3, then 4 Property Models.
3. Confirm the price card updates live: $79 → $158 → $150 → $209 → matches the landing-page table.
4. Sign in as a linked free client → confirm "Download Your Presentation (Included)" still appears.
5. Sign in as the MSP themselves → confirm "Wrong Account Signed In" still appears.
6. Temporarily blank `base_price_cents` for a test slug → confirm "Pricing Unavailable" still appears (honest case).
