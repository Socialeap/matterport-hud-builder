
## Goal

Separate the generated presentation's single right-side drawer into two independent surfaces:

1. **Contact drawer** ("Get in Touch") — lead capture only.
2. **Live Tour drawer** — visitor PIN entry + agent host controls + tour stops. Lighter, more transparent, opened from a new HUD button.

Both live entirely inside the generated standalone HTML produced by `src/lib/portal.functions.ts` (the only place this UI is authored). No other surface needs UI changes.

## Scope

All edits land in **`src/lib/portal.functions.ts`** — CSS block, HUD header markup, drawer markup, and the `initLiveGuide` IIFE. No schema, server function, or component-tree changes. Existing live-session controller (`src/lib/portal/live-session.mjs`) and contact-form wiring are reused as-is.

## Changes

### 1. New "Live Tour" drawer + HUD button (markup)

- Add a new `<div id="live-tour-drawer">` sibling to `#agent-drawer`, rendered only when `hasLiveTour` is true (see flag rule below).
- Inside it, move the entire current `.drawer-live-guide` block (visitor pane, agent pane, PIN display, status, stops, "I'm the agent" toggle). Wrap with a header bar matching the contact drawer (title "Live Tour" + close button).
- Add a new `#hud-live-tour-btn` to `#hud-right` in the HUD header, immediately before the existing Contact button. Icon (broadcast/signal SVG) + label "Live Tour"; on viewports `<480px` show icon-only with `aria-label`/`title="Live Tour"`. Render only when `hasLiveTour`.
- Remove the `<div class="drawer-live-guide">…</div>` block from inside `#agent-drawer` (lines 1397–1428). The hidden `<audio id="lg-audio">` sink stays at body level (already outside the drawer).

### 2. Open/close wiring

Add two new globals next to `__openContact` / `__closeContact`:

```js
window.__openLiveTour = function(){
  if (window.__closeContact) window.__closeContact();
  document.getElementById("live-tour-drawer")?.classList.add("open");
  document.getElementById("hud-live-tour-btn")?.setAttribute("aria-expanded","true");
};
window.__closeLiveTour = function(){
  document.getElementById("live-tour-drawer")?.classList.remove("open");
  document.getElementById("hud-live-tour-btn")?.setAttribute("aria-expanded","false");
};
```

Update `__openContact` to call `__closeLiveTour()` first (mutual exclusion). Wire the new HUD button to `__openLiveTour`. Esc key handler (already present for the contact drawer near line 2320) is extended to also close the Live Tour drawer.

### 3. Auto-hide on connect, reopen via HUD

In `initLiveGuide`'s state subscriber, when a visitor transitions to `isConnected === true`, replace the current `hideOverlaysForLiveTour()` (which closes the contact drawer + hides HUD) with: close the Live Tour drawer (`__closeLiveTour()`), keep the HUD header visible so the user can reopen it, and set the HUD button into a "connected" visual state (see §5). Agent role keeps the drawer open by default (host needs the stops list).

### 4. Visual style — Live Tour drawer

New CSS block, deliberately lighter than `#agent-drawer`:

- `position:fixed; top:0; right:0; width:min(320px,90vw); height:100%`
- `background: rgba(10,12,20,0.55)` (vs contact drawer's `${hudBgColor}cc` ≈ 0.8 opacity)
- `backdrop-filter: blur(28px) saturate(160%)`
- `border-left:1px solid rgba(255,255,255,0.06)`
- Same slide transform/transition as the contact drawer for consistency
- Compact internal padding; reuse existing `.lg-*` classes verbatim so the inner controls don't need restyling
- Stops list uses `max-height:40vh; overflow-y:auto` so many bookmarks scroll inside the drawer instead of growing it

HUD button styling reuses `.hud-icon-btn`; add a `.hud-live-tour-btn.connected` modifier with a subtle pulsing accent dot (`box-shadow:0 0 0 0 ${accentColor}` keyframes) to reflect active session.

### 5. HUD button states

Driven by the same `onState` subscriber already in `initLiveGuide`:

- idle → no modifier
- agent waiting / visitor connecting → `.is-waiting` (steady accent dot)
- connected → `.connected` (pulsing dot)
- error → revert to idle (status text remains in the drawer)

### 6. Visibility flag

There is no existing `liveTourEnabled` boolean on the presentation. Define it inline at template time:

```ts
const hasLiveTour = hasAgentContact; // current behaviour: live tour rendered only when contact section exists
```

Keeping it equal to `hasAgentContact` preserves the current implicit gate and matches the existing condition that wraps `#agent-drawer`. Easy to tighten later (e.g. require ≥1 `liveTourStops` across properties) without touching the rest of the plan.

### 7. Mobile behaviour

At `max-width: 640px`, both drawers switch to `bottom:0; left:0; right:0; width:100%; height:auto; max-height:85vh; border-radius:16px 16px 0 0; transform:translateY(100%)` with `.open{transform:translateY(0)}`. Live Tour drawer caps at `max-height:70vh` so the tour stays visible behind it.

### 8. Contact drawer

After removing the `.drawer-live-guide` block, the contact drawer keeps: title, close, agent row, welcome note, call/text actions, quick-message section, social pills. No other refactor — copy, layout, and quick-message wiring stay identical to today.

## Technical notes

- Single source-of-truth file: `src/lib/portal.functions.ts`. The `initLiveGuide` IIFE keeps the same element IDs (`lg-pin-input`, `lg-stops`, etc.) — they just live under `#live-tour-drawer` now, so `getElementById` lookups are unchanged. Only the `section = getElementById("drawer-live-guide")` early-return gets re-pointed to `#live-tour-drawer-body`.
- `hideOverlaysForLiveTour()` is repurposed to "close Live Tour drawer + keep HUD". The "hide HUD on connect" behaviour is dropped per the spec ("Keep the Live Tour header button active/available so the visitor can reopen the panel").
- No backend, schema, or generated-HTML contract changes; existing exported presentations continue to function. New presentations get the new layout on next regeneration — expected and desired.
- Accessibility: both drawers get `role="dialog" aria-modal="false" aria-labelledby="…-title"`; HUD button gets `aria-expanded`; Esc closes whichever is open; focus moves into the drawer on open and back to the trigger on close.

## Out of scope

- Builder-side toggle for `liveTourEnabled` (kept implicit via `hasAgentContact`).
- New stop metadata, scheduling, or analytics.
- Changes to non-generated UI (dashboard, builder sandbox preview).
