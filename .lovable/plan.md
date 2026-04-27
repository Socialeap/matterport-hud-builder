## Problem analysis

Looking at the screenshot + code in `src/lib/portal.functions.ts`:

1. **Far-left collision** — `#hud-inner` starts at `padding:10px 16px`, so `#hud-left` (logo + brand) sits directly over the Matterport iframe's native showcase title and search icon (top-left of the iframe).

2. **Duplicated property name** — The current draft has `brandName === propertyName === "Chaska Commons Coworking"`. The header renders:
   - `#hud-brand` ← `brandName` ("Chaska Commons Coworking")
   - `#hud-prop-name` ← `p.propertyName` ("Chaska Commons Coworking") ← duplicate
   - `#hud-prop-loc` ← `p.name + " — " + p.location` ("210 N Chestnut St, Chaska, MN 55318, US — Chaska, MN") ← also has redundant city/state

3. **No left-clear zone or truncation budget** — right-side controls (mute/map/cinema/media/Ask/agent name/Contact) wrap into the text and crowd it.

4. **Filename** — already implemented (`{propertyName}_{YYYY-MM-DD}.html`, line 806–809 of `HudBuilderSandbox.tsx`). No change needed; will verify only.

## Solution (single, surgical)

Restructure the HUD into a **3-column grid** so the center block is geometrically centered regardless of right-side button count, and reserve a left "safe zone" the iframe's chrome can occupy without overlap.

### Changes — `src/lib/portal.functions.ts` only

**A. CSS (`#hud-inner` block, ~lines 898–914)**

Replace the flex layout with CSS Grid:
- `#hud-inner`: `display:grid; grid-template-columns: 200px minmax(0,1fr) auto; align-items:center; padding:10px 16px 10px 220px;` — the **220px left padding** is the safe zone that keeps every header element clear of the Matterport showcase title + search icon on the far left.
- `#hud-center`: new wrapper, `min-width:0; display:flex; flex-direction:column; align-items:center; text-align:center; gap:2px;` holds logo (inline above text or row-flex) + brand + address.
- `#hud-logo`: stays `height:32px`, moved into the center column, `margin-bottom:2px`.
- `#hud-brand`: keep size, add `max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`.
- `#hud-prop-loc`: same truncation rules; this is the **only** line that may shrink/ellipsize when space is tight.
- Remove `#hud-prop-name` element entirely (it caused the duplicate).
- `#hud-right`: keep, `justify-self:end; margin-right:32px;` (32px keeps clear of the chevron).
- Add a responsive rule: `@media(max-width:720px){#hud-inner{grid-template-columns: 0 minmax(0,1fr) auto; padding-left:12px;}}` — on narrow viewports the iframe chrome auto-collapses, so the safe zone can shrink.

**B. HTML (`#hud-header` block, ~lines 1018–1027)**

```html
<div id="hud-header">
  <div id="hud-inner">
    <div id="hud-left-spacer" aria-hidden="true"></div>
    <div id="hud-center">
      {logoUrl ? <img id="hud-logo" …> : ""}
      <div id="hud-brand">{brandName}</div>
      <div id="hud-prop-loc"></div>
    </div>
    <div id="hud-right">… (unchanged) …</div>
  </div>
</div>
```

Removes the `#hud-left` wrapper, `#hud-text` wrapper, and `#hud-prop-name` div. Net result: brand name appears **once**, in the center.

**C. Runtime updater (`updateHud`, ~lines 1287–1304)**

Replace the two text assignments with a single, dedupe-aware composer:

```js
if (elLoc) {
  // Compose "{property name} — {location}" but skip either part if it
  // duplicates the brand name already shown above, so we never repeat
  // text in the header.
  var brand = (C.brandName || "").trim().toLowerCase();
  var pname = (p.propertyName || "").trim();
  var addr  = (p.name || "").trim();         // street address
  var loc   = (p.location || "").trim();     // city, state
  var parts = [];
  if (pname && pname.toLowerCase() !== brand) parts.push(pname);
  if (addr  && addr.toLowerCase()  !== brand && addr.toLowerCase() !== pname.toLowerCase()) parts.push(addr);
  if (loc   && addr.toLowerCase().indexOf(loc.toLowerCase()) === -1) parts.push(loc);
  elLoc.textContent = parts.join(" \u2014 ");
}
```

`elName` reference and the `if(elName)` block are deleted (element no longer exists). No other call sites reference `#hud-prop-name` (verified via grep — only the two lines above).

**D. Truncation budget**

`overflow:hidden; text-overflow:ellipsis; white-space:nowrap` on `#hud-brand` and `#hud-prop-loc` plus the grid's `minmax(0,1fr)` center column means: when the right-side button cluster grows, the **address line ellipsizes first** (per the user's requirement), and the brand never wraps under the controls.

### Files touched

- `src/lib/portal.functions.ts` — three localized blocks (CSS ~898–914, HTML ~1018–1027, JS updateHud ~1287–1304). No changes to bootstrap script, gate, audio, modal, or Ask AI logic.

### Files NOT touched (regression safety)

- `HudBuilderSandbox.tsx` — filename logic already correct.
- Early-bootstrap HUD safety script (~lines 1163–1180) — only references `#hud-header` and `#hud-toggle`; doesn't touch `#hud-prop-name` or layout.
- `HudPreview.tsx` — separate React preview component; only the generated .html ships to clients.

## Trace of trigger paths (confirmed safe)

1. **Property switch** (multi-property tour) → `updateHud(i)` runs → new composer produces a single, deduped line. Old `#hud-prop-name` removal is safe because no other code reads it (`rg "hud-prop-name"` → 2 hits, both inside `updateHud`).
2. **HUD toggle (chevron)** → flips `.visible` class on `#hud-header`. Untouched. Grid layout doesn't affect transform/opacity.
3. **Audio init** → `initAudio` triggered by `updateHud`'s `p.musicUrl` branch. Untouched.
4. **Mute button visibility** → `#hud-mute-btn.visible` toggled in `updateMuteBtn`. Stays inside `#hud-right`. Untouched.
5. **Contact drawer / Ask panel** — open via `window.__openContact` / Ask toggle button still inside `#hud-right`. Untouched.
6. **Single vs multi-property** — `#tabs` overlay (top-left, z-600) is independent of header; the 220px safe zone also keeps the header clear of `#tabs` when present.

## Visual result

```
┌────────────────────────────────────────────────────────────────────────┐
│ [iframe chrome:        │  [logo]                  │ 🔇 📍 🎬 🖼 💬  Lisa │
│  Showcase title 🔍 ]   │  Chaska Commons Coworking│ Ritmore [Contact] ⌃│
│                        │  210 N Chestnut St … MN  │                    │
└────────────────────────────────────────────────────────────────────────┘
   ↑ 220px safe zone        ↑ centered, deduped       ↑ right cluster
```

## Filename confirmation

`HudBuilderSandbox.tsx` line 806–809 already produces `Chaska_Commons_Coworking_2026-04-27.html` from `propertyName + ISO date`. No change required; will verify with a grep after edit.
