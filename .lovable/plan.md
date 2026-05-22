# Force Stripe to Live (Soft Pin)

## Goal

Stop routing any Stripe traffic through the broken sandbox connector, without deleting sandbox code. One small change at the source of truth (`getStripeEnvironment()`) cascades to every caller, because every caller already passes `environment: getStripeEnvironment()` into the edge functions.

## Single source of truth

`src/lib/stripe.ts` currently derives `environment` from the publishable key prefix:

```ts
const environment = clientToken?.startsWith('pk_test_') ? 'sandbox' : 'live';
```

Change to a hard pin with a clear comment + escape hatch:

```ts
// TEMPORARY: Lovable's sandbox Stripe connector (std_01kp9q23fdfm68nz4we5dpqp0s)
// has an expired upstream secret that the Disable→Enable cycle is not rotating.
// Pin every client+server call to 'live' so nothing routes to the broken connector.
// Restore the auto-detect line below once Lovable repairs the sandbox connector.
//   const environment = clientToken?.startsWith('pk_test_') ? 'sandbox' : 'live';
const environment: 'sandbox' | 'live' = 'live';
```

`getStripeEnvironment()` already returns this value, so every site that calls it inherits the pin automatically.

## Why this is sufficient (dependency trace)

Searched callers of `getStripeEnvironment()` / `environment` field in `body`:

Client-side (all pass `environment: getStripeEnvironment()`):
- `src/components/StripeEmbeddedCheckout.tsx` → `create-checkout`
- `src/lib/stripe.ts` `getStripePriceId` → `get-stripe-price`
- `src/routes/_authenticated.dashboard.payouts.tsx` → `stripe-connect-account-session`, `stripe-connect-onboard`, `stripe-connect-status`
- Other callers (pricing/upgrade routes) follow the same pattern — verify with `rg "getStripeEnvironment\("` during implementation and confirm all pass it into the edge function `body`.

Edge functions (`supabase/functions/*/index.ts`): each reads `body.environment` and calls `createStripeClient(env)` from `_shared/stripe.ts`. With the client always sending `'live'`, every edge function picks the live key path via `getConnectionApiKey('live')` → `STRIPE_LIVE_API_KEY`. Sandbox branches remain compiled but unreachable.

Webhooks (`payments-webhook`): unaffected. `verifyWebhook` derives `env` from which secret signs the request, not from any client input. Live webhooks keep working; sandbox webhooks would still verify if Stripe ever sent one — harmless.

## Files to change

1. **`src/lib/stripe.ts`** — pin `environment = 'live'` with the comment above. No other edits.

2. **`src/components/PaymentTestModeBanner.tsx`** — the banner only shows when `clientToken` starts with `pk_test_`. Since we're forcing live behavior regardless of the key, the banner would be misleading if a `pk_test_` key were ever set. Change the guard to also short-circuit on the forced env:

   ```ts
   import { getStripeEnvironment } from "@/lib/stripe";
   // ...
   if (getStripeEnvironment() === "live") return null;
   if (!clientToken?.startsWith("pk_test_")) return null;
   ```

   This keeps the component intact for the eventual restore.

## Explicitly NOT changed

- `supabase/functions/_shared/stripe.ts` — sandbox branches stay (`getConnectionApiKey`, `verifyWebhook` sandbox path). Restoring sandbox later = revert the one line in `stripe.ts`.
- All 6 Stripe edge functions — untouched. They keep accepting `environment` from the body; the body just always says `'live'` now.
- `isStripeCredentialError` / `stripeCredentialResponse` — keep. Live key could also expire someday; the 503 handler is still the right behavior.
- DB / migrations / env vars — none.

## Preconditions to verify before shipping

- `STRIPE_LIVE_API_KEY` and `PAYMENTS_LIVE_WEBHOOK_SECRET` must be present in edge-function secrets (live connector `std_01kp9qgd1gfnp90cxhk8x14awp` previously verified). If either is missing, every Stripe call will 503 with `stripe_credentials_expired` instead of working — confirm via `fetch_secrets` first.
- `VITE_PAYMENTS_CLIENT_TOKEN` should be the live publishable key (`pk_live_…`). If it's still `pk_test_…`, the embedded checkout UI will mismatch the live backend session and Stripe.js will throw. Check before deploy; if it's test, request the live publishable key be swapped in.

## Verification after deploy

1. `payments--get_go_live_status` — confirm live is ready.
2. Hit `/dashboard/payouts` → expect `stripe-connect-account-session` to succeed against the live connector (no more `Connection error`).
3. Run a $0.50 live test checkout via the embedded checkout → expect 200 from `create-checkout` and a session id.
4. `supabase--edge_function_logs` on `create-checkout` and `stripe-connect-account-session` → no `stripe_credentials_expired` entries.

## Restore path (when Lovable fixes the sandbox connector)

Revert the one line in `src/lib/stripe.ts` back to the auto-detect expression and the `PaymentTestModeBanner` guard. No other files need to change.
