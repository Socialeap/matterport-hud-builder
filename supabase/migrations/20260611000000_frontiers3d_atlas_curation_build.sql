-- Curated Atlas Listing Assistant — package build tracking.
--
-- Adds build-state columns to atlas_curation_jobs so an admin can generate a
-- minimal-but-real Frontiers3D presentation package (Matterport embed +
-- atlas-manifest.json) from a curated job and download it. No Netlify deploy
-- here; no public activation.

alter table public.atlas_curation_jobs
  add column if not exists build_status text not null default 'none'
    check (build_status in ('none','building','built','failed')),
  add column if not exists built_at timestamptz,
  add column if not exists package_filename text,
  add column if not exists package_size_bytes integer,
  add column if not exists build_error text;

comment on column public.atlas_curation_jobs.build_status is
  'Presentation package build state: none | building | built | failed.';
