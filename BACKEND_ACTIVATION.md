# Backend Activation Manifest

## Status

Backend Activation Required: **NO**

All pending backend activations have been applied and verified.

---

## Completed Activations

### site_settings table (2026-05-25) — VERIFIED

**Summary:** Created the `site_settings` table for the admin-controlled waitlist/Stripe toggle feature. Stores a global `checkout_mode` setting (`"live"` or `"waitlist"`) that controls whether home page pricing buttons open Stripe checkout or a Jotform waitlist modal.

**Applied via:** Supabase Dashboard SQL Editor
**Verified on:** 2026-05-25
**Verification result:** `SELECT * FROM public.site_settings;` returned `checkout_mode = live`

**Actions completed:**
1. Created `public.site_settings` table
2. Seeded `checkout_mode` row with default value `"live"`
3. Enabled RLS on the table
4. Created public read policy

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
