

## Plan: Fix Stripe Connect onboarding (gateway client + env passthrough + real error surfacing)

### Context recap

You confirmed:
1. The Stripe Platform Profile / Loss Liability is now set to "Platform is responsible for losses" on the correct account.
2. The `STRIPE_SECRET_KEY` in Supabase secrets was updated to match the active Stripe account (`acct_1JnHIaCQXdxBxU8G`).

What's left is purely the code fix that was approved earlier but never applied. Gemini's recommendation aligns with our prior plan, with **one critical correction**: we must use the project's **gateway-routed Stripe client** (`createStripeClient(env)` from `_shared/stripe.ts`) — NOT a direct `new Stripe(STRIPE_SECRET_KEY)`. Per project knowledge, `STRIPE_SECRET_KEY` is being phased out in favor of the gateway pattern using `STRIPE_LIVE_API_KEY` / `STRIPE_SANDBOX_API_KEY`. The shared utility's signature is `createStripeClient(env: 'sandbox' | 'live')` — no options object.

### Changes

**1. `supabase/functions/stripe-connect-onboard/index.ts` — full rewrite**

- Import `createStripeClient` and `StripeEnv` from `../_shared/stripe.ts`.
- Read `environment` from request body (default `'sandbox'`).
- Replace `new Stripe(STRIPE_SECRET_KEY)` with `createStripeClient(env)`.
- Wrap `stripe.accounts.create(...)` in its own try/catch. If error message contains `managing losses` or `platform-profile`, return a **400** with a friendly body explaining the platform profile must be completed.
- Add explicit `capabilities: { card_payments: { requested: true }, transfers: { requested: true } }` to the create call (Express best practice; matches Gemini's snippet).
- Keep CORS headers on **every** response (success, error, OPTIONS).
- Keep existing logic: look up `branding_settings.stripe_connect_id`, reuse if present, otherwise create + persist; build account link with `stripe_connect_return=1` query param so the existing return-handler in `BrandingSection` still fires.
- Remove the dead `STRIPE_SECRET_KEY` env check.

**2. `src/components/portal/BrandingSection.tsx` (or wherever the Connect button lives) — surgical edit to `handleConnectStripe`**

- Import `getStripeEnvironment` from `@/lib/stripe`.
- Pass `environment: getStripeEnvironment()` in the function invoke body.
- Stop swallowing errors — change `catch {}` to `catch (err: any)` and surface `data?.error || err.message` in the toast so the real reason surfaces if anything else breaks.

### Ripple safety trace

| Touched | Used elsewhere? | Risk | Mitigation |
|---|---|---|---|
| `stripe-connect-onboard/index.ts` | Called only by Branding "Connect" button | Behavior change in error format | New error path is a 400 with `{error: string}` — frontend already reads `data.error`, no shape break |
| `createStripeClient` import | Already used by `create-checkout`, `payments-webhook`, etc. | None — well-tested utility | — |
| `BrandingSection.tsx` `handleConnectStripe` | Only called by the Connect button | None — same callsite, just adds `environment` and improves toast | — |
| `stripe_connect_return=1` param | Existing return-handler reads this | Preserved | — |
| `branding_settings.stripe_connect_id` lookup/save | Existing column | Untouched | — |
| `stripe-connect-status` edge function | Reads `stripe_connect_id` | Untouched | — |
| Stripe webhook (`payments-webhook`) | Independent flow | Untouched | — |

### Out of scope

- Switching from Express to Standard/Custom (different liability model — bigger architectural change).
- Building any sandbox-mode toggle UI (env detection happens automatically via `getStripeEnvironment()`).
- Auto-creating the Stripe Platform Profile (Stripe doesn't expose an API for this).

### Verify after deploy

1. Click "Connect with Stripe" on `/dashboard/branding`.
2. Expected: redirect to `connect.stripe.com/express/...` for onboarding.
3. After completing on Stripe, returns to `/dashboard/branding?stripe_connect_return=1`.
4. `branding_settings.stripe_connect_id` populated; `stripe_onboarding_complete` flips to true.
5. If anything still fails, the toast will now show the **actual** Stripe reason instead of a generic "Failed to connect Stripe."

### Files touched (2)

- `supabase/functions/stripe-connect-onboard/index.ts`
- `src/components/portal/BrandingSection.tsx` (the Connect button handler)

