alter table public.atlas_curation_jobs
  add column if not exists showcase_pr_number integer,
  add column if not exists showcase_branch text,
  add column if not exists merged_at timestamptz;

alter table public.atlas_curation_jobs
  drop constraint if exists atlas_curation_jobs_publish_status_check;
alter table public.atlas_curation_jobs
  add constraint atlas_curation_jobs_publish_status_check
  check (publish_status in ('none','pr_open','merged','pending_deploy','published','failed'));

comment on column public.atlas_curation_jobs.showcase_pr_number is
  'PR number in Socialeap/frontiers3d-atlas-showcases for this job''s showcase. Stored at PR-open time so the admin "Approve & Publish" action can merge via the GitHub API without taking a PR number from user input.';
comment on column public.atlas_curation_jobs.showcase_branch is
  'Head branch of the showcase PR (always curate/<slug>-<rand>). Verified to begin with curate/ and to match the live PR head before any programmatic merge.';
comment on column public.atlas_curation_jobs.merged_at is
  'When the showcase PR was merged via the GitHub API by the admin "Approve & Publish" action.';
comment on column public.atlas_curation_jobs.publish_status is
  'Showcase publishing state: none | pr_open (PR opened) | merged (PR merged via API, Netlify deploying) | pending_deploy (merged but deploy/verify not yet confirmed) | published (deployed URL verified + attached) | failed.';