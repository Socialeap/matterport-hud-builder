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

### Owner runbook — key rotation status (2026-05-11 update)

The audit doc was originally written assuming a BYOK Stripe + bare-Supabase
setup. After re-reading the codebase, the rotation list collapses sharply
once you account for Lovable Cloud's gateway model:

1. **Stripe — NOT NEEDED.** This project uses Lovable's **seamless** Stripe
   gateway, not BYOK. The `STRIPE_*_API_KEY` env vars are gateway connection
   identifiers — the real `sk_live_…` lives inside Lovable's connector
   gateway and was never committed to this repo. The `pk_live_…` publishable
   key is designed to be public. `PAYMENTS_*_WEBHOOK_SECRET` is also
   gateway-managed. No rotation required from a leak-mitigation standpoint.

2. **Supabase — DONE.** Anon + service role JWTs rotated via Lovable's
   `supabase--rotate_api_keys` on 2026-05-11. `.env`, integration data, and
   generated client files updated automatically. All previously-issued
   sessions invalidated; users sign back in normally.

3. **`PRESENTATION_TOKEN_SECRET` + `INTERNAL_GEOCODE_SECRET` — PENDING owner
   action.** These HMAC secrets were in `.env` files in git history. Rotate
   via Lovable Cloud Secrets panel. Side effect: any previously-issued portal
   share links stop verifying — Phase 5 dual-secret verifier is the softer
   rollout if long-lived URLs are in the wild.

4. **`LOVABLE_API_KEY` — DONE.** Rotated via `ai_gateway--rotate_lovable_api_key`
   on 2026-05-11. Auto-applied; invisible to users.

### Why we are NOT rewriting git history (per your direction)
The historic `.env` values remain readable in `bc09e2a`. Rotating the
remaining secrets (item 3 above) is the actual mitigation. History rewrite
is optional and requires force-push + re-clone for every collaborator. If
you change your mind, run:

```bash
git filter-repo --path .env --path .env.development --path .env.production --invert-paths
git push --force-with-lease origin <branch>
```

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
- [x] migration `20260510210000_processed_webhook_events.sql` applied
      (2026-05-11)
- [x] Stripe webhook URL `?env=…` cleanup — N/A. Handler now derives env
      from which secret verifies the HMAC; query param is ignored. No
      Stripe-dashboard change required.

## Phase 3 — Scale-bombs
- [x] `getProviderOrders` no longer N+1's `auth.admin.getUserById` —
      single batched RPC call via `admin_get_user_emails_by_ids`
- [x] `setClientFreeFlag` no longer enumerates the first 200 users —
      targeted index lookup via `admin_get_user_id_by_email`
- [x] migration `20260510210500_admin_user_email_lookups.sql` applied
      (2026-05-11)
- [ ] explicit timeouts on `.rpc()` calls — DEFERRED to Phase 6 cleanup
      (defense-in-depth; current Cloudflare Worker / Supabase platform
      timeouts already bound the calls)

## Phase 4 — Server-fn validation + retries
- [ ] every `inputValidator((d:T) => d)` in `portal.functions.ts` replaced
      with a Zod schema
- [ ] shared retry helper (exponential backoff + jitter) wired into Stripe +
      Gemini calls

## Phase 5 — Frontend reliability
- [ ] `__root.tsx` defines a `defaultErrorComponent`
- [ ] demo activation server-side and idempotent (kills the double-click race)
- [ ] `draft-storage` no longer persists plaintext password
- [ ] `[ask] intent=… q=…` and similar user-payload `console.log` calls
      removed or gated behind `import.meta.env.DEV`
- [ ] Supabase types regenerated; `as any` casts removed from route loaders

## Phase 6 — Cleanup & consistency
- [ ] duplicate `lus_freezes` migration deleted
- [ ] edge-function error envelope shared via `_shared/errors.ts`
- [ ] CORS standardised across all user-facing edge functions
- [ ] `bunfig.toml` and `bun.lock` / `bun.lockb` mode reconciled
- [ ] orphan root binaries (`Chaska_Commons_Coworking_*`, etc.) moved or removed
