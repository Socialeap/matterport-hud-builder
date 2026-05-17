## Plan: Replace Live Tour header with a left-side drawer

### Goal
When Live Tour mode is active, remove the top Live Tour HUD entirely so it never covers Matterport’s native “Link to location / Copy to clipboard” UI. Keep only a small chevron at the top-left that opens a compact left drawer with Live Tour controls.

### Safest approach selected
I evaluated three options:

1. **Move the current Live Tour header lower** — rejected because it can still overlap Matterport popups and viewport content.
2. **Reuse the existing right-side Live Tour drawer** — rejected because that drawer is for starting/joining a session, not in-session controls, and it would conflict with agent setup controls.
3. **Create a dedicated in-session left drawer** — selected because it fully clears the top Matterport UI, keeps the current sync/leave logic intact, and cleanly separates regular HUD vs Live Tour controls.

### Implementation steps
1. **Remove the Live Tour header layer**
   - Delete the `#hud-header-livetour` horizontal bar markup and associated top-header CSS.
   - Keep the regular `#hud-header` for non-Live-Tour mode only.
   - Keep `body.live-tour-active #hud-header { display:none !important; }` so the normal HUD cannot appear during a Live Tour.

2. **Move chevron behavior for Live Tour only**
   - Keep the existing `#hud-toggle` element so regular HUD behavior remains unchanged outside Live Tour.
   - Add Live Tour CSS state:
     - normal mode: chevron remains top-right and toggles the regular HUD.
     - `body.live-tour-active`: chevron moves to top-left.
   - During Live Tour, the chevron will toggle the new left drawer instead of a top header.

3. **Add a dedicated left in-session drawer**
   - Add `#live-tour-control-drawer` as a fixed left-side panel.
   - Drawer order:
     1. `Leave`
     2. `Sync My View`
   - Visitor sees both buttons.
   - Agent sees `Leave` only.
   - Use the existing `#loc-sync-btn`, `#loc-sync-status`, `#loc-sync-fallback`, input, and submit IDs inside the drawer so the current clipboard/paste/send logic remains wired with minimal risk.

4. **Update HUD toggle wiring**
   - Modify the early `window.__setHudVisible` function to select target by mode:
     - idle mode: toggles `#hud-header` exactly as before.
     - live mode: toggles `#live-tour-control-drawer` with an `.open` class.
   - Ensure inactive UI is always reset:
     - regular HUD closes when Live Tour starts.
     - live drawer closes when Live Tour ends.
     - sync fallback/status reset still runs through existing `resetLocationSyncUi()`.

5. **Rewire Live Tour sync opener safely**
   - Replace the current `ltSyncBtn/openLtSyncPanel/closeLtSyncPanel` logic with drawer-based helpers:
     - clicking the drawer’s `Sync My View` button expands/collapses the sync instruction block inside the drawer.
     - successful sync closes only the sync instruction block and drawer after the existing short delay.
   - Preserve existing location sync execution path:
     - `loc-sync-btn` click → clipboard/paste parser → `session.shareLocationWithAgent()` → agent receives share pill → agent may follow.

6. **Rewire Leave without changing session teardown**
   - Keep `leaveBtn=document.getElementById(...)` but point it at the new drawer Leave button.
   - Preserve `teardownSession()` exactly as the single exit path.

7. **Regression checks**
   - Search for all old Live Tour header references (`hud-header-livetour`, `lt-hud`, `lt-sync-panel`, `show-sync`) and remove/replace them.
   - Verify the remaining dependency graph:
     - body live-tour classes → CSS role gating → chevron target → drawer → existing sync/leave handlers.
   - Run the existing live-session test suite or the narrow portal verification script if available.

### Expected result
- Live Tour active: no horizontal header exists at the top, so Matterport’s native URL popup and “Copy to clipboard” remain accessible.
- Top-left chevron opens a compact left drawer.
- Drawer shows `Leave` first and `Sync My View` second for visitors; only `Leave` for agents.
- Regular HUD behavior remains unchanged when no Live Tour is active.