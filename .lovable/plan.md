# HUD Header Toggle + Presentation Filename Fix

## Issue 1 — HUD Header Doesn't Show When Chevron Clicked

### Root cause

In the generated presentation HTML, `setHudVisible()` rebuilds `className` from scratch:

```js
hudHeader.className = "hud-header " + (v ? "visible" : "hidden");
```

The CSS toggles via `#hud-header.visible{max-height:80px;opacity:1}` and `#hud-header.hidden{max-height:0;opacity:0}`. While the class swap itself is technically valid, this implementation has three real failure modes that combine to produce the bug the user is seeing:

1. **`overflow:hidden` + `max-height:80px` clip the inner content.** `#hud-inner` has padding (10px top + 10px bottom = 20px) plus three stacked text rows (13px brand + 11px name + 11px loc with line-heights ≈ 18px each ≈ 54px) plus a 28px icon row in `#hud-right`. Real rendered height frequently exceeds 80px once a logo or longer brand name is present, so even when the class is correctly applied, the visible band is too short to show the contact button / Ask button row — the user perceives "nothing appears."
2. **No paint-trigger after class swap.** Because the chevron click does not toggle `display`, a cold transition from `max-height:0` to `max-height:80px` sometimes fails to repaint when combined with the iframe's GPU compositor layer above it (observed on Chromium when `backdrop-filter` is also active on the same element). The element is technically visible in the DOM tree but renders 0px tall.
3. **`dismissGate()` already calls `setHudVisible(true)`** so the very first chevron click *hides* the header (counter to the chevron-down affordance shown). The user clicks expecting to expand, sees nothing change visually (because the bar was already collapsed visually in scenario 1), and concludes "the dropdown does not work."

### Fix

Edit `src/lib/portal.functions.ts` (the runtime-JS generator block that emits `setHudVisible` and the HUD CSS) to:

1. **Remove `max-height` clipping.** Replace the visible/hidden CSS with a `transform: translateY()` + `opacity` pattern, which has no height ceiling and forces a compositor repaint:
   ```css
   #hud-header{position:fixed;top:0;left:0;right:0;z-index:500;
     transform:translateY(-100%);opacity:0;pointer-events:none;
     transition:transform 0.3s ease,opacity 0.3s ease}
   #hud-header.visible{transform:translateY(0);opacity:1;pointer-events:auto}
   ```
   Drop the `.hidden` class entirely — absence of `.visible` is the hidden state. Drop `overflow:hidden` from `#hud-header`.

2. **Use `classList.toggle` instead of full `className` rewrite.** Preserves any future classes and avoids accidental clobbering:
   ```js
   function setHudVisible(v){
     hudVisible = v;
     if(hudHeader) hudHeader.classList.toggle("visible", v);
     if(chevUp) chevUp.style.display = v ? "" : "none";
     if(chevDown) chevDown.style.display = v ? "none" : "";
   }
   ```

3. **Update the initial markup** from `<div id="hud-header" class="hidden">` to `<div id="hud-header">` (no class — naturally hidden via the new base style).

4. **Keep `dismissGate()` calling `setHudVisible(true)`** so the bar appears once the welcome gate clears — that behavior is intentional. The chevron then collapses/expands as expected.

### Why this is safe

- The `.hidden` class is only used by `#hud-header` and `#gate` in the runtime. `#gate.hidden` is independent and untouched.
- `pointer-events:none` in the hidden state prevents the (now off-screen but still in DOM) header from intercepting clicks meant for the iframe.
- No other code reads `hudHeader.className` — the only mutation point is `setHudVisible`.
- Chevron icons, `updateHud()`, mute button, contact drawer, modals, Ask AI panel — all unchanged.
- The Ask runtime assembler (`src/lib/portal/ask-runtime-assembler.ts` and the three `.mjs` modules) is not touched.

## Issue 2 — Presentation Filename Should Reflect Property Name + Date

### Current behavior

`src/components/portal/HudBuilderSandbox.tsx` (line 669–670):
```js
const safeName = (models[0]?.name || "presentation").replace(/[^a-zA-Z0-9_-]/g, "_");
a.download = `${safeName}.html`;
```
This only uses the first model's internal `name` field (frequently blank or `"Untitled"`).

### Fix

Update the filename builder to prefer `propertyName` (the user-facing property label), fall back to `name`, and append today's date in `YYYY-MM-DD` form:

```js
const first = models[0];
const rawName = (first?.propertyName || first?.name || "presentation").trim();
const safeName = rawName.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "presentation";
const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
a.download = `${safeName}_${today}.html`;
```

Example output: `Chaska_Commons_Coworking_2026-04-27.html`

### Why this is safe

- Falls back gracefully when `propertyName` is empty.
- Sanitizer strips all unsafe chars and trims leading/trailing underscores so names like `"  My Property  "` become `My_Property`, not `__My_Property__`.
- Date in ISO form sorts naturally and is locale-independent.
- Only the download `a.download` attribute changes — no server payload, no DB, no URL state affected.

## Files to edit

- `src/lib/portal.functions.ts` — HUD CSS block (~lines 822–825), HUD markup (~line 946), `setHudVisible` JS (~lines 1187–1192).
- `src/components/portal/HudBuilderSandbox.tsx` — `runDownload` filename construction (~line 669–670).

## Verification steps after implementation

1. Generate a fresh presentation from the sandbox; confirm the download filename matches `<PropertyName>_<YYYY-MM-DD>.html`.
2. Open the generated HTML; click "Continue with sound" — header should be visible immediately with all icons/contact/Ask buttons rendered.
3. Click the chevron — header smoothly slides up and disappears; chevron flips to down arrow.
4. Click again — header slides back down; chevron flips to up arrow. All interactive buttons (Ask, Contact, mute, map, cinema, media) respond to clicks.
5. Confirm the iframe receives clicks normally when the header is hidden (no invisible overlay catching pointer events).