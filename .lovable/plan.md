# Fix: Live Sync echo causes initiator's iframe to reload

## Symptom

In a Live Guided Tour, when **User A** (agent or visitor) initiates **Sync View**, **User B**'s iframe correctly snaps to A's viewpoint. But when User B then clicks anywhere inside their (now-synced) Matterport tour, **User A's** iframe reloads back to that same view — an unnecessary refresh that interrupts A.

## Root cause

Sync View is implemented as **ambient clipboard polling** (`src/lib/portal.functions.ts` lines 4615–4848). Both sides listen for `focus`, `visibilitychange`, `pointerenter`, and `clipboardchange`. Each trigger calls `readClipboardAndSend()`, which:

1. Reads `navigator.clipboard.readText()`.
2. Parses out a Matterport `ss/sr` URL.
3. Calls `attemptSendLocation()` → `shareLocationWithAgent` (visitor) or `teleportVisitor` (agent).

The dedupe layer that protects against re-sending the same coords only tracks **what *we* sent** (`lastSentLocationKey`, `lastReadClipText`). It is **never updated when we *receive* a sync**.

So the failure path is:

```text
A copies URL  ──►  A sends teleport  ──►  B's iframe reloads (applyTeleport)
                                            │
                                            ▼  B's clipboard now (or soon) holds
                                               that same Matterport URL, either
                                               because B pressed U earlier, or
                                               because B's clipboard gets
                                               written by Matterport / the
                                               browser on the new sweep.
                                            │
B clicks ──► pointerenter / focus fires ──► B reads clipboard ──► parses URL
                                            │
                                            ▼  B's lastSentLocationKey is ""
                                               (B never sent this) → dedupe
                                               does NOT trigger → B re-broadcasts
                                               back to A → A's iframe reloads.
```

The `SYNC_SUPPRESS_MS = 500ms` window only fires if A *just* sent — it expires long before B's first post-sync click.

The role-direction guards added in `live-session.mjs` (lines 504–533) correctly prevent each side from patching its *own* echo back into state, but they do not stop the **other** side from generating a fresh outbound packet for the same coordinates.

## Fix

Two surgical, defensive changes — both in `src/lib/portal.functions.ts`. No `live-session.mjs` change is needed; the wire protocol is correct.

### 1. Treat the currently displayed view as a no-op for outbound shares

In `attemptSendLocation()` (around line 4743), add a guard at the top:

```js
// Echo suppression: if the clipboard coords already match the view
// we're currently displaying (whether we navigated there ourselves or
// were teleported there by the other side), this is a no-op — never
// rebroadcast. Flash success silently so the pill behaves the same as
// the existing 5s recent-send dedupe path.
var key = parsed.ss + "|" + parsed.sr;
if (currentViewKey && key === currentViewKey) {
  setPulseState("success");
  scheduleSyncIdleReset();
  return true;
}
```

`currentViewKey` is already updated by `applyTeleport()` on both sides (line 4976) and by the initial teleport send in `teleportVisitor()` inside the controller (line 614), so it is the single authoritative source for "the view I'm looking at right now."

### 2. Stamp dedupe state on the receiver after a teleport applies

In the `onState` subscriber, in the two receive branches (lines 5173–5200), after each successful `applyTeleport(...)` add:

```js
// Lock the receiver-side dedupe so even a delayed clipboard read of
// the same URL (Matterport rewrites, pointerenter polls, focus re-
// entry) cannot rebroadcast and ping-pong the sender's iframe.
lastSentLocationKey = state.incomingTeleportEvent.ss + "|" + state.incomingTeleportEvent.sr; // or incomingLocationShareEvent.* in the agent branch
lastSentLocationTs = Date.now();
```

This belt-and-suspenders update means the existing 5-second window at line 4751 kicks in immediately — and combined with change #1, even after that window expires the `currentViewKey` guard still blocks the echo.

## Why this is safe

- **No protocol change.** The DataChannel packets, role guards, and PeerJS lifecycle in `live-session.mjs` are untouched.
- **Sender behavior unchanged.** When the user copies a *new* Matterport URL whose coords differ from `currentViewKey`, the guard falls through and a normal share goes out. Re-teleporting to the same stop via the Live Tour drawer still works because `teleportVisitor` is called directly (not through `attemptSendLocation`) and sets `currentViewKey` before sending.
- **Annotation/cursor flows unaffected.** Those use `seq`+`viewKey` filters on the controller side; they don't touch sync dedupe.
- **`SYNC_SUPPRESS_MS` and `lastOwnSendTs` logic stays intact** for the original "near-simultaneous bidirectional copy" race they were designed for.

## Files touched

- `src/lib/portal.functions.ts` — `attemptSendLocation()` guard, and two two-line updates in the `onState` receive branches.

## Verification

1. Open the generated standalone HTML on two devices, connect as Agent + Visitor.
2. Agent presses `U` → "Copy to clipboard" → visitor's iframe snaps.
3. Visitor clicks/navigates inside the now-synced tour repeatedly — **agent's iframe must not reload.**
4. Visitor then presses `U` on a *different* sweep → "Copy to clipboard" → agent's iframe snaps once (auto-follow).
5. Repeat in the reverse direction (visitor initiates → agent receives → agent clicks around).
6. Live Tour Stops button still teleports the visitor on click.
