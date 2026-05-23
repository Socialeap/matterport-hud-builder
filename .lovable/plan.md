Four surgical UI tweaks to the generated standalone `index.html` (all changes live in `src/lib/portal.functions.ts` — the Mattertag drawer markup, CSS, and `buildMattertagDeepLink` helper). No backend, schema, Builder UI, or ZIP-export work is touched.

## 1. Suppress the Matterport tag dock on Jump To View

Background: Showcase's `&tag=<id>` param both navigates to the tag AND auto-opens the native billboard/dock. There is no officially documented `tagNav=0` flag — empirically that one is ignored. The reliable known-good combos are:

- `&play=1&qs=1&tag=<id>` — current behavior, opens dock.
- `&play=1&qs=1&tag=<id>&ts=0&dh=0` — `ts=0` removes the title-strip / Mattertag UI chrome, `dh=0` suppresses dollhouse hint; in practice the dock no longer auto-expands.
- Hardest-line fallback: drop `tag=` entirely and instead use `&sp=<sweepUUID>` once we know the tag's anchor sweep — but we don't store sweep IDs today, so this is not viable without a migration.

Plan:
- Update `buildMattertagDeepLink` (line ~3133) to append `&ts=0&dh=0` along with the existing `play=1&qs=1&tag=…`. Re-strip those keys from the base URL the same way `tag/play/qs` are stripped today so we never double-set them.
- Verify against the Noire model: clicking "Jump to View" should still recenter to the Mattertag's pose, but the right-side native dock no longer pops in front of our Property Features panel.
- If Matterport still pops the dock for a given build of Showcase, fall back to also appending `&hl=2` (highlight reel hidden) — kept as a documented one-line follow-up, not shipped by default since it can affect tag-dot visibility.

## 2. Sticky header inside Property Features panel

Today `#mattertag-inner` scrolls as one block, so the title + close button scroll away.

Plan (CSS-only, in the `<style>` block ~lines 1764–1807):
- Convert `#mattertag-drawer` from `overflow-y:auto` to `display:flex; flex-direction:column; overflow:hidden`.
- Split `#mattertag-inner` into two children using existing markup:
  - `#mattertag-title` + `#mattertag-close` become a sticky header bar: `position:sticky; top:0; padding:12px 14px; background:rgba(10,12,20,0.85); backdrop-filter:blur(20px) saturate(160%); border-bottom:1px solid rgba(255,255,255,0.06); z-index:5; flex:0 0 auto;`. Move `#mattertag-close` from absolute-positioned to a flex sibling of the title so they share the sticky bar.
  - `#mattertag-list` becomes the scroll region: `flex:1 1 auto; overflow-y:auto; padding:12px 14px 24px 28px;` (extra left padding so the new external numbers in #3 have room).
- Mobile media query (`max-width:640px`) keeps the same sticky pattern; bottom-sheet variant already works because the inner flex column inherits.

No JS changes — markup at lines 2247–2259 already has `#mattertag-close` as a direct child of `#mattertag-inner`, just needs reordering above `#mattertag-title` inside a new wrapper `<div id="mattertag-header">`.

## 3. Card numbers: move outside the card, translucent

Today `.mt-card-number` is `position:absolute; left:-12px` and fully opaque accent.

Plan (CSS-only at line 1773–1779):
- Change `#mattertag-list` to `padding-left:34px` (was `14px`) so the numbers have a dedicated gutter outside the card box.
- Change `.mt-card-number`:
  - `left:-26px` (was `-12px`) so it sits clearly outside the card with ~10px breathing space.
  - `background:${accent}b3` (≈70% alpha) for the translucent look; add `backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);` for legibility over varied content.
  - Keep size, font weight, shadow, and centering as-is so the visual rhythm is preserved.
- Mobile bottom-sheet: numbers still render in the gutter; the extra 20px left padding is comfortable inside `92vw`.

## 4. Drop the drawer below the HUD header

Today `#mattertag-drawer` is `top:0; height:100%`, so it slides over the HUD header.

Plan:
- Introduce a single CSS custom property `--hud-header-h: 56px` on `:root` (HUD header is ~52–56px tall today; current usages like `#ask-panel{top:72px}` confirm this range). Define it once in the `<style>` block near the top of the HUD section.
- Update `#mattertag-drawer`:
  - `top: var(--hud-header-h);`
  - `height: calc(100% - var(--hud-header-h));`
  - Keep `right:0; width:min(340px,92vw);` and the existing transform/transition.
- Mobile media query already overrides to a bottom sheet (`top:auto; bottom:0`) — leave untouched so phones still get the full-width bottom drawer.
- HUD header auto-hides (it slides up with `transform:translateY(-100%)` until hover/focus). The drawer's `top` offset stays constant; when the header is hidden there's a small transparent strip above the drawer, which is the desired behavior (drawer never covers the header when it appears).

## Verification

- Re-export the Noire presentation (no rebuild of the ZIP pipeline needed — same generator).
- Open `index.html` from disk:
  1. Click "Jump to View" on the Food Menu card → camera moves to the tag's pose, no native dock overlays the side panel.
  2. Scroll the Features list → "Property Features (beta)" header and ✕ stay pinned.
  3. Numbers 1…N render in a gutter to the left of each card with visible translucency (accent color shows through subtly).
  4. Open the drawer → its top edge sits flush under the HUD header bar; the header is fully visible and clickable.
- Sanity-check on mobile width (≤640px): bottom sheet still slides up from the bottom; sticky header still pins at the top of the sheet; numbers still render in the gutter inside the sheet.
- Regression checks: video-thumbnail cards, YouTube cards, and image-thumbnail cards (the just-fixed Noire pair) still render and still open in the internal media player.
