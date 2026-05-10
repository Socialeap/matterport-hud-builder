# Production Readiness Remediation — Tracking Checklist

Phased remediation of findings from the codebase audit. Each phase finishes
with a commit (and a push at phase boundary). Items checked here are landed
on this branch.

---

## Phase 1 — Stop the secret bleed
- [x] `.gitignore` blocks `.env*` (allowlist `.env.example`)
- [x] `.env.example` documents every required variable, no real values
- [x] `package.json` pins `packageManager` (`bun@1.3.11`) and `engines.node`
- [x] `package-lock.json` removed (Bun is the only supported package manager)
- [x] `.env`, `.env.development`, `.env.production` untracked from git (`git rm --cached`)
- [ ] **OWNER ACTION** — secrets rotated in upstream consoles (see runbook below)
- [ ] **OWNER ACTION** — `bun install` re-run locally to verify lockfile + env

### Owner runbook — key rotation (do these in parallel with my Phase 2 work)

The keys below were committed to `bc09e2a` and remain valid in git history.
Anyone who cloned the repo (or any mirror, including Lovable's snapshots) can
read them. Rotate every one of them.

1. **Stripe — live publishable & secret keys**
   - https://dashboard.stripe.com/apikeys → "Create restricted key" / roll the
     existing live keys
   - Replace `VITE_PAYMENTS_CLIENT_TOKEN` in your hosting env (Cloudflare /
     Lovable) with the new `pk_live_…`
   - Update `PAYMENTS_LIVE_API_KEY` (and `PAYMENTS_SANDBOX_API_KEY` if any
     sandbox keys were also exposed) in Supabase → Settings → Edge Functions
     → Secrets
   - Regenerate `PAYMENTS_LIVE_WEBHOOK_SECRET` from the Stripe Webhooks page

2. **Supabase — anon JWT + service role JWT**
   - Supabase dashboard → Project Settings → API → "Roll JWT secret"
   - This invalidates **all** anon + service-role JWTs in circulation.
   - Update `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY` everywhere they're configured (hosting +
     Supabase Functions secrets).
   - Sign every authenticated session out (forces clients to re-auth with the
     new JWT secret).

3. **Presentation token HMAC + internal secrets**
   - Generate fresh values for `PRESENTATION_TOKEN_SECRET` and
     `INTERNAL_GEOCODE_SECRET`:
     `openssl rand -base64 48`
   - Existing portal links signed with the old secret will stop verifying once
     the new secret rolls. If long-lived shared portal URLs are in the wild,
     plan a brief gap or implement a dual-secret verifier in Phase 5.

4. **Lovable gateway key** — `LOVABLE_API_KEY`
   - Reissue from the Lovable dashboard. This key shows up in
     `_shared/stripe.ts` HTTP headers and a few server functions.

### Why we are NOT rewriting git history (per your direction)
The leaked keys remain readable in `bc09e2a` even after we untrack the files
in this branch. Rotating the keys (above) is the actual mitigation; history
rewrite is optional cosmetic cleanup that requires force-push and a re-clone
for every collaborator. If you change your mind, run:

```bash
git filter-repo --path .env --path .env.development --path .env.production --invert-paths
git push --force-with-lease origin <branch>
```

---

## Phase 2 — Lock the webhook + rate-limit perimeter
- [x] `payments-webhook` no longer reads `env` from the request URL —
      derived from which webhook secret verifies the HMAC, with
      `event.livemode` cross-check
- [x] `processed_webhook_events` migration + idempotency check wraps every
      webhook handler (release-on-handler-error so Stripe retries can
      re-enter)
- [x] `extract-property-doc` calls `checkRateLimit()` (5/min/IP)
- [x] `extract-url-content` calls `checkRateLimit()` (5/min/IP).
      Note: SSRF guard already exists at `validateUrl` /
      `isPrivateHostname` — audit overstated this one.
- [x] `induce-schema` calls `checkRateLimit()` (10/min/IP)
- [x] `getInvitationByToken` + `declineInvitationByToken` rate-limited
      (10/min/IP). UUID-v4 token entropy makes constant-time compare
      computationally unnecessary; rate limit is the operational guard.
- [ ] **OWNER ACTION** — apply migration
      `20260510210000_processed_webhook_events.sql` to Supabase
- [ ] **OWNER ACTION** — switch Stripe webhook URL: drop the `?env=…`
      query parameter (URL is now ignored by the handler)

## Phase 3 — Scale-bombs
- [x] `getProviderOrders` no longer N+1's `auth.admin.getUserById` —
      single batched RPC call via `admin_get_user_emails_by_ids`
- [x] `setClientFreeFlag` no longer enumerates the first 200 users —
      targeted index lookup via `admin_get_user_id_by_email`
- [ ] **OWNER ACTION** — apply migration
      `20260510210500_admin_user_email_lookups.sql` to Supabase before
      this phase is deployed. The N+1 fixes will return `null` emails
      (with a `console.warn`) until the migration lands.
- [ ] explicit timeouts on `.rpc()` calls — DEFERRED to Phase 6 cleanup
      (defense-in-depth; current Cloudflare Worker / Supabase platform
      timeouts already bound the calls)

## Phase 4 — Server-fn validation + retries
- [x] every `inputValidator((d:T) => d)` no-op replaced with a Zod
      schema across:
      - `portal.functions.ts` (12 handlers)
      - `sandbox-demo.functions.ts` (4 handlers)
      - `grant-expiry.functions.ts` (1 handler)
      - `routes/p.$slug.index.tsx` (2 handlers)
      - `routes/p.$slug.builder.tsx` (1 handler)
- [x] Stripe SDK `maxNetworkRetries: 3` set in `_shared/stripe.ts` —
      covers all 7 Stripe call sites with one config (handles 5xx + 429
      + network errors with exponential backoff automatically)
- [x] new `_shared/retry.ts` with `retryFetch` + `retryWithBackoff`,
      wired into:
      - `induce-schema::callGemini` (covers all 4 modes)
      - `extract-url-content::structureFields` (Gemini structuring)
      - Retries 408/429/5xx + network errors only; 4xx propagate.

## Phase 5 — Frontend reliability
- [x] `__root.tsx` defines a global `errorComponent` (`RootErrorComponent`)
      — no more blank-page-on-render-error. Detail panel surfaces only in
      `import.meta.env.DEV`; prod users see "Something went wrong" + Try
      again / Go home.
- [x] new `activateDemoTier` server fn replaces the 4-write client flow
      in `DemoButton`. Idempotent via deterministic `stripe_session_id`
      (`demo_<tier>_<userId>`) + the existing `purchases UNIQUE
      (stripe_session_id)` constraint. Race-on-double-click is dead.
      Plus a synchronous `useRef` re-entry guard for clean UX.
- [x] `draft-storage::sanitizeForStorage` clears `access.password`
      before writing localStorage. Password lives in-tab memory only;
      reload requires re-entry. UI warning copy updated to match.
- [x] removed both `console.log("[ask] intent=…")` lines that were
      leaking user questions to the visitor's browser console.
- [x] type-augmented `admin_get_user_emails_by_ids` and
      `admin_get_user_id_by_email` in `types.ts`; dropped the
      `untyped = supabase as unknown as any` casts in `getProviderOrders`
      and `setClientFreeFlag`.
- [ ] Broader Supabase-types regen + remove `as any` from
      `_authenticated.dashboard.marketplace.tsx` / `stats.tsx` /
      `p.$slug.index.tsx` RPC loaders — DEFERRED to Phase 6
      (requires `supabase gen types typescript` CLI run).

## Phase 6 — Cleanup & consistency
- [x] duplicate mega-migration neutralised — content of
      `20260418181230_99ac7ac1-…sql` replaced with a `SELECT 1 WHERE
      FALSE;` no-op + explainer comment. File preserved so any
      environment that already recorded it in `schema_migrations`
      still resolves; future fresh installs no longer hit "already
      exists" on the duplicated CREATEs.
- [x] CORS standardised — new `supabase/functions/_shared/cors.ts`
      with `authedCorsHeaders` + `publicCorsHeaders` + `handlePreflight`.
      Rolled out to `synthesize-answer`, `extract-property-doc`,
      `extract-url-content`, `induce-schema`. Every refactored function
      now sends matching `Access-Control-Allow-Methods` + `Max-Age`
      that previously only `synthesize-answer` had.
- [x] explicit timeouts on the public/unauth `.rpc()` paths via new
      `src/lib/timeout.server.ts::withTimeout`. Wired into
      `getInvitationByToken` (8 s), `declineInvitationByToken` (8 s),
      `fetchBrandingBySlug` parallel fan-out (10 s), and the
      `verify_studio_preview_token` RPC (5 s).
- [x] `bunfig.toml` → `saveTextLockfile = true` (Bun 1.2+ default).
      Binary `bun.lockb` removed from git; `bun.lock` (text) is the
      sole source of truth. `bun install --frozen-lockfile` verified
      clean.
- [x] four orphan root binaries (`Chaska Commons Coworking.pdf`,
      `Chaska_Commons_Coworking_*.html`, `transcendencemedia-draft-*.json`,
      `3DPS Marketplace — MSP Handbook.md`) moved to `docs/examples/`.
      Tests reference Chaska data inline (by name), not by file path,
      so no test changes needed.
- [ ] edge-function error envelope standardisation — DEFERRED.
      Existing callers parse different fields per function
      (`{stage, detail}` for extract-*, `{code}` for create-connect-checkout,
      etc.). Refactoring the response shape risks breaking callers and
      is best done as its own scoped PR with each frontend caller
      updated in lockstep.
- [ ] broader Supabase types regen + drop `as any` casts in route
      loaders — DEFERRED. Needs `supabase gen types typescript` CLI run
      against the live project.
