# Fix: "Upload failed: Bucket not found" on floor plan upload

## Root cause

The Interactive Floor Map feature ships a migration at
`supabase/migrations/20260514130000_ephemeral_floorplan_assets.sql` that creates:

- the private `temporary-floorplans` storage bucket
- the `public.ephemeral_assets` tracking table + RLS policies
- storage-level RLS policies scoped to `{user_id}/...` paths
- the `purge_expired_ephemeral_assets()` SECURITY DEFINER function
- a daily 03:45 UTC pg_cron sweep

That SQL file exists in the repo, but it was **never executed against the live database**. Verification:

- `select id from storage.buckets where id = 'temporary-floorplans';` → 0 rows
- `select to_regclass('public.ephemeral_assets');` → NULL

So when the browser calls `supabase.storage.from("temporary-floorplans").upload(...)` from `InteractiveFloorMap.tsx`, Storage correctly returns **"Bucket not found"**. The frontend, the `vectorize-floorplan` edge function, and `src/lib/portal/floor-map.ts` all reference the correct names — the only missing piece is the schema/bucket itself.

## Plan

1. **Re-run the migration** by calling `supabase--migration` with the exact SQL from `20260514130000_ephemeral_floorplan_assets.sql`. The SQL is fully idempotent (`CREATE TABLE IF NOT EXISTS`, `INSERT … ON CONFLICT DO NOTHING`, `EXCEPTION WHEN duplicate_object`, and a `cron.unschedule` guard before `cron.schedule`), so executing it now will create everything cleanly without conflicting with any partially-applied state.

2. **No code changes.** The bucket name (`temporary-floorplans`), the path layout (`{user_id}/{timestamp}-{filename}`), the `ephemeral_assets` insert in `InteractiveFloorMap.tsx`, and the service-role download path in `supabase/functions/vectorize-floorplan/index.ts` are all already correct.

3. **Verify** after the migration is approved:
   - `storage.buckets` contains `temporary-floorplans` (private)
   - `public.ephemeral_assets` exists with RLS enabled
   - Re-test: upload a PNG/JPG floor plan as a Pro provider and confirm the upload completes and `vectorize-floorplan` returns SVG.

## Why not change the code instead

The code is correct and intentional — privacy-first design (private bucket + signed access + 30-day auto-purge). Changing the bucket name or making it public would either break the edge function or weaken the privacy posture. The right fix is to apply the missing schema.

## Risk

Very low. The migration is additive and idempotent. No existing rows, policies, or buckets share these names today (verified). The cron schedule uses `unschedule` first to avoid duplicate-job errors on re-runs.
