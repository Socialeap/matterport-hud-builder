## Plan

All changes target `src/components/portal/HudPreview.tsx` (Builder Preview) and `src/lib/portal.functions.ts` (the generated standalone HTML). Both surfaces will end up with the same HUD layout.

### 1. Property selector — labels use Name, not address

Today the Builder Preview renders properties as tabs above the iframe and labels each tab with `m.name` (the address field). The generated HTML already prefers `propertyName`. Align the Builder to the same rule.

In `HudPreview.tsx`, replace the tab label expression with the same `propLabel` logic used in the generated HTML:
```
label = (m.propertyName?.trim() || m.name?.trim() || `Property ${i+1}`)
```

### 2. Move the property selector into the HUD header (Preview + Generated)

**Preview (`HudPreview.tsx`)** — remove the standalone tabs row (lines ~429–454) and add a compact dropdown inside the existing HUD header (`<div className="flex items-center gap-2 mr-8">`, line ~545) so it sits on the same row as the Map / Cinema / Media / Ask / Live Tour / Contact buttons. Use a shadcn `Popover` (already imported) or a lightweight native `<select>` styled to match the existing glass buttons. The selector renders only when `models.length > 1`. The header row uses `flex flex-wrap items-center gap-2` so the controls reflow responsively across screen widths; the brand block on the left keeps `min-w-0` + `truncate` so it shrinks gracefully.

**Generated HTML (`portal.functions.ts`)** — the dropdown already exists (`#hud-prop-switch` inside `#hud-right` is the goal). Currently it's placed in `#hud-left-spacer` (lines 1482–1490). Move that block into `#hud-right` (line 1496) so it sits on the same row as Sound / Map / Cinema / Media / Ask / Live Tour / Contact. Update the `#hud-inner` CSS so the right group uses `flex-wrap` and reasonable `gap` for responsive spacing on narrow viewports. Tighten `#hud-prop-trigger` max-width so it doesn't dominate the row. No JS changes needed — the existing `setPropTrigger` / `propLabel` already prefer `propertyName`.

### 3. Remove the "Powered by Transcendence Media" footer

- `HudPreview.tsx` lines 805–810: delete the `{!isPro && !fullViewport && …}` footer block.
- `portal.functions.ts` lines 1088–1090: replace `poweredByFooter` with `""` unconditionally (and remove the related `#powered-by` CSS rules if present, leaving the variable untouched is fine since it now always emits empty string). Quick `rg "powered-by"` confirms there are no other consumers that would break.

### 4. Preview matches Generated HTML

The combination of (1) + (2) + (3) gives the Builder Preview the same single-row HUD header (logo / brand / property dropdown / icon buttons / Ask / Live Tour / Contact) and no footer that the downloaded standalone HTML produces. After the edits, do a side-by-side check of `/p/{slug}/builder` vs the exported file with the second screenshot as the reference layout.

### Ripple-check

- `propertyName` is already on `PropertyModel` (`src/components/portal/types.ts`) and surfaced in the Builder's `PropertyModelsSection`, so the new label has data to read; older models without `propertyName` fall back to `name` so nothing breaks.
- Tab styling/handlers (`onSelectModel`, `accentColor` highlight) are preserved in the new dropdown.
- The bookmark "above" block (`aboveBookmarkBlock`) and the Builder's bookmark/guided-paste flows live outside the removed tabs row, so they remain unchanged.
- `MediaCarouselModal`, `CinemaModal`, `NeighborhoodMapModal` calls at the bottom of `HudPreview.tsx` are untouched.
- Generated HTML: `propMenuEl`, `propTriggerEl`, `propCurrentEl` lookups are by `id`, so moving the markup between flex containers does not affect the runtime JS or the existing Live Tour / Ask / mute wiring.
- No SSR, route, or server-fn surface is touched.
