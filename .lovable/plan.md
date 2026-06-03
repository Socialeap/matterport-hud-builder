## Goal

Add **Summary**, **Latitude**, and **Longitude** inputs to the "New curated listing job" form on `/admin/atlas-curation` (the Curated Atlas Listing Assistant), and wire them through to the same `atlas_curation_jobs` columns / `draft_payload` fields that the regular Atlas Listing form uses — so curators can seed these values upfront instead of only being able to edit them in the post-enrichment Review panel.

Today the create form only collects: Matterport URL, name, address, city, region, country, category override, rights note. The Review panel (after enrichment) already exposes Summary / Latitude / Longitude editors and the underlying DB columns exist — this is purely a "lift the fields to the top form and pass them through to the create server fn" change.

## Scope

Frontend + the `createCurationJob` server function only. No DB schema change, no UI changes to the Review panel, regular Atlas Listings form, or generation/publish pipeline.

## Changes

### 1. `src/routes/_authenticated.admin.atlas-curation.tsx` — create form UI

In the "New curated listing job" card (around lines 580–634):

- Add three controlled inputs alongside the existing ones:
  - `summary` — textarea, full-width, `maxLength={600}`, placeholder "Short marketing summary (optional — assistant will draft one if blank)".
  - `latitude` — text input, placeholder "-90 to 90 (optional)".
  - `longitude` — text input, placeholder "-180 to 180 (optional)".
- Add corresponding `useState` hooks at the top of the component next to `matterportUrl`, `name`, `address`, etc.
- Light client-side validation in `handleCreate`: if either lat or lng is filled, both must be filled and parse to numbers in range; otherwise toast an error and abort. Empty = "let the assistant resolve it" (current behavior).
- Pass the new values into the existing `createCurationJob({ data: ... })` call:
  - `summary: summary.trim()`
  - `latitude: <parsed number | null>`
  - `longitude: <parsed number | null>`
- Include the three new state setters in `resetCreate()` so the Clear button still works.

### 2. `src/lib/atlas-curation.functions.ts` — extend `createCurationJob`

Extend the `createInput` zod schema (around lines 84–93) with three optional fields:

```ts
summary: z.string().trim().max(600).optional().default(""),
latitude: z.number().min(-90).max(90).nullable().optional(),
longitude: z.number().min(-180).max(180).nullable().optional(),
```

In the handler (around lines 98–207):

- After the existing Places + city-level resolution block, if `data.latitude != null && data.longitude != null`, override `latitude`/`longitude` with the user-supplied values and set `confidence = "manual"`. This matches how the Review panel's `updateCurationJob` already handles manual coord entry (see lines 341–349).
- After `buildDraft(...)`, if `data.summary` is non-empty, replace `draft.summary` with it (trimmed, max 600). This keeps the draft and `drafted_summary` column in sync — the regular flow already mirrors `draft.summary → drafted_summary` and `draft → draft_payload` on insert (lines 202, 205).
- Because the user may now supply coordinates directly, recompute the post-resolution status block so that user-supplied coords are sufficient to move the job to `ready_for_review` (currently `blocked` when Places + city-level both fail). Mirror the existing logic that already treats any non-null lat/lng as enough.

No other server fns change. `updateCurationJob`, `createAtlasEntryFromJob`, `generatePackage`, and the publish/merge/deploy pipeline already read from `draft_payload` / the `latitude`/`longitude`/`drafted_summary` columns, so the seeded values flow into the generated package and the eventual Atlas entry with no further wiring.

## Out of scope

- `src/lib/atlas-curation-server.ts`, `atlas-live-tour.ts`, `atlas-showcase-publish.ts`, the Review panel JSX, the regular Atlas Listings admin page, RLS, migrations, generated end-product HTML.
- Backfilling existing jobs.

## Verification

1. Open `/admin/atlas-curation`, fill the create form with a valid Matterport URL plus an explicit Summary, Latitude, and Longitude. Submit.
2. The new job appears with status `ready_for_review`, the Coords column shows the green "yes" pin, and clicking Review shows the typed Summary / Latitude / Longitude already populated in the editable draft.
3. Submit again with Summary + lat/lng left blank → behavior is identical to today (Places/city-level resolution runs; `blocked` only if no coords could be resolved).
4. Submit with only one of lat/lng filled → client toast error, no server call.
5. Submit with lat=200 → client toast error, no server call.
6. Generate package on the seeded job → the downloaded showcase shows the typed summary and the map pin uses the typed coordinates.

## Backend Activation Required: NO

Reason: All target columns already exist on `atlas_curation_jobs` (`latitude`, `longitude`, `drafted_summary`, `draft_payload`). This is a frontend + server-function change only.