## Final plan — Atlas v1

All corrections applied: public-safe copy, six RLS policies documented, tightened owner update rules with auto-revert on edit, text + CHECK instead of enums, strict `presentation_url` validation, dynamic category chips.

## 1. Database — `atlas_entries` (additive migration)

`atlas_demo_listings` is empty in prod; we introduce `atlas_entries` cleanly and leave the old table untouched (drop deferred to a later cleanup PR).

File: `supabase/migrations/<ts>_atlas_entries.sql`

```sql
-- ── Helpers ─────────────────────────────────────────────────────────────────
-- Reuse existing public.update_updated_at_column() trigger function.

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

-- ── Auto-revert on owner edits to active rows ──────────────────────────────
-- If the owner re-submits/edits while the row is active, the row is revert-locked
-- by RLS (status='active' excluded from owner UPDATE). To let owners edit a live
-- listing, they call the server fn withdrawForEdit, which a SECURITY DEFINER
-- function flips active→pending_review under admin/service privileges:
create function public.atlas_entry_owner_withdraw(_id uuid)
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
```

Why text + CHECK instead of enums: Atlas categories and lifecycle states are expected to evolve quickly (e.g. `under_review`, `flagged`, new categories). Text + CHECK lets us amend with a single `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT …` migration; no enum-rebuild dance.

## 2. Public `/atlas` (dark Maps-style UX)

File: `src/routes/atlas.tsx` — rebuild on Leaflet, faithfully following the attached `index.html`.

- Top header (slate-900): blue square logo, "IMMERSIVE ATLAS" wordmark + "Platform Discovery Layer" pill, right-side live verified count + ecosystem caption.
- Left sidebar (`md:w-[420px]`, mobile drawer with toggle): search input, **category chips built from the union of active-listing categories** (always-present "All" first, then a chip per distinct `category` from the loader data, labels via `categoryLabel`), scrollable card deck.
- Right: full-bleed Leaflet map, CartoDB `dark_all` tiles, zoom top-right, custom pulsing pins (`active-pulse-pin` class ported to `src/styles.css`).
- Card content: kind badge (`Sample` for demo, `Verified Listing` for client_submitted), category pill, title, location row, summary, "Step Inside →" CTA. No rating block unless real rating data exists.
- Modal: matches attached `immersiveModal` (header pill, 16:9 iframe, "Open in new tab" fallback, close X). Iframe `sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"`, `referrerPolicy="no-referrer-when-downgrade"`. ≥6s without a `load` event → show "This space refused embedding — open in new tab" banner above the iframe. **No token in the URL.**
- Coordinate-less entries: sidebar only with a `Location pending` badge.
- Sidebar footer (replaces the old phrase): **"Active approved listings appear in Atlas. Inactive listings remain hidden until restored by an admin."**
- Data: new server fn `listActiveAtlasEntries` in `src/lib/atlas.functions.ts` → `select … where status='active' order by sort_order, created_at`.

## 3. Admin UI — `/admin/atlas`

Files:
- New: `src/routes/_authenticated.admin.atlas.tsx`
- Delete: `src/routes/_authenticated.admin.atlas-demo.tsx`
- Update any nav link from `/admin/atlas-demo` → `/admin/atlas` (grep first; admin index page).

Capabilities:
- Tabs: All, Pending review, Demo, Client, Inactive, Rejected.
- Table: #, Title, Kind, Status, Location, Presentation, Owner, Submitted, Actions.
- Row actions: Edit (form expanded with `kind`, `status`), Approve (status='active', `reviewed_*` set), Reject (requires `rejection_reason`), Deactivate/Reactivate, Delete.
- `presentation_url` validated client-side with the same Zod schema as the server fn (https only, trimmed, length ≤2048, blocks `javascript:` / `data:`).
- localStorage draft persistence preserved.

## 4. Client `/builder` Publish opt-in

Files:
- New: `src/lib/atlas.functions.ts` — `submitAtlasClientEntry`, `listMyAtlasEntries`, `withdrawForEdit` (calls `public.atlas_entry_owner_withdraw`), `deleteMyAtlasEntry`. All `requireSupabaseAuth` + Zod.
- Edited: `src/components/portal/PublishDistributeSection.tsx` — additive "List this tour on Frontiers3D Atlas" card under the existing distribution links.

Behavior:
- Inputs: published presentation URL (https, trimmed, ≤2048, blocks `javascript:` / `data:`), title (≤160), category, summary (≤600), city, region, country, lat (-90..90), lng (-180..180), tags. `saved_model_id` auto-attached when available on the builder page.
- Submit → server fn validates (Zod, identical to admin), upserts on the partial unique indexes, sets `kind='client_submitted'`, `status='pending_review'`, `submitted_at=now()`.
- Listing only appears on `/atlas` when admin sets `status='active'`.
- Re-submitting while `pending_review`/`inactive`/`rejected` keeps the row owner-editable (RLS policy 4) and resets `status` to `pending_review`.
- If the row is currently `active`, the card shows a "Withdraw to edit" button → calls `withdrawForEdit` (security-definer RPC) → flips to `pending_review` and reopens the form.
- Status badges in the card: `Pending review`, `Active on Atlas`, `Inactive`, `Rejected — <reason>`.
- Users may have multiple listings (one per saved_model or per distinct URL).

## 5. Shared Zod schema

In `src/lib/atlas.functions.ts`:

```ts
const URL_RE = /^https:\/\/[^\s]+$/i;
const FORBIDDEN_URL_RE = /^(javascript|data|vbscript):/i;

export const atlasEntryInput = z.object({
  title:            z.string().trim().min(1).max(160),
  summary:          z.string().trim().max(600).optional().or(z.literal('')),
  category:         z.string().trim().min(1).max(40),
  tags:             z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  hero_image_url:   z.string().trim().regex(URL_RE).max(2048).optional().or(z.literal('')),
  presentation_url: z.string().trim().regex(URL_RE).max(2048)
                      .refine((u) => !FORBIDDEN_URL_RE.test(u), 'Invalid URL scheme'),
  address:          z.string().trim().max(200).optional().or(z.literal('')),
  city:             z.string().trim().max(120).optional().or(z.literal('')),
  region:           z.string().trim().max(120).optional().or(z.literal('')),
  country:          z.string().trim().max(2).default('US'),
  latitude:         z.number().min(-90).max(90).nullable().optional(),
  longitude:        z.number().min(-180).max(180).nullable().optional(),
  saved_model_id:   z.string().uuid().nullable().optional(),
});
```

The admin form reuses the same schema (extended with `kind` + `status` for admin-only fields).

## 6. Files touched (final list)

Created:
- `supabase/migrations/<ts>_atlas_entries.sql`
- `src/lib/atlas.functions.ts`
- `src/routes/_authenticated.admin.atlas.tsx`

Edited:
- `src/routes/atlas.tsx`
- `src/lib/atlas-demo-data.ts` (add `AtlasEntry` type + `AtlasEntryKind` / `AtlasEntryStatus` string unions; retain `CATEGORY_LABELS` / `categoryLabel`)
- `src/components/portal/PublishDistributeSection.tsx` (additive Atlas opt-in card)
- `src/styles.css` (pulsing-pin keyframes, dark Leaflet overrides under `@layer components`)
- `src/integrations/supabase/types.ts` (auto-regenerated after migration)
- `src/routes/_authenticated.admin.index.tsx` (nav link `/admin/atlas-demo` → `/admin/atlas`, if present)
- `BACKEND_ACTIVATION.md` (append "Atlas v1 — atlas_entries")
- `package.json` (`leaflet`, `@types/leaflet`)

Deleted:
- `src/lib/atlas-demo.functions.ts`
- `src/routes/_authenticated.admin.atlas-demo.tsx`

Untouched (out of scope): Map Oracle, beacons, billing/Stripe, Track A, B4, prospect emails, sponsored placement, URL verification crawler.

## 7. Backend Activation Required: YES

Activation file: `BACKEND_ACTIVATION.md` (append section "Atlas v1 — atlas_entries").

Required actions:
- Apply `<ts>_atlas_entries.sql` (creates `atlas_entries` with text + CHECK kind/status, four indexes, **six RLS policies**, GRANTs, owner-withdraw security-definer function, updated_at trigger).
- No data backfill (table starts empty; admin creates demo entries via `/admin/atlas`).
- No secrets, no edge functions, no cron.

Verification SQL:

```sql
-- 1. Columns
select column_name, data_type
  from information_schema.columns
 where table_schema='public' and table_name='atlas_entries'
 order by ordinal_position;

-- 2. CHECK constraints (kind/status/url, etc.)
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.atlas_entries'::regclass and contype='c'
 order by conname;

-- 3. The six RLS policies
select polname from pg_policy
 where polrelid = 'public.atlas_entries'::regclass
 order by polname;
-- Expect 6 rows:
--   atlas_entries admin all
--   atlas_entries owner insert own pending
--   atlas_entries owner read own
--   atlas_entries owner update own non-active
--   atlas_entries public read active
--   atlas_entries service role all

-- 4. Public anonymous read shows only active rows
set role anon;
select id, title, kind, status from public.atlas_entries where is_active;
reset role;

-- 5. Owner-withdraw RPC exists and is executable by authenticated
select proname, prosecdef from pg_proc where proname='atlas_entry_owner_withdraw';
```

Expected result:
- `atlas_entries` exists with all migration columns; `is_active` is a generated stored column.
- CHECK constraints present for `kind`, `status`, `title`, `summary`, `category`, `latitude`, `longitude`, `presentation_url`, `hero_image_url`, `rejection_reason`.
- Exactly **six** RLS policies listed above.
- Anon read returns only `status='active'` rows.
- `atlas_entry_owner_withdraw` exists with `prosecdef = true`.

Future status/category additions: when adding new values to `kind` or `status`, ship a migration that drops and re-adds the relevant CHECK constraint (text + CHECK chosen specifically to make this cheap; no enum rebuild required).

No destructive SQL. `atlas_demo_listings` is intentionally left in place (empty, unreferenced after this PR) — cleanup deferred to a separate PR.
