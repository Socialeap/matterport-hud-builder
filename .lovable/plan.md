# /agents MSP Directory — UX + Capture-Service updates

Four coordinated changes to the Directory section on `/agents` and the related capture-service catalog used by MSPs in their dashboard listing.

## 1. Rewrite the Directory intro (single paragraph, bold CTA)

In `src/routes/agents.tsx`, replace the current two-block intro (`MSP Directory` heading + `Live Directory launching soon` block, lines ~590–603) with a single explanatory paragraph that:

- Keeps the `MSP Directory` H2.
- Replaces the two helper paragraphs with one consolidated paragraph that makes clear:
  - The live directory of Pro Partners is launching soon (direct listings coming).
  - **In bold:** visitors can right now select the services and location they're interested in — and we'll notify them the moment a fitting Pro Partner is matched in their area.
  - The cards shown below are sample studios for demonstration of how filtering will work.

## 2. Move the "Notify me…" CTA to the top of the Directory container

Currently the `Notify me when a Pro Partner is live in my area` collapsible lives inside `DemoPreview` (under the sample cards). Move it so it sits at the very top of the Directory `Card` body, above the filter rail / results grid, so it is the first thing a visitor sees inside the Directory container. Remove it from `DemoPreview` so it isn't duplicated.

It should:
- Be a collapsible panel (kept closed by default) labeled "Notify me when a Pro Partner is live in my area".
- Be visually prominent (border + cyan accent, matching current style).
- Remain accessible regardless of whether the visitor has searched yet.

## 3. Drop redundant City / State / ZIP fields from the Notify form

The Directory's search rail already captures City+State or ZIP. Asking again in the BeaconForm is redundant.

Approach:
- Add an optional prop `hideLocationFields?: boolean` to `BeaconForm` (`src/components/marketplace/BeaconForm.tsx`).
- When `true`, the City / State / ZIP inputs are not rendered. The component still submits the `city`, `region`, `zip` it received via `defaultCity` / `defaultRegion` / `defaultZip` (no UI, same payload).
- Skip the city/state validation when `hideLocationFields` is true; instead require that `defaultCity` (or `defaultZip`) is non-empty before submit. If missing, show an inline prompt: "Enter a city or ZIP in the search above so we know where to watch for Pro Partners," and disable submit.
- In `DirectorySection`, lift the current `city`/`region`/`zip` state into the relocated Notify panel via props so the BeaconForm always reflects the visitor's current search values live.
- Keep the existing BeaconForm behavior unchanged elsewhere (the no-results panel and any other callers continue to render the full form by default).

## 4. Add "Walk-through Video Clips" to On-Site Scanning

This is a new value across the enum, the agents-page filter list, and the MSP's dashboard listing checklist.

- **DB migration**: add `'scan-walkthrough-video-clips'` to the `marketplace_specialty` Postgres enum (`ALTER TYPE public.marketplace_specialty ADD VALUE IF NOT EXISTS 'scan-walkthrough-video-clips';`). After the migration runs, `src/integrations/supabase/types.ts` will regenerate to include it.
- **Agents page** (`src/routes/agents.tsx`): append to `SCANNING_FILTERS` with a fitting `lucide-react` icon (e.g. `Film` or `Clapperboard`), label `Walk-through Video Clips`.
- **MSP dashboard** (`src/routes/_authenticated.dashboard.branding.tsx`): append the same value to `SPECIALTY_OPTIONS` with `group: "scanning"`, `proOnly: false` so MSPs can check it off in the capture-services list they expose to the marketplace Directory.
- Verify the existing `SPECIALTY_LABEL` map (built from `SCANNING_FILTERS` + `STUDIO_FILTERS`) and the `MSPCard` specialty-icon strip pick up the new entry automatically (they will, since both iterate the same arrays).

## Technical notes

- Enum extension uses `ADD VALUE IF NOT EXISTS` so the migration is idempotent. No data backfill required (existing rows are unaffected).
- `BeaconForm`'s ZIP/state regex stays in place; the new `hideLocationFields` branch simply bypasses the inputs and validates that `defaultCity || defaultZip` is set before invoking `capture-beacon`.
- No changes are needed to the `capture-beacon` edge function — the payload shape is unchanged.
- No new components added; everything is in the two route files plus `BeaconForm.tsx` plus one migration.

## Files touched

- `supabase/migrations/<new>.sql` — add enum value.
- `src/components/marketplace/BeaconForm.tsx` — add `hideLocationFields` prop and conditional rendering/validation.
- `src/routes/agents.tsx` — rewrite Directory intro, relocate Notify panel into the Directory container above the rail/results, lift search state to feed BeaconForm, add `scan-walkthrough-video-clips` to `SCANNING_FILTERS`, remove the Notify panel from `DemoPreview`.
- `src/routes/_authenticated.dashboard.branding.tsx` — add `scan-walkthrough-video-clips` to `SPECIALTY_OPTIONS` (scanning group).
