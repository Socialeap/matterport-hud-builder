alter table public.atlas_curation_jobs
  add column if not exists showcase_slug text,
  add column if not exists publish_status text not null default 'none'
    check (publish_status in ('none','pr_open','published','failed')),
  add column if not exists showcase_pr_url text,
  add column if not exists deployed_url text,
  add column if not exists published_at timestamptz,
  add column if not exists publish_error text;

comment on column public.atlas_curation_jobs.publish_status is
  'Showcase publishing state: none | pr_open (PR opened in showcases repo) | published (deployed URL attached) | failed.';
comment on column public.atlas_curation_jobs.showcase_slug is
  'Folder name under the showcases repo / Netlify site, e.g. wonderland-nyc → https://<site>/wonderland-nyc/.';