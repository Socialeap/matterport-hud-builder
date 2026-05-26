# Backend Activation Manifest

## Status

Backend Activation Required: **YES**

---

## Pending Activations

### Restore get_providers_for_admin() RPC (2026-05-26)

**Summary:** The `get_providers_for_admin()` RPC function was accidentally overwritten by migration `20260420230205` to return only 3 fields (`provider_id`, `email`, `start_date`). This broke the Tier, Brand, and Slug columns in the admin MSP table. This activation restores the original 7-field return signature.

**Migration file:** `supabase/migrations/20260526_restore_admin_providers_rpc.sql`

**Safety check:**
- **Destructive operations: NONE**
- Uses `CREATE OR REPLACE FUNCTION` (overwrites the existing broken function, restoring it)
- `REVOKE ALL` + `GRANT EXECUTE` restores the same permission pattern already in place
- No `DROP`, `DELETE`, `TRUNCATE`, policy removal, or RLS weakening

**Do not touch:**
- `branding_settings` table and its policies
- `profiles` table and its policies
- `admin_grants` table
- Any existing Edge Functions

**Activation method:**

**Option A — Supabase Dashboard SQL Editor (recommended):**

1. Go to **https://supabase.com/dashboard**
2. Select your project
3. Click **SQL Editor** in the left sidebar
4. Paste the SQL below into the editor
5. Click **Run**
6. You should see "Success. No rows returned"

```sql
CREATE OR REPLACE FUNCTION public.get_providers_for_admin()
RETURNS TABLE (
  provider_id   uuid,
  brand_name    text,
  slug          text,
  tier          public.app_tier,
  display_name  text,
  email         text,
  start_date    timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT
    bs.provider_id,
    bs.brand_name,
    bs.slug,
    bs.tier,
    p.display_name,
    au.email::text,
    au.created_at AS start_date
  FROM public.branding_settings bs
  JOIN public.profiles p ON p.user_id = bs.provider_id
  JOIN auth.users au ON au.id = bs.provider_id
  ORDER BY au.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_providers_for_admin() FROM public;
GRANT EXECUTE ON FUNCTION public.get_providers_for_admin() TO authenticated;
```

**Verification steps:**

Run in SQL Editor after activation:

```sql
-- 1. Confirm the function returns 7 columns
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'get_providers_for_admin';
```

If the above returns no rows (common for function return types), use this instead:

```sql
-- 2. Call the function and check the output has all columns
SELECT provider_id, brand_name, slug, tier, display_name, email, start_date
  FROM public.get_providers_for_admin()
 LIMIT 3;
```

**Expected result:** Each row should show `provider_id`, `brand_name`, `slug`, `tier` (starter or pro), `display_name`, `email`, and `start_date`. The Tier column should no longer be blank in the admin portal.

---

### Add logo_shape column to branding_settings (2026-05-26)

**Summary:** Adds a `logo_shape` text column (`'circle'`, `'square'`, or `'landscape'`) to `branding_settings`. Controls how the primary logo is rendered in the portal header and HUD builder. Defaults to `'circle'` (preserving existing behavior).

**Migration file:** `supabase/migrations/20260526_add_logo_shape.sql`

**Safety check:**
- **Destructive operations: NONE**
- Uses `ADD COLUMN IF NOT EXISTS` (safe, idempotent)
- Default `'circle'` matches existing rounded-full behavior — no visual change until user explicitly selects a different shape
- No `DROP`, `DELETE`, `TRUNCATE`, policy removal, or RLS weakening

**Do not touch:**
- Existing RLS policies on `branding_settings`
- Any existing Edge Functions
- Storage buckets or policies

**Activation method:**

**Option A — Supabase Dashboard SQL Editor (recommended):**

1. Go to **https://supabase.com/dashboard**
2. Select your project
3. Click **SQL Editor** in the left sidebar
4. Paste the SQL below into the editor
5. Click **Run**

```sql
ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS logo_shape text NOT NULL DEFAULT 'circle';
```

**Verification:**

```sql
SELECT column_name, data_type, column_default
  FROM information_schema.columns
 WHERE table_name = 'branding_settings'
   AND column_name = 'logo_shape';
```

**Expected result:** One row: `logo_shape | text | 'circle'::text`

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
