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
