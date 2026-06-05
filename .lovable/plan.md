# Smart Map Pin Tooltips on /atlas

Add hover tooltips to map pins on `src/routes/atlas.tsx` that show the listing title + category, but only when the pin isn't visually clustered with other pins at the current zoom level. Use Leaflet's native tooltip + event APIs so the map never re-renders through React.

## Scope

- `src/routes/atlas.tsx` — extend the existing marker creation loop.
- `src/styles.css` — add `.atlas-pin-tooltip` styles matching the dark theme.

No data, no schema, no routing, no backend changes.

## Implementation

### 1. `src/routes/atlas.tsx` — marker mouse handlers

Inside the existing `pinned.forEach(...)` block in the markers `useEffect` (right after `marker.on("click", ...)`), attach two more Leaflet listeners — no React state, no new components:

```ts
marker.on("mouseover", () => {
  const map = refs.map;
  const currentPoint = map.latLngToContainerPoint(marker.getLatLng());

  let isOverlapped = false;
  for (const [id, otherMarker] of refs.markers.entries()) {
    if (id === entry.id) continue;
    const otherPoint = map.latLngToContainerPoint(otherMarker.getLatLng());
    if (currentPoint.distanceTo(otherPoint) < 30) {
      isOverlapped = true;
      break;
    }
  }
  if (isOverlapped) return;

  const safeTitle = escapeHtml(entry.title);
  const safeCategory = escapeHtml(categoryLabel(entry.category));
  marker
    .bindTooltip(
      `<div class="atlas-tooltip-content">
         <strong class="atlas-tooltip-title">${safeTitle}</strong>
         <span class="atlas-tooltip-cat">${safeCategory}</span>
       </div>`,
      {
        className: "atlas-pin-tooltip",
        direction: "top",
        offset: [0, -12],
        opacity: 1,
      },
    )
    .openTooltip();
});

marker.on("mouseout", () => {
  marker.unbindTooltip();
});
```

A tiny local `escapeHtml` helper (in the same file) will sanitize `title` / category before they go into the tooltip HTML string — listing titles are user/admin-curated text and we're injecting into innerHTML.

### 2. `src/styles.css` — tooltip styling

Add a dark-theme override for the `atlas-pin-tooltip` class so Leaflet's default white box is gone:

- transparent → solid dark surface (e.g. `oklch` token consistent with the rest of the Atlas shell)
- subtle border, soft shadow, small radius
- title: white, ~13px, semibold
- category: muted slate (~`#94a3b8` equivalent token), ~11px, uppercase tracking optional
- hide `.leaflet-tooltip-tip` arrow color so it matches the dark surface (or recolor it)
- `pointer-events: none` (Leaflet default, but reaffirm) so it never intercepts pin hover

### 3. Guarantees from the spec

- ✅ No `useState` / no React re-render on hover.
- ✅ Overlap measured in **screen pixels** at the current zoom (recomputed every mouseover).
- ✅ 30px threshold for the 24×24 pulse icon.
- ✅ Cleanup via `unbindTooltip()` on mouseout — no DOM leaks.
- ✅ Existing click → preview card behavior is untouched.

## Out of scope

- No clustering plugin.
- No changes to the floating preview card, sidebar, or modal.
- No changes to `ListingCard` hover/select logic.

## Verification

- Hover an isolated pin → tooltip appears above with title + category in dark style.
- Zoom out until pins visually cluster → hovering a clustered pin shows **no** tooltip.
- Zoom back in until the same pin is isolated → tooltip reappears on hover.
- Click behavior (preview card + sidebar scroll) still works unchanged.
- No console errors; no React re-renders triggered by hover (verifiable via React DevTools profiler if desired).

Backend Activation Required: NO
Reason: Frontend-only UI enhancement on `/atlas`; no Supabase, RLS, functions, or schema changes.
