## Goal
True one-action sync: visitor presses **U → Copy to clipboard** inside Matterport. That's it. Our app detects the new clipboard contents and pushes the view to the agent automatically. No drawer, no paste, no second click, no focus juggling.

## The core idea ("auto-share")
The only real friction is the browser's clipboard-read permission. Chrome/Edge grant clipboard-read **per-origin for the rest of the session** the first time it's allowed during a user gesture. Once granted, `navigator.clipboard.readText()` runs silently forever after. We exploit that:

1. **Pre-grant** clipboard permission during the **same user gesture** that starts the Live Tour (the "Join PIN" / connect click). The browser shows the permission prompt exactly once, at the natural moment the visitor opts in to the live session — not buried mid-flow after they've already pressed U.
2. **Auto-poll** the clipboard while a Live Tour is active. Whenever a *new* Matterport "Link to location" URL appears, we parse it and call `session.shareLocationWithAgent()` automatically.
3. **No drawer interaction required** for sync. The "Sync My View" button + instruction panel are demoted to a tiny optional fallback for Safari/Firefox or denied-permission cases.

Visitor's mental model collapses to:

```text
Position view → press U → click "Copy to clipboard" → DONE
                                                       (agent sees a "Follow" pill)
```

## Why this fixes every problem in the current flow

- **Browser permission prompt only appears once**, at the obvious moment (starting Live Tour), not on every sync.
- **No drawer opens**, so the iframe never loses focus → the `U` key always works.
- **No paste step**, no "Sync My View" click, no manual button mashing per viewpoint.
- The visitor can share many viewpoints in a row with zero extra UI taps.
- Cross-origin iframe restriction stays respected — we still rely on the user copying the link, but they were doing that anyway.

## Detection strategy (no permission needed for triggers, only for the read)

We don't need the iframe's events; we just need good signals for *when to peek at the clipboard*:

- `window` `focus` event (fires when Matterport's "Copy to clipboard" toast/button click returns focus to the parent doc).
- `document` `visibilitychange` (covers tab reactivation).
- Light interval poll (every 700 ms) while a Live Tour is **connected as visitor**, capped to stop after N seconds of no clipboard change to keep CPU/battery negligible.
- Dedupe by content hash (the existing `ss|sr` key) so a held clipboard never re-sends.

## Visible UI changes

1. **Replace the "Sync My View" button + 3-step instruction panel with a slim auto-share status pill** that lives unobtrusively at the bottom of the Live Tour drawer (drawer stays closed by default — the pill itself sits as a fixed bottom-left chip so it's visible without opening anything).
   - States:
     - `Auto-share on · share by pressing U → Copy in tour`
     - `Sharing view…` (transient, ~600 ms)
     - `Shared ✓ — agent can follow` (auto-fades)
     - `Auto-share blocked — tap to enable` (only when permission was denied)

2. **First-time coach mark** (one-time, dismissible, stored in `sessionStorage`): a 2-line tooltip that appears the moment the visitor connects, anchored to the pill:
   > Share what you're looking at any time: **press U → click Copy to clipboard** inside the tour. We'll send it to your agent automatically.

3. **Drawer no longer needs `Sync My View`.** Drawer is reduced to `Leave` only for both roles. (Agent already only had `Leave`.) This eliminates the focus-stealing overlay entirely for the main flow.

4. **Denied-permission fallback** (Safari, Firefox, or user clicked Block):
   - Pill becomes a single tap target: `Tap after pressing Copy to clipboard`.
   - One tap = one read + send. Still no drawer, no paste, no instructions overlay.
   - Only if `readText()` is unavailable at all does the legacy paste field surface — kept as a deep fallback, hidden behind a "trouble syncing?" link in the pill.

## Implementation steps in `src/lib/portal.functions.ts`

1. **Pre-grant during Live Tour join**
   - In the visitor `Join` button handler and agent `Start` button handler (whichever path the visitor uses), after `session.joinAsVisitor(pin)` resolves, run a one-shot `navigator.clipboard.readText().catch(()=>{})` *inside the same click handler* so it counts as user-gesture-initiated. This triggers the browser prompt once, at the right time.

2. **Add `startClipboardAutoShare()`**
   - Wired only for `role === "visitor"` after `isConnected` becomes true.
   - Sets up: `window.addEventListener("focus", …)`, `document.addEventListener("visibilitychange", …)`, and a `setInterval(700)` poll. All three call a single throttled `tryReadAndShare()`.
   - `tryReadAndShare()`:
     - Skip if `permState === "denied"` (already known) or if the last attempt was < 400 ms ago.
     - Call `navigator.clipboard.readText()`. On success, run `parseMatterportLocationUrl`; if it returns a fresh `ss|sr` (different from `lastSentLocationKey`), call `attemptSendLocation()` immediately.
     - On `NotAllowedError`, flip the pill to denied state and stop polling.
   - Teardown on session end / role change.

3. **Pill component**
   - New `#auto-share-pill` element, fixed bottom-left, outside the drawer, never overlapping iframe interactions (small, ~220 px wide, low z-index conflict).
   - Reuses existing status copy and `is-success` / `is-error` styling.

4. **Remove the friction-heavy bits**
   - Delete `#lt-sync-btn`, `#lt-sync-panel`, the 3-step instruction list, the `openLtSyncPanel` / `closeLtSyncPanel` toggle, and the auto-open-drawer-then-focus dance.
   - Keep `parseMatterportLocationUrl`, `attemptSendLocation`, `shareLocationWithAgent`, the agent-side "Follow" pill, dedupe, and rate limit — they're already correct.
   - Drop the second `addEventListener("click", readPasteInputAndSend)` (currently registered twice — minor existing bug).

5. **First-run coach mark**
   - Render a small tooltip pointing at the pill on first connect; dismiss on any click or after 6 s; remember via `sessionStorage`.

6. **Fallback ladder (in order; first that works wins)**
   - a. Silent auto-poll (permission granted) → zero clicks.
   - b. One-tap pill (permission denied but `readText` exists) → one click after Copy.
   - c. Paste field (no `readText` at all) → hidden behind "trouble syncing?".

## Regression guardrails

- Keep all existing transport, agent-side `Follow` pill, dedupe, rate limit, and teardown paths untouched.
- Verify that during a Live Tour, no element we add captures pointer events over the iframe — `pointer-events: none` on the pill container, `auto` only on the pill body.
- Confirm `body.live-tour-active` still hides the regular HUD and that no chevron drawer auto-opens.
- Re-run the live-session tests; no public API of `createLiveSession` changes.

## What the visitor experiences end-to-end

1. Visitor clicks "Join" with the PIN. Browser asks once: "Allow this site to read the clipboard?" → Allow.
2. Tiny pill bottom-left: *"Auto-share on — press U → Copy in tour to share."*
3. Visitor navigates, presses **U**, clicks **Copy to clipboard** in Matterport's native popup.
4. Within ~700 ms our app reads the clipboard, parses the URL, sends it. Pill flashes *"Shared ✓"*.
5. Agent's "Follow" pill appears. They click Follow, both views sync.
6. Repeat indefinitely — no further clicks on our UI ever required.