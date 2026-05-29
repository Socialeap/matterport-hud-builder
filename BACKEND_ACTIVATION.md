# Backend Activation Manifest

## Status

Backend Activation Required: **YES** — sender domain `notify.3dps.transcendencemedia.com` must be re-verified in **Cloud → Emails** before any email (auth or transactional) can be delivered. All code/queue-side activations are applied as of 2026-05-27.

---

## Completed Activations

### Email Queue Processor Repair (2026-05-27) — VERIFIED

**Symptom:** Admin Portal email test stuck at `pending` / "Timed out waiting for delivery confirmation". `pgmq.q_transactional_emails` accumulated messages; every cron call to `/lovable/email/queue/process` returned `403`.

**Root cause:** The vault secret `email_queue_service_role_key` used by the `process-email-queue` pg_cron job no longer matched the runtime `SUPABASE_SERVICE_ROLE_KEY`, so the queue route rejected every cron call with `403` and queued emails were never drained.

**Action applied:** Re-ran managed email infrastructure setup (idempotent). This refreshed the vault secret and re-scheduled the `process-email-queue` cron job. No destructive SQL, no RLS changes, no schema changes.

**Verification:**
- `cron.job` shows `process-email-queue` active on a 5-second schedule.
- `net._http_response` now shows `200` responses from the queue processor (previously 100% `403`).
- Stuck `pending` row transitioned to a terminal status (`dlq` with `error_message = "Emails disabled for this project"`), confirming the processor is draining the queue and reaching the email API.

### Remaining Activation Required — Sender Domain Re-Verification

**Blocker:** The next-stage error revealed by the now-working queue is `Emails disabled for this project`. This is returned because `notify.3dps.transcendencemedia.com` is in a failed DNS-verification state ("provisioning timed out — domain was not fully verified within the allowed window"). Until the sender domain is re-verified, every queued email will move straight to DLQ.

**Required action (manual, in Lovable UI — NOT a SQL change):**
1. Open **Cloud → Emails → Manage Domains** for `notify.3dps.transcendencemedia.com`.
2. Click **Rerun Setup**. If that fails, click **Verify Domain**.
3. If both still fail, delete the domain and re-add it via the email setup dialog, then wait up to 72 hours for DNS propagation.

**Verification after re-verification:**
- Domain status reports `active` (not `failed`).
- A new admin test email logs `status = sent` in `public.email_send_log` and arrives in the recipient inbox.

**Safety note:** No destructive SQL is required. Do not weaken RLS, do not modify cron SQL by hand, do not edit the vault secret manually — if drift recurs, re-run the managed email infrastructure setup instead.

---

### Strategy A: 30-Day Trial with First Presentation Free (2026-05-26) — VERIFIED

**Summary:** Implemented Growth Strategy A with 30-day trial provisioning, updated purge logic (60-day post-expiry retention = Day 90 from signup), and a self-service `provision_trial_grant()` RPC.

**Migration file:** `supabase/migrations/20260526210000_strategy_a_30day_trial.sql`
**Applied via:** Lovable agent (`supabase--migration`)
**Verified on:** 2026-05-26
**Verification result:**
- `admin_grants.grant_reason` column present
- `provision_trial_grant(app_tier)` function present, `EXECUTE` granted to `authenticated`
- `purge_stale_trial_studios()` body references `v_cutoff` (60-day grant retention window applied)

**What the migration did:**
1. **ALTER TABLE** — Added nullable `grant_reason text` column to `admin_grants`
2. **CREATE FUNCTION** — `provision_trial_grant(app_tier)` SECURITY DEFINER RPC:
   - Creates provider role + 30-day evaluation grant atomically
   - Idempotent: updates tier if active trial grant already exists
   - Blocked if user already has paid access
3. **CREATE OR REPLACE FUNCTION** — `purge_stale_trial_studios()`:
   - Now checks `admin_grants.expires_at > v_cutoff` (not just `> now()`)
   - Ensures trial data is retained for 90 days total (30-day trial + 60-day retention)

**Safety note:** Migration itself non-destructive. Only adds a nullable column; the replaced purge function is more conservative (stricter eligibility) than its predecessor. No RLS weakening, no secret changes.

---

## Completed Activations

### Stale Preview Paywall + Data Reclamation (2026-05-26) — VERIFIED

**Summary:** Added the `provider_preview_allowed()` RPC (14-day grace for unpaid studios) and the `purge_stale_trial_studios()` reclamation function (deletes brand-asset + vault-asset files, preview tokens, and branding rows for trials inactive 60+ days with no license/purchase/grant). Scheduled the reclamation job to run daily at 03:50 UTC via pg_cron.

**Migration file:** `supabase/migrations/20260526200000_stale_preview_paywall_and_reclamation.sql`
**Applied via:** Lovable agent (`supabase--migration`)
**Verified on:** 2026-05-26
**Verification result:** `cron.schedule` returned job id `8`; both functions present in `pg_proc`.

**Safety note:** Migration itself non-destructive. `purge_stale_trial_studios()` performs runtime deletes only against trials matching all three "no active access" conditions (no active license, no completed purchase, no active admin grant) and inactive 60+ days.

---

### Add logo_shape column to branding_settings (2026-05-26) — VERIFIED

**Summary:** Added `logo_shape text NOT NULL DEFAULT 'circle'` column to `public.branding_settings`. Controls primary logo rendering (`circle` / `square` / `landscape`) in the portal header and HUD builder.

**Migration file:** `supabase/migrations/20260526_add_logo_shape.sql`
**Applied via:** Lovable agent (`supabase--migration`) — generated file `supabase/migrations/20260526174125_924834d3-0494-4913-acfe-cb48643a1e76.sql`
**Verified on:** 2026-05-26
**Verification result:** `information_schema.columns` shows `logo_shape | text | 'circle'::text` on `branding_settings`.

---

### Restore get_providers_for_admin() RPC (2026-05-26) — VERIFIED

**Summary:** Restored the original 7-column return signature (`provider_id`, `brand_name`, `slug`, `tier`, `display_name`, `email`, `start_date`) for the admin MSP table. Migration `20260420230205` had inadvertently reduced it to 3 columns, blanking the Tier/Brand/Slug columns in the admin portal.

**Migration file:** `supabase/migrations/20260526_restore_admin_providers_rpc.sql`
**Applied via:** Supabase Dashboard SQL Editor
**Verified on:** 2026-05-26
**Verification result:** `SELECT * FROM public.get_providers_for_admin() LIMIT 1;` returns all 7 columns; admin portal Tier/Brand/Slug columns populated.

---

## PR-A1 — Frontiers3D Billing Foundation (additive / inert)

> Appended by PR-A1. The manifest content **above** is the pre-existing repo
> activation state (incl. the open email-domain re-verification blocker) and
> is **unchanged** by this PR. The section below is this PR's activation
> detail, consolidated from `frontiers3d-core/BACKEND_ACTIVATION_TRACK_A1.md`.

# Backend Activation — Frontiers3D Track A · PR-A1 (Billing Foundation + Attribution Pipe)

> **Consolidated Track A activation doc.** This is the **single** activation
> doc shipped with PR-A1. It supersedes the per-phase drafts it was built from
> (`BACKEND_ACTIVATION_PHASE_3.md` = Phase 3.0 and
> `BACKEND_ACTIVATION_PHASE_3_4.md` = Phase 3.4). It was rebuilt **from the
> actual staged SQL**, not from the older phase docs — those drafts predate the
> `directory_request` source and still say "3 sources / 15 rows", which is now
> wrong.
>
> ⚠️ **Do NOT use the repo-root `BACKEND_ACTIVATION.md` for Track A.** That file
> is the **Phase 1 / Track B Gap-Discovery** activation doc (Map Oracle ingest)
> and has nothing to do with Track A billing. It must not be copied into any
> Track A PR. Each Track A PR ships its own `BACKEND_ACTIVATION_TRACK_Ax.md`.

## What this PR lands

| Migration | Phase | Purpose |
|---|---|---|
| `supabase/migrations/20260528400000_frontiers3d_platform_fee_foundation.sql` | 3.0 | `client_providers.acquisition_source`; `platform_fee_schedule`; `platform_fee_ledger`; `_resolve_platform_fee_cents`; **20-row** fee seed. |
| `supabase/migrations/20260529020000_frontiers3d_acquisition_attribution.sql` | 3.4 | `invitations.acquisition_source`; `CREATE OR REPLACE handle_new_user` (verbatim body + one propagated value). |

**Nature:** strictly additive, dormant. No code reads these objects until PR-A3
deploys the checkout/webhook. **Destructive:** NO. **Sign-off:** standard (but
note `handle_new_user` is signup-critical — Verification B confirms signups).

## Summary

Lays the additive DB foundation for the mandatory Frontiers3D platform fee,
which sits **on top of** the existing marketplace without altering it.

```text
Final Client Price = Frontiers3D platform fee + Provider retail fee
```

The platform fee is mandatory (a provider may waive their **own** retail fee,
never the platform fee) and scales by `(acquisition_source, model_count)`,
`model_count ∈ 1..5`.

### Acquisition sources (4) and fee schedule (20 active rows)

There are **four** acquisition sources. Three are **Marketplace**-tier; one is
**Direct**-tier:

| Source | Tier | 1 | 2 | 3 | 4 | 5 |
|---|---|---:|---:|---:|---:|---:|
| `map_oracle` | Marketplace | $20 | $30 | $40 | $50 | $60 |
| `agent_form` | Marketplace | $20 | $30 | $40 | $50 | $60 |
| `directory_request` | Marketplace | $20 | $30 | $40 | $50 | $60 |
| `scs_direct` | Direct | $10 | $15 | $20 | $25 | $30 |

That is **4 sources × 5 model counts = 20 active seed rows** (cents:
Marketplace `2000/3000/4000/5000/6000`, Direct `1000/1500/2000/2500/3000`).

> `directory_request` is the Engine-1 (directory / Request-Availability) source.
> It bills the **Marketplace** tier, identically to `map_oracle`. It is present
> in **every** CHECK constraint (`client_providers`, `platform_fee_schedule.source`,
> `platform_fee_ledger.acquisition_source`, `invitations`), in the
> `_resolve_platform_fee_cents` validation, and in the seed. The
> `client_providers` binding that *stamps* `directory_request` ships in PR-A2.

> **Interim attribution:** until the marketplace lead→client bridge lands
> (Phase 2-dependent, deferred), existing and invitation-created
> `client_providers` rows default to `scs_direct` (the safe Direct tier). No
> relationship resolves to the higher Marketplace fee without explicit
> attribution. PR-A2's directory-confirm trigger is the first writer that
> stamps a Marketplace source (`directory_request`).

## Safety Check

- [x] No `DROP`, `DELETE`, `TRUNCATE`, or destructive `ALTER`.
- [x] The only `ALTER`s are `ADD COLUMN IF NOT EXISTS` with safe defaults
      (`client_providers.acquisition_source`, `invitations.acquisition_source`,
      both `TEXT NOT NULL DEFAULT 'scs_direct'`) plus idempotent named CHECK adds.
- [x] No column drops, no type changes, no constraint loosening.
- [x] No policy removal, no RLS weakening on existing tables; new tables get RLS
      (service-role manage + admin read).
- [x] `handle_new_user` is reproduced **byte-for-byte** from
      `20260503000000_marketplace_foundation.sql` with the **only** change being
      the `client_providers` INSERT also propagating
      `acquisition_source = COALESCE(v_invitation.acquisition_source, 'scs_direct')`,
      mirroring the existing `is_free` propagation.
- [x] All objects use `IF NOT EXISTS` / `CREATE OR REPLACE` /
      `DO $$ … EXCEPTION WHEN duplicate_object THEN NULL` — re-runnable.
- [x] The 20-row seed `INSERT … WHERE NOT EXISTS` never duplicates rows or
      overwrites an adjusted active fee.
- [x] No secret / env-var changes. No cron. No Edge Function deploy.

## Required Actions

1. Copy the two migrations into the legacy repo. **Do not** copy any
   `PHASE_3_*` design doc or the root `BACKEND_ACTIVATION.md`.
2. Apply `20260528400000_frontiers3d_platform_fee_foundation.sql`, then
   `20260529020000_frontiers3d_acquisition_attribution.sql` (Dashboard SQL
   editor or `supabase db push`).
3. Run Verification A–J. No cron, no secrets, no Edge Function deploy.

## Verification

### A. Object presence
```sql
SELECT 'client_providers.acquisition_source' AS object,
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='client_providers'
                  AND column_name='acquisition_source') AS present
UNION ALL SELECT 'invitations.acquisition_source',
       EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema='public' AND table_name='invitations'
                  AND column_name='acquisition_source')
UNION ALL SELECT 'platform_fee_schedule', to_regclass('public.platform_fee_schedule') IS NOT NULL
UNION ALL SELECT 'platform_fee_ledger',   to_regclass('public.platform_fee_ledger')   IS NOT NULL
UNION ALL SELECT '_resolve_platform_fee_cents(text,integer)',
                 to_regproc('public._resolve_platform_fee_cents(text,integer)') IS NOT NULL
ORDER BY object;
```
Expected: `present = true` for all five.

### B. handle_new_user intact (signup not broken — critical)
- Self-signup MSP (no invite token) → succeeds; `branding_settings` row seeded.
- Invited-client signup (valid `invite_token`) → succeeds; `client_providers`
  row created; `user_roles` client; invitation `accepted`; `profiles.provider_id` set.

### C. acquisition_source columns — shape, backfill, 4-value CHECK
```sql
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema='public' AND table_name='client_providers'
   AND column_name='acquisition_source';
-- Expected: text | NO | 'scs_direct'::text

SELECT count(*) AS rows_not_scs_direct
  FROM public.client_providers WHERE acquisition_source <> 'scs_direct';
-- Expected: 0 immediately after activation (all pre-existing links backfilled)

SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid IN ('public.client_providers'::regclass, 'public.invitations'::regclass)
   AND conname LIKE '%acquisition_source_check'
 ORDER BY conname;
-- Expected: BOTH CHECKs =
--   CHECK (acquisition_source IN ('map_oracle','agent_form','directory_request','scs_direct'))
```

### D. RLS enabled on the two new tables
```sql
SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public'
   AND c.relname IN ('platform_fee_schedule','platform_fee_ledger')
 ORDER BY c.relname;
-- Expected: rls_enabled = true for both
```

### E. Seed completeness — exactly 20 active rows
```sql
SELECT count(*) AS active_rows
  FROM public.platform_fee_schedule WHERE effective_until IS NULL;
-- Expected: 20

SELECT source, model_count, fee_cents
  FROM public.platform_fee_schedule
 WHERE effective_until IS NULL
 ORDER BY source, model_count;
```
Expected (**20 rows**):

```
 source            | model_count | fee_cents
-------------------+-------------+-----------
 agent_form        |           1 |      2000
 agent_form        |           2 |      3000
 agent_form        |           3 |      4000
 agent_form        |           4 |      5000
 agent_form        |           5 |      6000
 directory_request |           1 |      2000
 directory_request |           2 |      3000
 directory_request |           3 |      4000
 directory_request |           4 |      5000
 directory_request |           5 |      6000
 map_oracle        |           1 |      2000
 map_oracle        |           2 |      3000
 map_oracle        |           3 |      4000
 map_oracle        |           4 |      5000
 map_oracle        |           5 |      6000
 scs_direct        |           1 |      1000
 scs_direct        |           2 |      1500
 scs_direct        |           3 |      2000
 scs_direct        |           4 |      2500
 scs_direct        |           5 |      3000
```

### F. Resolver returns correct fees for all 20 combinations
```sql
SELECT src AS source, mc AS model_count,
       public._resolve_platform_fee_cents(src, mc) AS resolved_cents
  FROM unnest(ARRAY['map_oracle','agent_form','directory_request','scs_direct']) AS src
  CROSS JOIN generate_series(1,5) AS mc
 ORDER BY 1,2;
```
Expected: 20 rows matching **E** (e.g. `directory_request,1 → 2000`;
`directory_request,5 → 6000`; `scs_direct,5 → 3000`).

### G. Resolver strictness — invalid inputs must FAIL
```sql
SELECT public._resolve_platform_fee_cents('unknown_source', 3);      -- ERROR 22023
SELECT public._resolve_platform_fee_cents('scs_direct', 0);          -- ERROR 22003
SELECT public._resolve_platform_fee_cents('map_oracle', 6);          -- ERROR 22003
SELECT public._resolve_platform_fee_cents(NULL, 3);                  -- ERROR 22023
SELECT public._resolve_platform_fee_cents('directory_request', NULL);-- ERROR 22003
```
Expected: every statement raises; none returns a value.

### H. Ledger exists but is empty (no production writer yet)
```sql
SELECT count(*) AS ledger_rows FROM public.platform_fee_ledger;  -- Expected: 0
```

### I. Function grants (service-role only, not PUBLIC)
```sql
SELECT p.proname, array_to_string(p.proacl::text[], ', ') AS grants
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname='_resolve_platform_fee_cents';
-- Expected: grants contains 'service_role=X/' and NOT '=X/' (PUBLIC)
```

### J. Attribution pipe propagates (3.4)
```sql
-- After creating an invitation with acquisition_source='directory_request'
-- (or 'map_oracle') and completing that invite's signup, the link inherits it:
SELECT cp.acquisition_source
  FROM public.client_providers cp
 WHERE cp.client_id = '<new invited client>';
-- Expected: the invitation's source (proves handle_new_user carries non-default origin).
-- A manual provider invite (no source specified) → 'scs_direct' (Direct tier).
```

## Do NOT Touch (verified untouched)

- Marketplace routing (`_provider_can_receive_leads`, `get_my_matched_beacons`,
  `claim_pending_beacon_matches`, `repool_expired_exclusives_and_enqueue`,
  `_is_provider_serving_beacon`, `search_msp_directory`).
- Pro exclusivity / exclusive-window flow.
- Stripe Connect, checkout, webhook (PR-A3 territory), `_shared/stripe.ts`,
  `_shared/pricing.ts`, provider retail pricing.
- `licenses` / `purchases` / setup-tier pricing.
- `resolve_studio_access` (the `acquisition_source` companion is a deferred
  Phase-2-dependent follow-up; inert while every link is `scs_direct`).
- The `auth.users` trigger that calls `handle_new_user` (unchanged).

## Rollback

Restore the prior `handle_new_user` body (from
`20260503000000_marketplace_foundation.sql`); drop `platform_fee_ledger`,
`platform_fee_schedule`, `_resolve_platform_fee_cents`, the
`client_providers.acquisition_source` column/index/CHECK, and the
`invitations.acquisition_source` column/CHECK. Safe — no consumers until PR-A3.

---

## Backend Activation Required: YES — **PR-A1 PR-ready**

**Destructive:** NO. **Sign-off:** standard.

**Result:** the platform-fee schema, **20-row** seed, strict resolver, and
attribution pipe exist; the resolver answers all 20 `(source, model_count)`
combinations (incl. `directory_request`) and rejects invalid inputs; the ledger
is empty; no behavior changes anywhere until PR-A3. Foundation ready for PR-A2
(directory binding) and PR-A3 (checkout + webhook).

---

## PR-A1 Activation Record (2026-05-29) — APPLIED & VERIFIED

GitHub PR #106 merged into `main`. Backend activation applied to the live
Lovable Cloud database and reconciled with source.

### Migrations applied (in order)

1. `supabase/migrations/20260528400000_frontiers3d_platform_fee_foundation.sql`
   — `client_providers.acquisition_source` (default `scs_direct`, 4-value CHECK
   incl. `directory_request`); `platform_fee_schedule` (20-row seed);
   `platform_fee_ledger`; `_resolve_platform_fee_cents(text,integer)` as
   `SECURITY DEFINER`; RLS enabled on both new tables (service-role manage +
   admin read).
2. `supabase/migrations/20260529020000_frontiers3d_acquisition_attribution.sql`
   — `invitations.acquisition_source` (default `scs_direct`, 4-value CHECK);
   `CREATE OR REPLACE handle_new_user` — byte-for-byte the prior body plus one
   propagated `acquisition_source` field on the `client_providers` INSERT.

### Follow-up REVOKE (post-migration hardening)

Supabase auto-grants EXECUTE on new functions to `anon`, `authenticated`, and
`sandbox_exec`. The migration's `REVOKE … FROM PUBLIC` alone does not strip
those role grants. Linter flagged it; a follow-up
`REVOKE EXECUTE ON FUNCTION public._resolve_platform_fee_cents(text,integer) FROM anon, authenticated, sandbox_exec;`
was applied. Linter count dropped 169 → 167. Resolver is now executable by
`service_role` only (Verification I passes).

### Verification A–J — all pass

| Check | Result |
|---|---|
| **A** Object presence (5 objects) | ✅ all present |
| **B** Signup paths unbroken | ✅ runtime smoke tests below |
| **C** `acquisition_source` shape; backfill = 0 non-default; CHECK includes `directory_request` on both tables | ✅ |
| **D** RLS enabled on `platform_fee_schedule` + `platform_fee_ledger` | ✅ |
| **E** Exactly 20 active seed rows (4 sources × 5 model counts) | ✅ |
| **F** Resolver returns correct cents for all 20 combinations | ✅ |
| **G** Resolver rejects invalid inputs (unknown source, 0, 6, NULLs) | ✅ errors 22023 / 22003 |
| **H** `platform_fee_ledger` exists and is empty | ✅ 0 rows |
| **I** Resolver EXECUTE granted to `service_role` only, not PUBLIC / anon / authenticated / sandbox_exec | ✅ after follow-up REVOKE |
| **J** Attribution propagates invitation → `client_providers.acquisition_source` | ✅ runtime smoke test below |

### Runtime signup smoke tests — PERFORMED 2026-05-29

Executed against the live database via the Supabase Admin API (test users
deleted after verification — no residual data).

1. **Self-signup MSP** (no invite token) → user created (`200`); `profiles`
   row seeded; `branding_settings` row seeded with the user as `provider_id`.
   ✅ pass.
2. **Invitation creation** with `acquisition_source='directory_request'`
   against a real provider → row inserted; `acquisition_source` persisted as
   `directory_request`. ✅ pass.
3. **Invited-client signup** (`raw_user_meta_data.invite_token` = the
   invitation token) → user created (`200`); `client_providers` row created
   with `acquisition_source = 'directory_request'` (propagated from
   invitation, NOT defaulted to `scs_direct`); `user_roles` row with
   `role = 'client'`; `profiles.provider_id` set to the inviting provider;
   `invitations.status` flipped to `accepted`. ✅ pass — proves the
   attribution pipe works end-to-end.
4. **Cleanup**: both test auth users deleted via Admin API (`200`).

### Out of scope — confirmed NOT touched

No changes were applied to: A2, A3, A4 migrations; Track B / Map Oracle;
Edge Functions (no deploys, no config changes); Stripe (Connect, checkout,
webhook, `_shared/stripe.ts`, `_shared/pricing.ts`); secrets / env vars;
`pg_cron` jobs; data mutations beyond the two migrations and the smoke-test
cleanup above. Marketplace routing functions, Pro exclusivity flow,
`licenses` / `purchases`, `resolve_studio_access`, and the
`auth.users → handle_new_user` trigger binding remain unchanged.

**Status:** PR-A1 fully activated, verified, and reconciled with `main`.
Ready for PR-A2 (directory binding) when greenlit.

---

## PR-A2 — Engine-1 Binding + Supply-Gap Signals (additive)

> Appended by PR-A2. All manifest content **above** (incl. the open
> email-domain blocker and the fully-activated PR-A1 record) is **unchanged**
> by this PR. The section below is this PR's activation detail, consolidated
> from `frontiers3d-core/BACKEND_ACTIVATION_TRACK_A2.md`. **Not yet activated.**

# Backend Activation — Frontiers3D Track A · PR-A2 (Engine-1 Binding + Supply-Gap Signals)

> **Consolidated Track A activation doc** shipped with PR-A2. Built from the
> actual staged SQL; supersedes `BACKEND_ACTIVATION_PHASE_3_6.md` (Phase 3.6)
> and `BACKEND_ACTIVATION_PHASE_3_7.md` (Phase 3.7).
>
> ⚠️ **Do NOT use the repo-root `BACKEND_ACTIVATION.md`** — it is the Phase 1 /
> Track B Gap-Discovery doc, not a Track A doc.

## What this PR lands

| Migration | Phase | Purpose |
|---|---|---|
| `supabase/migrations/20260529030000_frontiers3d_directory_request_binding.sql` | 3.6 | Trigger that creates the `client_providers(directory_request)` binding when a `work_orders` row is confirmed. |
| `supabase/migrations/20260529040000_frontiers3d_supply_gap_signals.sql` | 3.7 | `supply_gap_signals` table + `detect_directory_supply_gaps()` detector + `operator_open_supply_gaps` admin view. |

**Prerequisite:** PR-A1 (needs `client_providers.acquisition_source` **with
`directory_request` in its CHECK** and the 20-row fee schedule). The
`work_orders` / `work_order_invites` tables are legacy (already on `main`).

**Nature:** additive. **3.6 is behaviorally additive** (it starts creating
`client_providers` rows on directory confirmation, where before it created
none); 3.7 is pure observability. **No money moves until PR-A3 is live.**
**Destructive:** NO. **Sign-off:** required for 3.6 (it changes what a directory
confirmation does downstream — that client's later download will bill the
Marketplace fee once A3 ships).

## Summary

**3.6 — Engine-1 billing binding.** The directory / Request-Availability flow
is ~90% built: a client browses the MSP directory, requests availability
(`submit_work_order`), invited providers respond Available/Not Available, and
the client **confirms** one via `confirm_work_order_msp` (sets
`work_orders.status='confirmed'`, `confirmed_provider_id`, `pii_released_at`).
The only missing billing piece was that confirmation never created a
`client_providers` row, so the fee resolver never saw the relationship. This PR
adds an `AFTER UPDATE OF status, confirmed_provider_id` trigger on `work_orders`
that, on the transition **into** `confirmed` with a provider, inserts
`client_providers(client_id = agent_user_id, provider_id = confirmed_provider_id,
acquisition_source = 'directory_request')`.

- Honors the locked invariant: provider availability/response does **not** bind;
  only the client **confirming** a provider binds.
- `ON CONFLICT (client_id, provider_id) DO NOTHING` → `acquisition_source` is
  set-once; a prior `scs_direct` link is preserved (not overwritten).
- A trigger is used instead of editing the ~110-line SECURITY DEFINER
  `confirm_work_order_msp` RPC — captures the same conversion event, additively.

**3.7 — Supply-gap signals.** When a directory work order matches **zero**
eligible providers, the platform previously did nothing. This PR records a
`supply_gap_signals` row per unmatched demand and surfaces open gaps to admins —
the input the capacity-balancing model needs (0.4444 SCS/property). Recording +
surfacing only; no email (no configured ops recipient yet). `source_engine` is
generic so Engine 2 (Map Oracle) can record gaps here later.

## Safety Check

- [x] All changes additive: one trigger fn + trigger (3.6); one table + RLS +
      indexes + detector fn + view (3.7). No `DROP`/`DELETE`/`TRUNCATE`, no
      destructive ALTER, no policy/RLS/column change on existing tables.
- [x] `confirm_work_order_msp` and all work-order RPCs are **NOT** modified.
- [x] 3.6 trigger fires **only** on the transition into `confirmed` with a
      provider (guarded `OLD.status IS DISTINCT FROM 'confirmed'`) — re-saving an
      already-confirmed row does nothing.
- [x] `directory_request` bills the **Marketplace** tier (PR-A1 seed); physical
      capture stays off-platform.
- [x] 3.7: RLS = service-role manage + admin read; `operator_open_supply_gaps`
      is `security_invoker` (enforces admin-read); detector is `SECURITY DEFINER`,
      `service_role`-only; de-dups via `NOT EXISTS` + `UNIQUE(work_order_id)` +
      `ON CONFLICT DO NOTHING`.
- [x] Idempotent / re-runnable. No secrets.

## Required Actions

1. Confirm PR-A1 applied (`client_providers.acquisition_source` CHECK includes
   `directory_request`; fee schedule has the 5 `directory_request` rows).
2. Apply `20260529030000_frontiers3d_directory_request_binding.sql`.
3. Apply `20260529040000_frontiers3d_supply_gap_signals.sql`.
4. **Cron (PR-A2):** schedule the supply-gap detector (cadence is ops choice;
   hourly is reasonable — gaps aren't latency-sensitive). Schedule lives outside
   the migration, per the Phase 1/2 convention:
   ```sql
   SELECT cron.schedule(
     'frontiers3d-detect-supply-gaps',
     '0 * * * *',
     $cron$ SELECT public.detect_directory_supply_gaps(); $cron$
   );
   ```
   No other Track-A cron. No new secrets, no Edge Function change.

## Verification

### A. `directory_request` resolves to Marketplace pricing (PR-A1 dependency)
```sql
SELECT mc AS model_count, public._resolve_platform_fee_cents('directory_request', mc) AS cents
  FROM generate_series(1,5) AS mc;          -- expect 2000,3000,4000,5000,6000
SELECT count(*) FROM public.platform_fee_schedule
 WHERE source='directory_request' AND effective_until IS NULL;   -- expect 5
```

### B. 3.6 trigger present
```sql
SELECT tgname FROM pg_trigger
 WHERE tgrelid='public.work_orders'::regclass
   AND tgname='trg_work_order_confirm_links_client_provider';     -- expect 1 row
```

### C. Confirmation creates the binding (end-to-end, sandbox)
1. Run the directory flow: agent submits a work order, a provider responds
   Available, the agent calls `confirm_work_order_msp(wo, provider)`.
2. Expect a new `client_providers` row:
```sql
SELECT client_id, provider_id, acquisition_source
  FROM public.client_providers
 WHERE client_id = '<work_order.agent_user_id>'
   AND provider_id = '<confirmed_provider_id>';
-- expect: acquisition_source = 'directory_request'
```
3. Existing behavior intact: `work_orders.status='confirmed'`,
   `pii_released_at` set, other invites `not_selected`.

### D. Idempotency / origin preservation (3.6)
- Re-running confirm (or a status re-save) does not duplicate or change the row.
- A pre-existing `scs_direct` link for that (client, provider) is **preserved**.

### E. Billing applies automatically once PR-A3 is live (no checkout change here)
- After PR-A3, when the confirmed provider builds a `saved_models` row for that
  client and the client checks out, `create-connect-checkout` resolves the
  **Marketplace** fee ($20–$60 by model count); the `platform_fee_ledger` row
  carries `acquisition_source='directory_request'`.

### F. 3.6 regression
- A provider being invited / responding Available creates **no** `client_providers`
  row (only confirmation does). `scs_direct` (provider-invite) flow unchanged.

### G. 3.7 objects present
```sql
SELECT to_regclass('public.supply_gap_signals') IS NOT NULL AS table_ok,
       to_regproc('public.detect_directory_supply_gaps(interval)') IS NOT NULL AS fn_ok,
       to_regclass('public.operator_open_supply_gaps') IS NOT NULL AS view_ok;
-- expect: true, true, true
SELECT relrowsecurity FROM pg_class WHERE oid='public.supply_gap_signals'::regclass; -- expect: t
```

### H. 3.7 detector records a zero-invite gap (sandbox)
1. Create a work order matching no eligible providers (or a synthetic
   `work_orders` row with no `work_order_invites`).
2. `SELECT public.detect_directory_supply_gaps();` → returns ≥1.
3. ```sql
   SELECT source_engine, work_order_id, resolved_at
     FROM public.supply_gap_signals ORDER BY created_at DESC LIMIT 5;
   -- expect a 'directory_request' row, resolved_at NULL
   ```

### I. 3.7 idempotency / matched-WO / admin view
- Re-run detector → returns 0 (no duplicate; `UNIQUE(work_order_id)` + `NOT EXISTS`).
- A work order that DID receive invites is never recorded.
- `SELECT * FROM public.operator_open_supply_gaps;` returns gaps for an admin,
  nothing for a non-admin (the `security_invoker` view enforces admin-read RLS).

## Do NOT Touch (unchanged)

- `confirm_work_order_msp`, `submit_work_order`, all work-order RPCs, the
  directory / Request-Availability / response / confirm UIs.
- `create-connect-checkout`, `payments-webhook`, provider retail pricing (PR-A3).
- Pro-window / responsiveness / SLA / ratings; the PII gate (`pii_released_at`).
- PR-A1 objects (consumed read-only).

## Out of scope (flagged)

- **Client-vs-agent payer assumption:** the binding maps `work_orders.agent_user_id`
  to the billing client. If the true payer differs from the requesting agent,
  revisit the mapping.
- **Ops notification / auto-resolve** of supply gaps — follow-ups once a
  recruiting recipient is defined.
- **Engine 2 (Map Oracle)** — future; gated on Track B (Phases 1/2/2.5).

## Rollback

```sql
DROP TRIGGER trg_work_order_confirm_links_client_provider ON public.work_orders;
DROP FUNCTION public._link_client_provider_on_work_order_confirm();
-- 3.7:
-- unschedule the cron, then
DROP VIEW public.operator_open_supply_gaps;
DROP FUNCTION public.detect_directory_supply_gaps(INTERVAL);
DROP TABLE public.supply_gap_signals;
```
Any `client_providers(directory_request)` rows already created are harmless (or
delete if desired).

---

## Backend Activation Required: YES — **PR-A2 PR-ready** (pending 3.6 sign-off)

**Destructive:** NO. **Behavioral (3.6):** YES — sign-off required.

**Result:** confirming a provider in the directory flow binds the
client↔provider relationship as `directory_request` (Marketplace tier, billed
once PR-A3 is live); unmatched directory requests are recorded as
`supply_gap_signals` and surfaced to admins. No change to the directory UI,
checkout, webhook, or provider pricing.
