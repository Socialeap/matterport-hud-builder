-- Atlas Curated Listing Assistant — admin curation pipeline.
--
-- `atlas_curation_jobs` lets an admin seed the public Atlas with high-quality
-- curated showcase listings from minimal inputs (Matterport URL + name/address),
-- then enrich/geocode/draft and review before creating an INACTIVE atlas_entries
-- row. Admin-only at rest. Not prospect outreach, not billing.
--
-- Also extends atlas_entries to support a `curated_showcase` kind and an
-- optional `relationship_status` so curated listings are clearly labelled
-- "unclaimed" until a business claims/approves them.

-- ── atlas_curation_jobs ──────────────────────────────────────────────────────
create table if not exists public.atlas_curation_jobs (
  id                    uuid primary key default gen_random_uuid(),
  created_by            uuid not null references auth.users(id) on delete cascade,

  -- Synchronous, admin-driven state machine (no async queue).
  status                text not null default 'draft'
                          check (status in (
                            'draft','needs_selection','ready_for_review',
                            'blocked','atlas_entry_created','rejected'
                          )),
  needs_human_review    boolean not null default false,

  -- Admin inputs
  input_matterport_url  text,
  extracted_matterport_id text,
  input_name            text,
  input_address         text,
  input_category        text,
  rights_note           text,

  -- Place resolution / geocoding
  google_place_id       text,
  formatted_address     text,
  latitude              numeric check (latitude  is null or (latitude  between -90  and 90)),
  longitude             numeric check (longitude is null or (longitude between -180 and 180)),
  geocode_confidence    text  check (geocode_confidence is null or geocode_confidence in
                            ('google_places','city_level','manual')),
  place_candidates      jsonb not null default '[]'::jsonb,
  website_url           text,
  phone                 text,

  -- Drafted Atlas metadata (queryable snapshot) + the full editable payload
  drafted_title         text,
  drafted_summary       text,
  drafted_category      text,
  drafted_tags          text[] not null default '{}',
  draft_payload         jsonb,

  -- Link to the created (inactive) Atlas entry, if any
  atlas_entry_id        uuid references public.atlas_entries(id) on delete set null,
  error_message         text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists atlas_curation_jobs_created_by_idx
  on public.atlas_curation_jobs(created_by);
create index if not exists atlas_curation_jobs_status_idx
  on public.atlas_curation_jobs(status, created_at desc);

-- Data API grants (RLS still applies)
grant select, insert, update, delete on public.atlas_curation_jobs to authenticated;
grant all                            on public.atlas_curation_jobs to service_role;

-- RLS: operator (admin) tool — admins manage all rows; service role unrestricted.
alter table public.atlas_curation_jobs enable row level security;

do $$ begin
  create policy "atlas_curation_jobs admin all"
    on public.atlas_curation_jobs for all to authenticated
    using (public.has_role(auth.uid(), 'admin'))
    with check (public.has_role(auth.uid(), 'admin'));
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "atlas_curation_jobs service role all"
    on public.atlas_curation_jobs for all
    using (auth.role() = 'service_role')
    with check (auth.role() = 'service_role');
exception when duplicate_object then null; end $$;

drop trigger if exists atlas_curation_jobs_set_updated_at on public.atlas_curation_jobs;
create trigger atlas_curation_jobs_set_updated_at
before update on public.atlas_curation_jobs
for each row execute function public.update_updated_at_column();

-- ── atlas_entries: support curated_showcase + relationship_status ─────────────
alter table public.atlas_entries drop constraint if exists atlas_entries_kind_check;
alter table public.atlas_entries add constraint atlas_entries_kind_check
  check (kind in ('demo','client_submitted','curated_showcase'));

alter table public.atlas_entries
  add column if not exists relationship_status text;

do $$ begin
  alter table public.atlas_entries add constraint atlas_entries_relationship_status_check
    check (relationship_status is null or relationship_status in
      ('unclaimed','claim_requested','claimed','removed'));
exception when duplicate_object then null; end $$;

comment on table public.atlas_curation_jobs is
  'Admin curation pipeline for seeding the public Atlas with curated showcase listings. Admin-only at rest.';
comment on column public.atlas_entries.relationship_status is
  'Curated listing claim state: unclaimed | claim_requested | claimed | removed. Null for demo/client_submitted.';
