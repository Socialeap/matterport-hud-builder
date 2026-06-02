## Problem

The Curated Atlas Listing Assistant fails with:

> Could not find the table `public.atlas_curation_jobs` in the schema cache

**Root cause:** The migration file `supabase/migrations/20260610000000_frontiers3d_atlas_curation_jobs.sql` is present in the repo, but it was never applied to the live Lovable Cloud database. Verified with `SELECT to_regclass('public.atlas_curation_jobs')` — returns NULL. Per project policy (CLAUDE.md), code merges do not automatically activate backend changes.

No application code changes are needed — `src/lib/atlas-curation.functions.ts` and `src/routes/_authenticated.admin.atlas-curation.tsx` are already correct and expect this exact schema.

## Fix

Apply the existing migration (verbatim) via `supabase--migration` so it becomes the canonical record and the table is created in the live DB. This will:

1. Create `public.atlas_curation_jobs` with all columns, checks, indexes, GRANTs (authenticated + service_role), RLS enabled, and admin-only + service-role RLS policies.
2. Attach the `updated_at` trigger using the existing `public.update_updated_at_column()` function.
3. Extend `public.atlas_entries`:
   - Replace `kind` check to allow `curated_showcase` (in addition to `demo`, `client_submitted`).
   - Add nullable `relationship_status` column with check (`unclaimed | claim_requested | claimed | removed`).

The migration uses `if not exists` / `do $$ ... exception when duplicate_object ...` guards, so it is safe to re-run.

## Safety review

- No `DROP TABLE`, `DELETE`, `TRUNCATE`, or destructive policy removal.
- One `ALTER TABLE ... DROP CONSTRAINT IF EXISTS atlas_entries_kind_check` followed immediately by re-adding the widened check — non-destructive, only relaxes the constraint.
- Adds a nullable column, so no row rewrites or data loss.
- RLS is enabled before policies are created; admin-only + service_role policies match the rest of the curation surface.
- GRANTs match the project's `public schema GRANTs` rule.

## Verification (after migration runs)

```sql
SELECT to_regclass('public.atlas_curation_jobs');           -- expect: atlas_curation_jobs
SELECT polname FROM pg_policy WHERE polrelid = 'public.atlas_curation_jobs'::regclass;
                                                            -- expect: admin all, service role all
SELECT conname FROM pg_constraint WHERE conrelid = 'public.atlas_entries'::regclass
  AND conname IN ('atlas_entries_kind_check','atlas_entries_relationship_status_check');
                                                            -- expect: both present
```

Then in the UI: go to `/admin/atlas-curation`, submit a Matterport URL + name/address. The "schema cache" error should be gone, and a job row should be created (status `ready_for_review`, `needs_selection`, or `blocked` depending on geocoding).

## Files touched

- No source code changes.
- One `supabase--migration` call replaying the contents of `supabase/migrations/20260610000000_frontiers3d_atlas_curation_jobs.sql`.
- Update `BACKEND_ACTIVATION.md` to record the activation per project policy.

## Backend Activation Required: YES

- **Action:** Apply migration creating `public.atlas_curation_jobs` (+ trigger, RLS, GRANTs) and extending `public.atlas_entries` (kind check, `relationship_status`).
- **Verification:** SQL queries above.
- **Expected result:** Table exists, two RLS policies present, both `atlas_entries` constraints present, Curated Atlas Listing Assistant submission succeeds.
