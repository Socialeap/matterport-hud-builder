-- ── Table ───────────────────────────────────────────────────────────────────
create table public.atlas_entries (
  id                uuid primary key default gen_random_uuid(),

  -- Source + visibility (text + CHECK; categories/lifecycle expected to evolve)
  kind              text not null default 'demo'
                      check (kind in ('demo','client_submitted')),
  status            text not null default 'pending_review'
                      check (status in ('pending_review','active','inactive','rejected')),
  -- Derived flag so the public route filter stays simple
  is_active         boolean generated always as (status = 'active') stored,

  -- Display
  title             text not null check (char_length(title) between 1 and 160),
  summary           text     check (summary is null or char_length(summary) <= 600),
  hero_image_url    text     check (hero_image_url is null or hero_image_url ~ '^https://'),
  category          text not null default 'other'
                      check (char_length(category) between 1 and 40),
  tags              text[] not null default '{}',
  sort_order        integer not null default 0,

  -- Location
  address           text,
  city              text,
  region            text,
  country           text default 'US',
  latitude          numeric  check (latitude  is null or (latitude  between -90  and 90)),
  longitude         numeric  check (longitude is null or (longitude between -180 and 180)),

  -- Presentation (https-only; javascript:/data: blocked by regex)
  presentation_url  text
                      check (
                        presentation_url is null
                        or (presentation_url ~ '^https://' and char_length(presentation_url) <= 2048)
                      ),
  saved_model_id    uuid,

  -- Ownership / review
  owner_user_id     uuid references auth.users(id) on delete set null,
  submitted_at      timestamptz,
  reviewed_at       timestamptz,
  reviewed_by       uuid references auth.users(id) on delete set null,
  rejection_reason  text     check (rejection_reason is null or char_length(rejection_reason) <= 500),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Submission keys for client_submitted (one row per owner+saved_model OR owner+url)
create unique index atlas_entries_client_by_saved_model
  on public.atlas_entries(owner_user_id, saved_model_id)
  where kind = 'client_submitted' and saved_model_id is not null;
create unique index atlas_entries_client_by_url
  on public.atlas_entries(owner_user_id, presentation_url)
  where kind = 'client_submitted' and saved_model_id is null;

create index atlas_entries_status_sort on public.atlas_entries(status, sort_order, created_at);
create index atlas_entries_owner       on public.atlas_entries(owner_user_id);

-- ── Data API grants ─────────────────────────────────────────────────────────
grant select                            on public.atlas_entries to anon;
grant select, insert, update, delete    on public.atlas_entries to authenticated;
grant all                               on public.atlas_entries to service_role;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.atlas_entries enable row level security;

-- (1) Public: only active rows
create policy "atlas_entries public read active"
  on public.atlas_entries for select
  using (status = 'active');

-- (2) Owner: read own rows regardless of status
create policy "atlas_entries owner read own"
  on public.atlas_entries for select to authenticated
  using (owner_user_id = auth.uid());

-- (3) Owner: insert their own client_submitted row, must start pending_review
create policy "atlas_entries owner insert own pending"
  on public.atlas_entries for insert to authenticated
  with check (
    owner_user_id = auth.uid()
    and kind = 'client_submitted'
    and status = 'pending_review'
  );

-- (4) Owner: update their own client_submitted row ONLY while not currently active,
--     and the resulting row must be pending_review (no self-approve, no editing live).
create policy "atlas_entries owner update own non-active"
  on public.atlas_entries for update to authenticated
  using (
    owner_user_id = auth.uid()
    and kind = 'client_submitted'
    and status in ('pending_review','inactive','rejected')
  )
  with check (
    owner_user_id = auth.uid()
    and kind = 'client_submitted'
    and status = 'pending_review'
  );

-- (5) Admin: full control
create policy "atlas_entries admin all"
  on public.atlas_entries for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- (6) Service role: full control
create policy "atlas_entries service role all"
  on public.atlas_entries for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── Owner withdraw RPC (security definer) ───────────────────────────────────
create or replace function public.atlas_entry_owner_withdraw(_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.atlas_entries
     set status = 'pending_review',
         reviewed_at = null,
         reviewed_by = null
   where id = _id
     and owner_user_id = auth.uid()
     and kind = 'client_submitted'
     and status = 'active';
end
$$;
revoke all on function public.atlas_entry_owner_withdraw(uuid) from public;
grant execute on function public.atlas_entry_owner_withdraw(uuid) to authenticated;

-- ── updated_at trigger ─────────────────────────────────────────────────────
create trigger atlas_entries_set_updated_at
before update on public.atlas_entries
for each row execute function public.update_updated_at_column();