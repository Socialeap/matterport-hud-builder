

## Why it still looks like the dashboard

Three layered problems compounding visually:

1. **Container is too narrow.** Both `/dashboard/demo` (right column) and `/p/$slug/demo` wrap `HudPreview` in `max-w-7xl` + padding. Result: same boxed iframe at the same width on both pages.
2. **Redundant brand chrome.** `HudPreview` already renders its own brand header *inside* the iframe overlay (logo + brand name + Contact button). The public demo page then renders **another** brand header bar above it ("brand logo" + "● Live" pill) plus an "A Live 3D Property Presentation by {brandName}" label. Three pieces of identical branding stacked = looks like the same page with extra noise.
3. **Aspect-video iframe.** `HudPreview` wraps the Matterport iframe in `aspect-video`, so on a wide monitor the tour is letterboxed inside an already-narrow card. A "full width display" requires a full-viewport HUD.

## Fix — true public presentation page

Restructure `/p/$slug/demo` into a **full-bleed cinematic viewer**. Three deliberate departures from the dashboard preview:

### A. Full-viewport HUD (no max-width, no aspect-video card)
- Outer wrapper becomes `h-screen w-screen` (or `min-h-dvh`), no `max-w-*`, no `mx-auto`.
- Render the Matterport iframe at full viewport (`fixed inset-0` behind everything else, or `flex-1` in a column layout). The 3D tour fills the screen edge-to-edge — that alone makes it feel like a real "live presentation" vs. a dashboard widget.

### B. Use `HudPreview`'s built-in brand header — drop the duplicate page-level header
- Pass `defaultHeaderVisible={true}` (already done) so the in-iframe overlay header carries the brand. That overlay was *designed* for the published end-product look.
- Remove the page-level `<header>` with logo + "● Live" pill (lines 109–131 of `p.$slug.demo.tsx`).
- Remove the centered "A Live 3D Property Presentation by {brandName}" label block (lines 141–151) — `HudPreview`'s overlay already shows the brand, and it now sits over a full-viewport tour.

### C. Slim CTA strip at the bottom (not a giant card)
- Replace the bordered CTA card (lines 169–186) with a compact bottom-anchored strip: small "Powered by {brandName} — Want one like this? [Build Your Own →]" — fixed to bottom, semi-transparent over the iframe, dismissible with an X. Keeps the screen real-estate for the tour, still surfaces the conversion path.
- Hide entirely on Pro tier (whitelabel).

### D. New `HudPreview` prop: `fullViewport?: boolean`
- Currently `HudPreview` hardcodes `aspect-video` on the iframe wrapper (line 88). Add an optional `fullViewport` prop that switches to `h-full w-full` when true, so the dashboard's contained preview is unaffected.
- Default `false` → dashboard preview stays exactly as it is (no regression).
- Public demo page passes `fullViewport={true}`.
- Outer `HudPreview` wrapper also conditionally drops `rounded-lg border shadow-lg` when full-viewport (no card chrome on a full-screen view).

### E. Property tab strip stays — but moves to overlay
- Property selector (lines 68–85 of `HudPreview`) stays for multi-property demos but in `fullViewport` mode it overlays the iframe (top-left, glassmorphic) instead of pushing the iframe down. Same component, conditional positioning.

## Trace — ripple safety

| Touched | Used elsewhere? | Risk | Mitigation |
|---|---|---|---|
| `HudPreview` new `fullViewport` prop | Dashboard preview, published end-product (future) | Default false → zero behavior change for existing callers | Prop is opt-in; all current call sites unchanged |
| `HudPreview` iframe wrapper class | Same | Conditional class swap only when prop true | Default branch identical to today |
| `p.$slug.demo.tsx` layout | Only this route | None — isolated change | — |
| Brand overrides merge logic (lines 68–94) | Only this route | Keep as-is | Untouched |
| `getPublicDemoBySlug` server fn | This route + publish toggle check | Untouched | — |
| `defaultHeaderVisible={true}` already passed | — | — | — |
| URL builders / public-url.ts | All studio links | Untouched | — |
| Dashboard "View Live" URL block | — | Untouched | — |

Notes:
- The "No properties configured" + "No demo published yet" empty states keep the centered card layout (full-viewport doesn't apply when there's nothing to show).
- Error + notFound components unchanged.
- No DB, no schema, no server-fn changes.
- No changes to `HudBuilderSandbox`, `MediaCarouselModal`, `CinemaModal`, `NeighborhoodMapModal`, agent contact panel — they live inside `HudPreview` and inherit the larger canvas automatically.

## Files touched (2)

- `src/components/portal/HudPreview.tsx` — add `fullViewport?: boolean` prop; conditionally swap outer wrapper classes (drop card chrome) and iframe wrapper (drop aspect-video → h-full); conditionally absolute-position the property selector when full-viewport.
- `src/routes/p.$slug.demo.tsx` — restructure to full-viewport layout: remove page-level brand header, remove centered subtitle block, render `HudPreview` with `fullViewport={true}` filling the screen, replace bottom CTA card with slim dismissible bottom strip (hidden on Pro).

## Out of scope

- Dashboard right-column preview — stays exactly as today.
- Any change to publish/license/slug logic.
- Custom-domain routing — already handled by `buildDemoUrl`.
- Mobile-specific tweaks beyond Tailwind responsive defaults (full-viewport already works on mobile).

