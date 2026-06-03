## Root cause

The "Open Showcase PR" / "Approve & Publish" action in `src/lib/atlas-curation.functions.ts` writes to columns (`merged_at`, `showcase_pr_number`, `showcase_branch`) and uses widened `publish_status` values (`merged`, `pending_deploy`) that only exist in the migration file `supabase/migrations/20260613000000_frontiers3d_atlas_showcase_merge.sql`.

That migration was committed to the repo but **never applied to the live database**. Confirmed via `information_schema.columns` — none of the three columns exist on `public.atlas_curation_jobs` today. PostgREST therefore rejects the update with:

> Could not find the 'merged_at' column of 'atlas_curation_jobs' in the schema cache

This matches the project's documented gotcha: merging a PR into `main` does not auto-apply Supabase migrations (see `POST_MERGE_CHECKLIST.md`).

## Fix

Apply the existing, non-destructive migration as-is. It only:

1. Adds three nullable columns to `public.atlas_curation_jobs`:
   - `showcase_pr_number integer`
   - `showcase_branch text`
   - `merged_at timestamptz`
2. Drops + re-adds the `publish_status` CHECK constraint to allow the new values `merged` and `pending_deploy` (alongside the existing `none`, `pr_open`, `published`, `failed`).
3. Adds column comments.

No table drops, no data deletes, no RLS or GRANT changes (existing policies cover the new columns). Safe to apply.

## Steps

1. Run the migration `20260613000000_frontiers3d_atlas_showcase_merge.sql` against the database via the migration tool (same SQL as the committed file).
2. Let Lovable regenerate `src/integrations/supabase/types.ts` so `merged_at` / `showcase_pr_number` / `showcase_branch` are typed.
3. No app code changes needed — the code already targets the post-migration schema.

## Verification

```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND table_name='atlas_curation_jobs'
  AND column_name IN ('merged_at','showcase_pr_number','showcase_branch');
-- expect 3 rows

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid='public.atlas_curation_jobs'::regclass
  AND conname='atlas_curation_jobs_publish_status_check';
-- expect CHECK to include 'merged' and 'pending_deploy'
```

Then in the UI: open a curation job with an open showcase PR → click **Approve & Publish** → action should succeed and the row should move to `publish_status = 'merged'` (or `pending_deploy`) with `merged_at` populated.

## Backend Activation Required: YES
- **Migration:** `supabase/migrations/20260613000000_frontiers3d_atlas_showcase_merge.sql` (additive, non-destructive)
- **Expected result:** three new columns present + widened CHECK constraint; "Approve & Publish" stops 400-ing.
