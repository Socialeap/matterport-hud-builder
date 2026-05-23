## Why navigation is going to the wrong place

I queried Matterport's GraphQL against the live test model and confirmed three real bugs in the current enrichment:

1. **We ignore Matterport's own tag→sweep association.** The `Mattertag` type exposes `scanLinks { scan { id } }` — this is the authoritative list of sweeps from which a tag is intended to be viewed (set by whoever placed the tag). The current edge function never asks for it and instead always falls back to "nearest sweep by 3D Euclidean distance."
2. **Nearest-neighbor ignores walls and floors.** A tag sits on a wall (or even on a ceiling/exterior facade). The geometrically nearest sweep can easily be on the *other side* of that wall, in a different room, or on a different floor. We also never constrain by `floor.id`, even though both `Mattertag.floor` and `AnchorLocation.floor` are queryable.
3. **We never set camera rotation.** Even when the sweep is right, the camera lands facing whatever direction Matterport chose by default — often away from the feature the card is highlighting. `Mattertag.stemNormal` gives us the wall-outward vector, which we can invert into a `&sr=<pan>,<tilt>` so the camera looks *at* the tag on arrival.

I also need to confirm one Matterport URL convention in build mode: whether `&ss=` accepts the long GraphQL location id (`d2iqi1huu5imciwaad0xz1cqb`) or only the short scan sid. If it's the latter, we need to switch the field we read.

## Fix

### 1. Enrich tags with the right sweep (edge function)

In `supabase/functions/fetch-mattertags/index.ts`:

- Expand the Mattertag query to also fetch `floor { id }`, `stemNormal { x y z }`, `stemLength`, and `scanLinks { scan { id } }`.
- Expand the sweeps query to also fetch `floor { id }`.
- New picker logic per tag, in priority order:
  1. If `scanLinks` is non-empty → use the first scan whose id resolves in the sweeps list; if multiple, pick the one closest to `anchorPosition`. (This is Matterport's own answer — should fix most cases immediately.)
  2. Otherwise → nearest sweep **on the same floor** as the tag, measured in the floor plane (ignore the vertical axis so a wall-mounted tag at z≈0 isn't biased toward sweeps directly below it).
  3. Fallback to current 3D nearest only if floor data is missing.
- Compute `sr` (pan, tilt in radians) from `stemNormal` pointed back at the sweep, and attach it alongside `ss`.

### 2. Preserve `ss` + `sr` end-to-end

- `MattertagData` / `PropertyMattertagData` / `SavePresentationMattertag` already carry optional `ss`/`sr` from the previous change — verify the sanitizer in `src/lib/portal.functions.ts` keeps `sr` when present (current code does, but double-check after the picker changes).
- `buildMattertagDeepLink` already prefers `ss` and appends `sr`. No change unless URL-format testing in step 4 forces it.

### 3. Diagnostic mode (this is what answers "how can we ascertain the location is correct?")

Two complementary tools so you can verify *every* card before shipping:

- **Edge-function debug response**: add an optional `{ debug: true }` flag to `fetch-mattertags`. When set, each returned tag includes `{ anchorPosition, pickedSweep: { id, position, floorId }, distance, source: 'scanLink' | 'sameFloorNearest' | 'fallback' }`. Lets us curl the endpoint after re-import and spot-check.
- **Builder-side preview link**: in the Property Features card admin UI, render a small "Test jump" button next to each tag that opens the generated `?m=…&ss=…&sr=…` URL in a new tab. Lets a non-technical user visually confirm each card lands correctly without exporting.

### 4. Verify Matterport URL parameter format

Before deploying, in build mode I will:
- Curl Matterport showcase with the long location id and confirm the camera teleports (e.g. `https://my.matterport.com/show/?m=SxQL3iGyoDo&ss=d2g67xm1m5mmigpyxib2myz6a`).
- If that form is rejected, swap to whichever sweep identifier the showcase JSON actually accepts (likely an `sid` field on `AnchorLocation` or `Scan` — there's a `Scan` type with its own `id` I can fall back to).

### 5. Re-import + spot check

Users must re-import mattertags for the new `ss` (and `sr`) to populate. After re-import on the Chaska Commons model, click through each feature card with the diagnostic preview link to confirm correct placement.

## Files touched

- `supabase/functions/fetch-mattertags/index.ts` — expanded queries, new picker, rotation computation, debug response.
- `src/lib/portal.functions.ts` — confirm sanitizer keeps `sr`; no logic change expected in `buildMattertagDeepLink`.
- `src/components/portal/` (whichever file renders the admin card list) — add per-card "Test jump" button.

## Out of scope

- No DB schema change (the `ss`/`sr` fields are already optional on existing types).
- No change to the runtime deep-link builder unless step 4 forces it.
- No client-side recomputation of nearest sweep — all enrichment stays in the edge function so the runtime HTML stays self-contained.
