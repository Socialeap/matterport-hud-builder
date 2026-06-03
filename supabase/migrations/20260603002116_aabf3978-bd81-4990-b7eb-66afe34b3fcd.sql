alter table public.atlas_curation_jobs
  add column if not exists build_status text not null default 'none'
    check (build_status in ('none','building','built','failed')),
  add column if not exists built_at timestamptz,
  add column if not exists package_filename text,
  add column if not exists package_size_bytes integer,
  add column if not exists build_error text;

comment on column public.atlas_curation_jobs.build_status is
  'Presentation package build state: none | building | built | failed.';