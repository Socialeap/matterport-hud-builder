# Backend Activation Manifest

## Status

Backend Activation Required: **NO** (all pending activations applied as of 2026-05-26)

---

## Pending Activations

_None. All known backend migrations have been applied and verified._

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

## Template for Future Backend Activations

<!-- Copy the section below when a new backend change is needed -->

## Required Backend Actions

1. (list exact actions)

## Migration Files to Apply

- `supabase/migrations/20260525_add_site_settings.sql`

## Edge Functions to Deploy

None.

## Storage Buckets / Policies

None.

## RLS Policies

- **New policy:** `"Anyone can read site_settings"` on `public.site_settings` for `SELECT` — allows all roles (anon, authenticated) to read settings
- **Write access:** No INSERT/UPDATE/DELETE policies for anon or authenticated. All writes go through `supabaseAdmin` (service-role) in server functions.

## Database Functions / Triggers

None.

## Secrets / Environment Variables

None (uses existing `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`).

## Do Not Touch

- `branding_settings` table and its policies
- `user_roles` table and its policies
- Any existing Edge Functions
- Stripe webhook configuration
- Auth providers configuration

## Safety Check

**Destructive operations: NONE**

The migration contains only:
- `CREATE TABLE IF NOT EXISTS` (safe, idempotent)
- `INSERT ... ON CONFLICT DO NOTHING` (safe, idempotent)
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` (non-destructive)
- `CREATE POLICY` (additive only)

No `DROP`, `DELETE`, `TRUNCATE`, destructive `ALTER`, policy removal, or RLS weakening.

## Activation Method

**Option A — Supabase Dashboard SQL Editor (recommended):**
Run the SQL below directly in the SQL Editor.

**Option B — Lovable agent tooling:**
Ask Lovable to apply the migration file `supabase/migrations/20260525_add_site_settings.sql`.

**Option C — Supabase CLI:**
```bash
supabase link --project-ref cllvwdzjgqlkdquroauz
supabase db push
```

## Exact SQL / CLI Commands

```sql
-- Run in Supabase SQL Editor

create table if not exists public.site_settings (
  key   text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into public.site_settings (key, value)
values ('checkout_mode', '"live"'::jsonb)
on conflict (key) do nothing;

alter table public.site_settings enable row level security;

create policy "Anyone can read site_settings"
  on public.site_settings for select
  using (true);
```

## Verification Steps

Run in SQL Editor after activation:

```sql
-- 1. Confirm table exists and has the seed row
SELECT * FROM public.site_settings WHERE key = 'checkout_mode';

-- 2. Confirm RLS is enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'site_settings';

-- 3. Confirm the read policy exists
SELECT policyname, cmd, qual
FROM pg_policies
WHERE tablename = 'site_settings';
```

## Expected Results

1. **Row exists:**
   | key | value | updated_at | updated_by |
   |-----|-------|------------|------------|
   | checkout_mode | "live" | (timestamp) | null |

2. **RLS enabled:**
   | relname | relrowsecurity |
   |---------|----------------|
   | site_settings | true |

3. **Policy exists:**
   | policyname | cmd | qual |
   |------------|-----|------|
   | Anyone can read site_settings | SELECT | true |
