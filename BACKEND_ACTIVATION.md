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
