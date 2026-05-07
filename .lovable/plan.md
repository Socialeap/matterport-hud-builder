## Problem

Clicking **Download** on `/builder` as the MSP (Studio owner) returns `"Provider has not connected Stripe"`.

### Trace

1. `HudBuilderSandbox.handleDownload` → calls `savePresentation` → inserts `saved_models` row with `client_id = provider_id = userId` (confirmed in DB: row `03c08982…` has `client_id == provider_id`).
2. Then invokes `create-connect-checkout` edge function.
3. Edge function source (`supabase/functions/create-connect-checkout/index.ts` lines 99-117) **does** contain the owner self-build bypass that should mark the row paid+released and return `{ free: true, ownerFree: true }` before reaching the Stripe-onboarding gate at line 166.
4. DB confirms `branding_settings.stripe_onboarding_complete = false` for this provider — that's the gate that fires the error message.

The owner bypass exists in source but the live error means the bypass is not executing. Two likely causes (both addressed below):

- **The deployed edge function is stale** — last source edit was 2026-05-07 20:16:47, and recent function logs show only boot/shutdown with no request logs since the user's click. The previous turn implemented the bypass but the function was never explicitly redeployed.
- The bypass relies on `ownedModel.provider_id === user.id`. Authoritative, but if it ever doesn't match (e.g. admin viewing another provider via owner-equivalent flow) we'd still hit the Stripe gate. We'll keep this exact check — it is the correct authority.

There is **only one** source of the `"Provider has not connected Stripe"` string — `create-connect-checkout/index.ts:167`. No obsolete code paths to remove elsewhere.

## Fix

### 1. `supabase/functions/create-connect-checkout/index.ts`

Tighten the owner bypass and add explicit logging so future failures are diagnosable. Specifically:
- Keep the existing owner-bypass block at lines 99-117 unchanged in behavior.
- Add `console.log("[create-connect-checkout] owner self-build bypass", { modelId, userId: user.id })` so deployment correctness is visible in edge logs on the next click.
- No change to the order: ownership guard → owner bypass → one-time-free → free-client → Stripe gate.

### 2. Force redeploy

Use `supabase--deploy_edge_functions` for `create-connect-checkout` so the bypass is live. (This is the most likely root cause — the source has the fix, but the deployed bundle does not.)

### 3. Verification

After deploy:
- Call the function via `supabase--curl_edge_functions` (or just have the user click Download) and confirm it returns `{ free: true, ownerFree: true }` and `saved_models` row flips to `status='paid'`, `is_released=true`.
- Check edge logs for the new `owner self-build bypass` line.

## Out of scope / deliberately unchanged

- `portal.functions.ts` `savePresentation` — owner-as-free path (lines 116-139) already correct from previous turn.
- `HudBuilderSandbox.tsx` `isOwnerSelfBuild` UI branch — already correct.
- Stripe onboarding state for the MSP — irrelevant to owner downloads. Not touched.
- Public `/p/$slug` checkout, real client checkout, free-invitee flow, admin grants — all untouched.

## Risk

Minimal. The only behavior change is one extra `console.log`. The functional fix is the redeploy itself.
