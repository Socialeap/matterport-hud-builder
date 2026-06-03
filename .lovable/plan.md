## Problem

In the generated curated showcase `index.html`, the annotation toolbar (Pointer / Draw / color / Focus Rope / Clear / ×) is absolutely positioned at `top: 14px` inside `#anno-letterbox-wrap`, which sits over the Matterport iframe. Once an Explore Together session activates, the toolbar overlays the top center of the 3D tour and blocks Matterport's own controls (visible in the attached screenshot).

The black area above the tour in the screenshot is the page header (`.f3d-bar`) plus the letterbox gap when 16:9 engages — the natural place to host the toolbar.

## Fix (single file: `src/lib/atlas-live-tour.ts`)

1. **Extract the toolbar from the stage overlay.** Remove the `<div id="anno-toolbar">…</div>` block from `STAGE_OVERLAY_HTML` (lines 218–241). Keep `#lt-navlock`, `#anno-canvas`, and `#remote-pointer` inside the stage — those must remain aligned to the iframe.

2. **Expose the toolbar as a new render slot.** Add a new constant `TOOLBAR_HTML` containing the same `<div id="anno-toolbar" role="toolbar" …>…</div>` markup (no changes to button IDs, data attributes, or order — the runtime in `atlas-live-tour-runtime.mjs` queries by `#anno-toolbar`, `.anno-tool-btn[data-tool=…]`, `#anno-color-select`, `#anno-shape-select`, `#anno-rope-btn`, `#anno-clear-btn`, `#anno-exit-btn`, so the DOM contract is preserved). Return it from `renderAtlasLiveTour` as a new field, e.g. `toolbarHtml`.

3. **Restyle the toolbar as a header strip** (replace the existing `#anno-toolbar` rule near line 112):
   - Remove `position:absolute; left:50%; top:14px; transform:translateX(-50%); z-index:10; box-shadow:…`.
   - Make it a full-width flex bar: `display:none; justify-content:center; align-items:center; gap:6px; padding:8px 12px; background:rgba(10,12,20,0.92); border-bottom:1px solid rgba(255,255,255,0.08); flex-wrap:wrap;` and keep the existing `body.live-tour-active #anno-toolbar{display:flex}` rule so it only appears during a live session.
   - No changes to `.anno-tool-btn`, `.anno-color-wrap`, `.anno-rope-group`, `.anno-shape-wrap`, `.anno-exit-btn` styles.

4. **Place the toolbar in the curated HTML** (`src/lib/atlas-curation-server.ts`, `renderCuratedHtml`): render `${liveTour.toolbarHtml}` immediately after the closing `</header>` and before `<main class="f3d-stage">`. This puts it in the black band directly above the iframe — exactly where the screenshot annotation points — and it stays hidden until `body.live-tour-active` flips on, so normal viewers see no extra chrome.

5. **Letterbox sizing already accounts for the header** via `calc((100vh - 52px) * 16 / 9)`. With the toolbar inserted between header and stage, bump that subtracted height to roughly `100px` (52px header + ~48px toolbar) so the 16:9 frame doesn't push the bottom of the iframe off-screen when annotation mode is active. Only this one constant in the `body.live-tour-active #anno-letterbox-wrap` rule changes.

## Out of scope

- No changes to `atlas-live-tour-runtime.mjs` (DOM IDs/classes preserved).
- No changes to publish/verify pipeline, `atlas-showcase-publish.ts`, `atlas-curation.functions.ts`, the admin route, or any backend.
- No visual/behavioral changes to the page when an Explore Together session is not active.
- No changes to Matterport embed URL, Share, About, or Claim controls.

## Verification

1. Generate a fresh Opera Gallery package from `/admin/atlas-curation` and open `index.html` locally (or via the existing Netlify deploy after merge).
2. Launch Explore Together as host → confirm:
   - Toolbar appears as a horizontal strip directly under the FRONTIERS3D header, not over the Matterport viewport.
   - Pointer / Draw / Color / Focus Rope / Shape / Clear / Exit all still function (runtime selectors unchanged).
   - Matterport's own bottom-left search and "Presented by" overlays are no longer occluded.
3. Confirm no toolbar is rendered before a session starts (static viewing of the tour is unchanged).
4. Republish via the existing flow; `verifyDeployedShowcase` should still 200 both URLs and assert manifest `service`/`kind` (no manifest changes).

## Backend Activation

**Backend Activation Required: NO** — frontend-only change to the generated static HTML.

## Files to change

- `src/lib/atlas-live-tour.ts` — toolbar CSS, extract `TOOLBAR_HTML`, export `toolbarHtml`, remove toolbar from `STAGE_OVERLAY_HTML`, adjust letterbox height calc.
- `src/lib/atlas-curation-server.ts` — insert `${liveTour.toolbarHtml}` between `</header>` and `<main class="f3d-stage">` in `renderCuratedHtml`.
