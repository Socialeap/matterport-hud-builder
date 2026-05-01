## Diagnosis

The edge function logs show Stripe returning `platform_account_required`:

> "Only Stripe Connect platforms can work with other accounts."

This is rejected at `stripe.checkout.sessions.create(..., { stripeAccount })` in `supabase/functions/create-connect-checkout/index.ts`. The MSP's Express account being fully onboarded (per screenshot) is not the problem — Stripe is refusing the call on the **platform** side.

There are two distinct issues:

### Issue A — Platform Profile not activated (root cause, manual fix)
Our app's Stripe **platform** account (the one behind the gateway-routed `STRIPE_SANDBOX_API_KEY`) must be a fully activated Connect platform: Connect enabled, Platform Profile completed (Loss Liability set to "Platform is responsible for losses"), branding/business details filled in. Until that's done in the Stripe Dashboard, every `stripeAccount`-scoped call will fail with this exact error. Code cannot fix this — it's a one-time dashboard task by whoever owns the Stripe platform account.

The existing `stripe-connect-onboard` already documents this (lines 72–84) for `accounts.create`. The same prerequisite governs `checkout.sessions.create` with `stripeAccount`.

### Issue B — Hardcoded `env = "sandbox"` in create-connect-checkout (code bug)
Line 152 of `create-connect-checkout/index.ts`:
```ts
const env: StripeEnv = "sandbox";
```
Every other Connect function (`stripe-connect-status`, `stripe-connect-account-session`, `stripe-connect-onboard`) accepts `environment` from the request body. This function ignores it. Consequences:
- Even after the platform is activated in **live**, paid checkout will still hit sandbox.
- If the MSP's `stripe_connect_id` was created in live but we call sandbox, the Connect ID doesn't exist there, which is another path to a similar error.
- Sandbox/live drift is silent — no way to tell from the UI which environment a failure came from.

## Changes

### 1. `supabase/functions/create-connect-checkout/index.ts`
- Accept `environment` from the request body (mirror `stripe-connect-status` pattern). Default to `sandbox` when omitted, but no longer hardcode it.
- Wrap the `stripe.checkout.sessions.create(...)` call in a try/catch. When Stripe returns `platform_account_required` or `StripePermissionError`, return a **400** with a friendly message:
  > "Payments are temporarily unavailable for this Studio. The platform's Stripe Connect setup is incomplete. Please contact support."
  Include `code: "platform_not_activated"` in the JSON so the client can render a clean state instead of the raw Stripe error.
- When Stripe returns `resource_missing` for the connected account (Connect ID exists in DB but not in this Stripe environment), return 400 with `code: "stripe_account_env_mismatch"` and a message asking the MSP to reconnect Stripe — same pattern already used in `stripe-connect-account-session` lines 86–100.
- Log `env`, `connectId`, and Stripe error code at the start of the catch so future failures are diagnosable from edge function logs without leaking PII.

### 2. `src/components/portal/HudBuilderSandbox.tsx` (checkout invocation, ~line 1244)
- Pass `environment: getStripeEnvironment()` in the `supabase.functions.invoke("create-connect-checkout", { body: { ... } })` call so the server uses the same environment the client's Stripe.js was loaded with.
- When the response contains `code: "platform_not_activated"`, show a clear toast: "Payments are temporarily unavailable. We've been notified." (instead of the current generic error path on line 1260).
- When `code: "stripe_account_env_mismatch"`, surface a message telling the user the Studio owner needs to reconnect their payout account.

### 3. `supabase/functions/stripe-connect-onboard/index.ts` (small consistency fix)
- Extend the existing `platform-profile` catch (lines 72–84) to also match `platform_account_required` so onboarding fails gracefully with the same friendly message instead of a raw 500.

### 4. Documentation note (no file change required, but called out here)
The actual remedy for **Issue A** is manual and lives outside the codebase:

1. The Stripe **platform** account owner logs in to the Stripe Dashboard.
2. Switch to the same environment our gateway uses (sandbox first, then live).
3. Go to Connect → Settings → Platform Profile.
4. Complete every required section, especially **Loss Liability** ("Platform is responsible for losses").
5. Confirm Connect is enabled (Connect → Overview should show "Active", not "Get started").

Once that one-time activation is done in **sandbox**, paid checkout for the MSP shown in the screenshot will work immediately — no further code change needed beyond the fixes above. The same activation must be repeated in **live** before production checkouts.

## Technical details

```text
Client (HudBuilderSandbox)
    └─ invokes "create-connect-checkout" { providerId, modelId, modelCount, returnUrl, environment }
            ↓
Edge function (create-connect-checkout)
    ├─ resolves access via resolve_studio_access (free vs paid)         ✓ working
    ├─ validates ownership of saved_models row                          ✓ working
    ├─ calculates price via shared pricing.ts                           ✓ working
    └─ stripe.checkout.sessions.create(..., { stripeAccount })          ✗ FAILS HERE
            └─ Stripe → 403 platform_account_required
                (platform profile not completed in sandbox)
```

Acceptance:
- Anonymous and authenticated paid checkouts no longer surface the raw Stripe permission error string.
- Edge function logs include `env` and `code` for any future Stripe failure.
- After the platform owner completes the Stripe Platform Profile in sandbox, `create-connect-checkout` returns a `clientSecret` and the embedded checkout mounts.
- `environment` is passed end-to-end so live mode will work without further code changes once live platform profile is also completed.

No DB migration. No new dependencies. No changes to pricing logic, free-flow, or `savePresentationRequest`.
