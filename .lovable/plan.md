## Diagnosis

The `/agents` directory grid is empty because **no `branding_settings` rows have `is_directory_public = TRUE`**. Confirmed via direct DB query:

```
SELECT count(*) FROM branding_settings;                       -- 2 (real users only)
SELECT count(*) FROM branding_settings WHERE is_directory_public = TRUE;  -- 0
```

The two existing rows (`Transcendence Media`, `FBIIB`) are real provider accounts and both have `is_directory_public = FALSE`.

The page calls `supabase.rpc("search_msp_directory", {})`, which is a `SECURITY DEFINER` `STABLE` SQL function that does:

```sql
SELECT … FROM branding_settings
WHERE is_directory_public = TRUE AND primary_city IS NOT NULL …
```

So the network request returns `[]` (matches the captured `POST /rest/v1/rpc/search_msp_directory → []` in the network log) and the grid renders empty. Filtering by On-Site / Studio Presentation services is purely client-side (`filtered = results.filter(m => specialties.includes(s))`) — it has nothing to filter because `results` is `[]`.

### Why is the table empty?

The mock-MSP seed file exists (`supabase/migrations/20260509210000_seed_mock_msps.sql`, 362 lines, 8 studios across Atlanta/SD/Chicago/Austin/Denver/Boston) but was never applied. Confirmed against the migration ledger — versions jump from `20260509154555` straight to `20260510000840`, skipping `20260509200000`/`200010`/`200020` (work-order trio, since recovered through later resubmissions) and `20260509210000` (the seed). The seed file was authored on disk without going through the migration tool, so the runner never picked it up.

The work-order tables (`work_orders`, `work_order_invites`, `work_order_ratings`) exist now, so only the seed remains outstanding.

## Plan

### Step 1 — Re-issue the seed as a fresh migration (single tool call)

Invoke `supabase--migration` with the **entire body** of `20260509210000_seed_mock_msps.sql` (already idempotent: `ON CONFLICT (id|provider_id|user_id,role|provider_id) DO UPDATE/NOTHING`, `DELETE FROM licenses` before insert, `cleanup_seed_msps()` at the end). This inserts:

- 8 `auth.users` rows (tagged `raw_app_meta_data->>'seed_source' = 'mock-msp-v1'`) + matching `auth.identities` so personas are loginable
- 8 `profiles`, 8 `user_roles` (provider), 8 `branding_settings` (with `is_directory_public = TRUE`, full `specialties[]`, lat/lng, `service_zips[]`, tier)
- 8 `licenses` (active) and 8 `provider_responsiveness` rows (standing scores 0.85 → 1.50)

The `branding_settings.provider_id → auth.users.id` FK forces the `auth.users` insert path; the migration tool runs with privileges sufficient for that (the same path `handle_new_user` already uses for trigger-based inserts).

**Fallback if the migration tool's role rejects the `auth.*` writes** (only used if Step 1 errors): submit a slimmer follow-up migration that drops the FK to `auth.users` for the seeded UUIDs by inserting them through a `SECURITY DEFINER` helper, but ONLY if the primary path fails. Do not preemptively split — the existing file is the canonical, idempotent shape and matches every downstream RPC's expectations (`provider_has_paid_access`, `_provider_can_receive_leads`, work-order matching).

### Step 2 — Verify

After the migration applies, run three probes via `supabase--read_query`:

```sql
SELECT count(*) FROM branding_settings WHERE is_directory_public = TRUE;
                                                                    -- expect 8
SELECT brand_name, primary_city, region, tier, array_length(specialties,1)
  FROM branding_settings WHERE is_directory_public = TRUE
  ORDER BY tier, brand_name;                                          -- expect 8 cards, mix of pro/starter
SELECT * FROM search_msp_directory();                                  -- expect 8 rows, Pros first
```

Then reload `/agents` in the preview and confirm:
- Directory grid renders 8 cards on initial load (the on-mount `search_msp_directory({})` call now returns rows).
- Selecting any On-Site or Studio service in the filter rail narrows the grid (client-side `Array.every(specialty)`), and clearing returns to 8.
- Searching `Atlanta` / `GA` returns 3 cards (Skyline, Peachtree, Sweetwater); ZIP `30303` returns the two MSPs that include it in `service_zips[]`.

### Step 3 — No application-code edits required

Tracing the dependency graph end-to-end:

- **`agents.tsx` mount path**: `useEffect → supabase.rpc("search_msp_directory", {}) → setResults(data)` — only data was missing; nothing to change.
- **Filter path**: `filtered = useMemo(results.filter(specialties.every))` — already correct; the seed assigns 8–11 specialties per MSP across both `scan-*` (On-Site) and `vault-*`/`ai-*` (Studio Presentation) families, so every filter chip will produce non-empty narrowing.
- **Search path**: `handleSearch → search_msp_directory({p_city|p_zip}) → client-side region filter` — already correct; seeded `primary_city` + `service_zips[]` cover all six cities.
- **Card link path**: each card links to `buildStudioUrl(slug)`; seeded `slug`s are unique and route resolution is unaffected.
- **No RLS changes**: `search_msp_directory` is `SECURITY DEFINER` and bypasses RLS; existing anon/auth policies on `branding_settings` (`Anyone can view branding by slug`, `Providers can view their own branding`) are not relied on by the directory grid.
- **No regression risk for real users**: the seed is fully namespaced under `seed_source = 'mock-msp-v1'`; the `cleanup_seed_msps()` helper (created by the same migration) gives a single-call teardown that cascades through `auth.users`'s ON DELETE CASCADE chain — no real-user rows touched.

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Migration tool rejects `auth.users` direct insert | Fall back to FK-relaxed variant (Step 1 fallback). Only triggered on actual error. |
| `handle_new_user` trigger races and inserts a partial profile during the seed loop | Seed uses `INSERT … ON CONFLICT (user_id) DO UPDATE` on `profiles`, so the trigger row is harmlessly overwritten with the seed's `display_name`. |
| Repeat seed runs duplicate cards | Every insert is `ON CONFLICT DO UPDATE/NOTHING`; `licenses` uses `DELETE … WHERE user_id = v_uid` first. Re-runs are idempotent. |
| Tester accidentally signs in as a mock MSP | Documented inside the migration header (shared password `SeedPass!2026`); cleanup helper is one call away. |
