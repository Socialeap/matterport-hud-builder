## What we're fixing

1. **Stale $49 copy on the dashboard upgrade page.** The landing page Pro card already shows `$79`, but the dashboard `/dashboard/upgrade` page still says "then $49/year upkeep license" in its subtitle. That's the leftover reference.
2. **Landing-page Starter/Pro buttons don't open Stripe.** "Get Starter Studio" and "Get Pro Studio" currently just call `navigate({ to: "/signup" })` — they never trigger checkout.

## Changes

### 1. Fix stale Pro pricing copy

- `src/routes/_authenticated.dashboard.upgrade.tsx` line 94: change subtitle from `"then $49/year upkeep license (first year free)."` to `"then $49–$79/year upkeep license (first year free)."` so it reflects both tiers.
- Landing page (`src/routes/index.tsx`) — already correct ($49 for Starter, $79 for Pro, range "$49–$79" in subtitle). No copy change needed.

### 2. Wire landing-page pricing cards to Stripe checkout

For an unauthenticated visitor we cannot create a Stripe checkout (it requires a `userId` for the customer record), so the flow is:

- **If the visitor IS logged in**: clicking "Get Starter Studio" or "Get Pro Studio" opens the embedded Stripe checkout inline on the landing page — same `useStripeCheckout` hook + `StripeEmbeddedCheckout` component already used on `/dashboard/upgrade`. Price IDs: `starter_annual` (Starter) and `pro_annual` (Pro). On success Stripe returns the user to `/dashboard/upgrade?checkout=success&session_id={CHECKOUT_SESSION_ID}` (matches the existing return-URL pattern).
- **If the visitor is NOT logged in**: we send them to `/signup?intent=checkout&tier=starter|pro` (extend `validateSearch` in `signup.tsx` to accept these two new optional params). After successful signup the signup form reads `intent` + `tier` and redirects to `/dashboard/upgrade?autostart=starter|pro`. The upgrade page reads `autostart` and immediately calls `handlePurchase` for the requested tier — same checkout component, no new backend code.

### 3. Files touched

- `src/routes/index.tsx` — replace the two card-button `onClick` handlers with a `handleTierCta(tier)` helper; mount `<PaymentTestModeBanner />` and `{checkoutElement}` from `useStripeCheckout`. Keep the existing `<DemoButton>` flow untouched.
- `src/routes/signup.tsx` — extend `validateSearch` with `intent?: "checkout"` and `tier?: "starter" | "pro"`; pass to `SignupForm`.
- `src/components/auth/SignupForm.tsx` — after successful signup, if `intent === "checkout"` and a tier is set, navigate to `/dashboard/upgrade?autostart=<tier>` instead of the default post-signup destination.
- `src/routes/_authenticated.dashboard.upgrade.tsx` — fix the `$49`→`$49–$79` copy; add `validateSearch` for an optional `autostart` param; in a `useEffect`, if `autostart` is set, call `handlePurchase(tier.priceId)` once and clear the param.

## Why no Stripe / backend changes

The `create-checkout` server function already resolves the human-readable lookup keys (`starter_annual`, `pro_annual`) via Stripe's `lookup_keys` API. Since you already attached `pro_annual` to the new $79 price in Stripe, no backend, schema, or function code needs to change — only the UI wiring above.

## Out of scope

- No price changes in Stripe (already done by you in the dashboard).
- No change to the existing `/dashboard/upgrade` checkout flow itself (it works).
- No anonymous/guest checkout — purchases always link to a logged-in user.
