## Scope

The features live in the generated end-product HTML, not the Builder preview. All edits target **`src/lib/portal.functions.ts`** (the inline IIFE rendered into the exported tour). The PeerJS controller (`src/lib/portal/live-session.mjs`) already exposes `dispose()` — no changes needed there.

## Goals

1. Add a **Leave** button next to the existing HUD chevron (`#hud-toggle`) that appears for both agent and visitor while a Live Guided Tour session is active, and tears the session down cleanly on click.
2. The moment a visitor's PIN is accepted and a full P2P connection is established (`status === "connected"` for both roles), automatically close the **Get in Touch** drawer and the **HUD header** so the 3D tour fills the screen.

## Changes — `src/lib/portal.functions.ts`

### 1. Markup: add Leave button next to chevron toggle (around line 1239)

Insert a sibling `<button id="hud-leave-btn" hidden>` right next to `#hud-toggle`. Hidden by default; revealed only when a live session reaches `connected`.

```html
<button id="hud-leave-btn" hidden aria-label="Leave live tour" title="Leave Live Tour">Leave</button>
<button id="hud-toggle" aria-label="Toggle header"> ... existing chevrons ... </button>
```

### 2. CSS: pill styled to match the chevron (around line 1084)

Add a rule positioned to the left of `#hud-toggle` (top:8px; right:40px; z-index:1300) using the same glass background, with a subtle red tint on hover to signal a destructive action. Keep it `display:none` while `[hidden]` and switch to `inline-flex` when revealed.

### 3. Live-guide IIFE wiring (around lines 2711–2898)

- Cache `var leaveBtn = document.getElementById("hud-leave-btn");` near the other element lookups.
- Add helper `function teardownSession(){ try { session.dispose(); } catch(_){} ; if(leaveBtn) leaveBtn.hidden = true; resetUiToIdle(); }` where `resetUiToIdle()`:
  - Re-enables `joinBtn` and `startBtn`, clears `pinInput.value`, clears status text.
  - Restores the visitor pane as default (`visitorPane.hidden=false; agentPane.hidden=true`) and resets the agent active/pre-join blocks.
  - Detaches `audioEl.srcObject`.
  - Re-creates the controller: `session = createLiveSession({});` and re-runs the same `subscribe(...)` callback (extract the existing subscribe handler into a named `function onState(state){...}` so it can be reattached after a fresh controller is created — avoids reload, preserves all other page state like current property, mute, modals).
- Wire `leaveBtn.addEventListener("click", teardownSession)`.
- Inside the existing `session.subscribe(...)` callback, on the **first** transition to `state.status === "connected"` for either role:
  - Reveal Leave: `leaveBtn.hidden = false;`
  - Auto-close Get in Touch: `if (window.__closeContact) window.__closeContact();`
  - Auto-hide HUD header: `setHudVisible(false);` (the early-bootstrap `window.__setHudVisible` is already global, but the IIFE's local `setHudVisible` wrapper is in scope here — verify by referencing it; if the IIFE scope doesn't reach `setHudVisible`, fall back to `if(window.__setHudVisible)window.__setHudVisible(false);` plus directly toggling the `#hud-header` class as a safety net).
  - Use a `wasConnected` flag captured in the IIFE closure so we only fire the auto-close once per connection (re-arm on `dispose`).
- On `state.status === "ended"` or `"error"` after having been connected, hide Leave and run `teardownSession()` so the visitor is returned to the joinable state cleanly. Guard against re-entry (the dispose path itself emits no further state — safe).

### 4. Subscribe handler scoping

The current subscribe callback is an inline anonymous function. Extracting it to a named `onState` function inside `initLiveGuide` keeps behavior identical while allowing the leave/teardown flow to re-attach it to a freshly created controller. No public API surface changes.

## Safety / Regression Audit

- **Controller lifecycle**: `dispose()` already stops mic tracks, closes data + media connections, destroys the PeerJS peer, and clears state — exactly what "Leave" should do. Recreating with `createLiveSession({})` is supported (factory has no shared module state). The PeerJS broker registration uses fresh random IDs each time, so re-init is safe.
- **One-time auto-close**: The `wasConnected` latch prevents the HUD/drawer from being forced closed every state tick (the user can still re-open the HUD with the chevron after auto-close).
- **No effect on Builder preview**: `HudPreview.tsx` and `HudBuilderSandbox.tsx` are untouched. Bookmark paste/save flow from the previous task is preserved.
- **No effect on non-live flows**: When `agent`/`phone`/`email` are all empty, `#agent-drawer` and the entire `#drawer-live-guide` block are not rendered — the new Leave button stays `hidden` because `initLiveGuide()` early-returns when `#drawer-live-guide` is missing. Chevron toggle continues to work via the early-bootstrap script.
- **Z-index**: Leave button shares `z-index:1300` with the chevron, sits below the contact drawer (`z-index:2000`) — no overlap with open drawer.
- **Mobile viewport**: 88vw drawer + small Leave pill at top-right do not collide; positioned at `right:40px` keeps it clear of the 24px chevron at `right:8px`.
- **Dispose during error**: Wrapped in `try/catch`; idempotent flag in `dispose()` prevents double-teardown.

## Out of Scope

- No DB / Cloud / edge function changes.
- No `live-session.mjs` or `live-session-source.ts` changes (the runtime source is consumed verbatim).
- Builder UI is untouched.
