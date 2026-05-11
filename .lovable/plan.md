## Goal
Land the remaining production-readiness items, doing as much as possible from inside Lovable. After re-reading the codebase, **the Stripe secret rotation called for in the audit doc is largely unnecessary** — this project uses Lovable's seamless Stripe gateway, not BYOK. The real Stripe secret keys live inside Lovable's connector gateway and were never committed to your repo. The `pk_live_…` publishable key is designed to be public.

## Phase A — I do this end-to-end (no console action from you)

### A1. Apply migration `20260510210000_processed_webhook_events.sql`
Idempotency ledger so Stripe webhook retries can't double-apply tier flips / license extensions. The handler in `payments-webhook/index.ts` is already wired to use it (`claimEvent` / `releaseEvent`).

### A2. Apply migration `20260510210500_admin_user_email_lookups.sql`
Two `SECURITY DEFINER` RPCs (`admin_get_user_emails_by_ids`, `admin_get_user_id_by_email`) granted only to `service_role`. Backs the N+1 fixes already merged in `src/lib/portal.functions.ts`. Until this lands, those calls return `null` emails with a console warning.

### A3. Rotate Supabase API keys (anon + service role JWTs)
Run `supabase--rotate_api_keys`. Lovable auto-updates `.env`, `client.ts`, `client.server.ts`, and the integration data. **One side effect**: every currently logged-in user gets signed out. They re-log in normally — no data loss.

### A4. Rotate `LOVABLE_API_KEY`
Run `ai_gateway--rotate_lovable_api_key`. Auto-updated in secrets, picked up by edge functions on next invocation. No user-visible impact.

### A5. Clean up `as any` casts in route loaders
After A1+A2 land and types regenerate, sweep these files where casts target columns that now exist in the regenerated `types.ts`:
- `src/routes/p.$slug.index.tsx` — `branding as any` for `ga_tracking_id`, `hero_bg_url`, `hero_bg_opacity`
- `src/routes/_authenticated.dashboard.stats.tsx` — `ga_tracking_id` casts
- `src/routes/_authenticated.dashboard.payouts.tsx` — `instant_payout_fee_bps` cast
- `src/routes/api/geocode-beacon.ts`, `geocode-branding.ts` — `geocoded_at`, `lat/lng` casts

I'll leave RPC casts (`(supabase as any).rpc(...)`) alone — those depend on whether Supabase's type generator picks up custom RPCs, which is hit or miss.

### A6. Update `AUDIT_REMEDIATION.md`
Tick off everything that landed; rewrite the "Owner action" section to match the seamless-Stripe reality.

## Phase B — Two small things only you can do (optional)

### B1. Rotate `PRESENTATION_TOKEN_SECRET` and `INTERNAL_GEOCODE_SECRET`
These are HMAC keys for portal share-link signing and internal beacon geocoding auth. They were in `.env` files in git history, so worth rotating. I'll open the secret-update form; you paste any random string (e.g. from `openssl rand -base64 48` or any password generator).

**Side effect**: any portal share links generated before the rotation stop verifying. If you've sent long-lived portal URLs to clients, give me a heads-up first — Phase 5 of the audit doc proposes a dual-secret verifier as a softer rollout.

### B2. (Skip) Stripe webhook URL cleanup
The audit doc lists "drop `?env=…` from the Stripe webhook URL" as a TODO, but I verified that `payments-webhook/index.ts` already derives env purely from which secret verifies the signature and ignores the query param entirely. Old URLs still work. **No action recommended.**

## Phase C — Confirmed NOT needed for this project

| Audit item | Why we skip |
|---|---|
| Rotate Stripe live publishable key | `pk_live_…` is designed to be public — it's in your frontend bundle by design |
| Rotate `PAYMENTS_LIVE_API_KEY` / `PAYMENTS_SANDBOX_API_KEY` | These are Lovable gateway connection identifiers, not real Stripe `sk_live_…` keys. The real secret never left Lovable's gateway. |
| Rotate `PAYMENTS_LIVE_WEBHOOK_SECRET` / `PAYMENTS_SANDBOX_WEBHOOK_SECRET` | Same — gateway-managed; never in your repo |

If you want extra reassurance, I can list the project secrets first so you can see exactly what's stored and what's gateway-managed before I rotate anything.

## Order of operations
1. **A1** → run migration #1, you click approve in the migration dialog.
2. **A2** → run migration #2, you click approve.
3. **A3** → rotate Supabase keys. (Fully automatic, but plan for everyone to re-log in.)
4. **A4** → rotate Lovable API key. (Fully automatic.)
5. **A5 + A6** → cast cleanup + audit doc update. (Just code edits.)
6. **B1** → only if you want to also burn the HMAC secrets — I open the form, you paste values.

## Risk summary
- A1, A2 — additive, idempotent SQL. Zero downtime.
- A3 — signs out current sessions; no data loss.
- A4 — invisible to users.
- A5, A6 — pure code/docs cleanup, no runtime change.
- B1 — invalidates outstanding portal share links if any exist.

Approve and I'll start with the two migrations.