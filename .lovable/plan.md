
Plan: Fix the blank Stripe checkout and remove the client-secret timeout path

What I found
- `OPENAI_API_KEY` is present, so that part is confirmed.
- The frontend payment token is already present: `.env` has a live publishable key and `.env.development` has a sandbox key. So the old “VITE_PAYMENTS_CLIENT_TOKEN is not set” issue is no longer the blocker.
- `src/lib/stripe.ts` derives the payment environment from that key. Preview/dev uses sandbox; published uses live.
- The pricing flow still relies on `create-checkout`, and that function is currently returning repeated HTTP 500s.
- Live payments are not fully ready yet: the current payment status is still incomplete, and the available runtime payment secrets only cover sandbox. The shared Stripe backend code expects `STRIPE_LIVE_API_KEY` for live mode, not `STRIPE_SECRET_KEY`.
- Because the pricing dialog mounts Embedded Checkout immediately, a backend failure turns into Stripe’s blank “Something went wrong / Timed out waiting for client secret” screen instead of a clear app-level error.

Implementation plan
1. Align payment mode with backend readiness
   - Keep preview/testing on sandbox.
   - For published/live checkout, complete the built-in Payments go-live setup so the live payment backend keys are provisioned.
   - If live launch is not intended yet, temporarily align the published build back to sandbox instead of mixing a live frontend token with a sandbox-only backend.

2. Harden the pricing checkout flow
   - Refactor the dashboard pricing flow to match the safer pattern already used in `HudBuilderSandbox`.
   - Pre-create the checkout session before mounting Stripe.
   - Store the `clientSecret` in state and only render `EmbeddedCheckoutProvider` after session creation succeeds.
   - If session creation fails, keep the modal in an app-controlled error state with retry/cancel instead of mounting a blank Stripe iframe.

3. Add explicit loading and failure UI
   - Show a clear loading state like “Preparing secure checkout…” while the session is being created.
   - Show a friendly inline error if the backend returns 4xx/5xx.
   - Map the live-not-configured case to a readable message so the UI explains why checkout is unavailable.

4. Improve backend observability
   - Add safe error logging inside `supabase/functions/create-checkout/index.ts` so future 500s expose the real cause in backend logs.
   - Leave `verify_jwt = false` in `supabase/config.toml` as-is; that part is already correct.

Files to update
- `src/components/StripeEmbeddedCheckout.tsx`
- `src/hooks/useStripeCheckout.tsx`
- `src/routes/_authenticated.dashboard.pricing.tsx`
- `supabase/functions/create-checkout/index.ts`

Validation checklist
- Preview/test: open pricing, click Starter/Pro, confirm the test-mode banner appears and checkout loads instead of blanking.
- Published/live: confirm checkout session creation returns 200 after live payments are fully provisioned.
- Failure path: confirm the app shows a readable inline error, not Stripe’s generic timeout screen.
- Regression check: confirm the existing connect checkout in `HudBuilderSandbox` still works unchanged.

Technical note
The most likely root cause is no longer the frontend publishable key. It is a live/sandbox mismatch: the published pricing flow is attempting live checkout, but the backend payment integration is only provisioned for sandbox right now.
