# Bidirectional Live Tour annotations (agent ↔ visitor)

## Goal
Let either side of a Live Guided Tour use the full annotation toolbar — Pointer, Draw, Focus Rope, color picker, Clear, Exit — and have every stroke / pointer move / clear / nav‑lock land on the other peer. Today only the agent can annotate; the visitor renders inbound events only.

## Why this is a small, surgical change
The DataChannel protocol in `src/lib/portal/live-session.mjs` is already symmetric:

```text
pointer / stroke_begin / stroke_patch / stroke_commit / clear / nav_lock
   sender → DataChannel.send →  receiver._handleIncomingData → state patch
```

Receiver-side, `_handleIncomingData` (lines 535–597) has **no role guard** on any annotation packet — it accepts them regardless of which side sent them. The only gates that keep the visitor silent today are:

1. **Sender gate** in `live-session.mjs` line 643 — `_canSendAnnotation()` returns `state.role === "agent"`.
2. **CSS** in `portal.functions.ts` line 1651 — toolbar visible only for `body.live-tour-agent`; nav‑lock overlay (lines 1643–1644) only on `body.live-tour-visitor`.
3. **UI handlers** in `portal.functions.ts` — every canvas pointer handler, `setToolMode` nav‑lock, `handleClearLocallyAndBroadcast`, `commitActiveRope`, `scheduleRopeFlush`, the rope `pointerup` finish-send, and the receiver branches (`if(state.role==="visitor")`) are role-locked.

Drop those three gates and the existing wire layer carries everything through unchanged.

## Changes

### 1. `src/lib/portal/live-session.mjs`
Relax exactly one function so visitor packets are emitted too. `_sendSeq` / `_lastRecvSeq` are already per-peer, so monotonicity holds when both sides send.

```js
function _canSendAnnotation() {
  return (state.role === "agent" || state.role === "visitor")
      && !!dataConn && state.isConnected;
}
```

No other change in this file — the receiver path, role-guard for `teleport` / `location_share`, and PeerJS lifecycle are correct as‑is.

### 2. `src/lib/portal.functions.ts` — CSS
- Line 1651: show the toolbar for both roles:
  `body.live-tour-active.live-tour-agent #anno-toolbar, body.live-tour-active.live-tour-visitor #anno-toolbar { display: flex }`
- Lines 1643–1644: make the nav‑lock overlay (`#live-tour-navlock.locked`) and the iframe `pointer-events:none` rule trigger on either role class, so when the visitor annotates the agent's iframe freezes (and vice versa, unchanged).

### 3. `src/lib/portal.functions.ts` — UI handlers
Replace every `role === "agent"` / `role !== "agent"` check that gates *sending* or *applying received* annotation events with a check for "connected with a role" (`role === "agent" || role === "visitor"`). Specifically:

- `setToolMode` (≈ L4170, L4186): pointer-null send on tool exit, and `sendNavLock` on tool change, fire for both roles.
- Canvas handlers `pointerdown` / `pointermove` / `pointerup` / `pointerleave` (L4396–4505): drop the agent-only early-return so visitors can draw, move pointer, rope, and finish strokes.
- `handleClearLocallyAndBroadcast` (L4384): visitor broadcast allowed.
- `commitActiveRope` (L4337), `scheduleRopeFlush` (L4325), the rope finish-send inside `pointerup` (L4492): both roles allowed.
- `anno-exit-btn` branch (L4517): the belt-and-suspenders `sendNavLock(false)` allowed for both roles.
- Receiver branches in `onState` (L5247–5325): drop `state.role === "visitor"` gates on `incomingPointerEvent`, `incomingStrokeEvent`, `incomingClearEvent`, `incomingNavLockEvent` so the agent now renders the visitor's pointer/strokes/clear/nav_lock with the same code path.

### 4. Auto-open drawer behavior — unchanged
`setBodyLetterboxClass(active, isAgent)` keeps auto-opening the left drawer for the agent only. The toolbar lives inside the letterbox so the visitor doesn't need the drawer open to annotate.

## Cross-cutting concerns I verified

- **Sequence numbers**: each peer increments its own `_sendSeq`; each peer's `_lastRecvSeq` filters only the inbound stream from the other peer. Bidirectional sending preserves per-link monotonicity.
- **Stroke ID collisions**: ids are `Date.now() + "_" + random36(6)` — collision probability between two peers in the same session is negligible. No namespace prefix needed.
- **Pointer dot**: `#remote-pointer` is already inside the wrap on both roles; the agent will now also show the visitor's pointer using the existing render code.
- **Color picker / Focus Rope shape**: each side has its own `ANNO_STROKE_COLOR` / `ANNO_ROPE_SHAPE` state; color/width travel inside each packet, so both sides render the sender's choice correctly.
- **Nav-lock symmetry**: when visitor enters a tool, visitor sends `nav_lock(true)` → agent's iframe is frozen (so visitor's strokes stay aligned to the agent's current sweep). When visitor leaves the tool or hits Exit, `nav_lock(false)` releases the agent. Mirror of the existing agent→visitor flow.
- **Teleport auto-clear**: `applyTeleport` already wipes annotations on both sides on every teleport — still correct.
- **Live sync echo fix** (previous task): untouched. The clipboard polling / `currentViewKey` echo guard sits entirely in the teleport path, not in the annotation path.
- **No protocol bump**: standalone HTML generated for older sessions stays wire-compatible with newer ones; the only added behavior is "visitor MAY now send annotation packets the agent already knew how to receive."

## Files touched
- `src/lib/portal/live-session.mjs` — one-line `_canSendAnnotation` change.
- `src/lib/portal.functions.ts` — CSS (2 selectors) + ~10 small handler edits in the annotation block + 4 receiver-branch gate removals.

## Verification
1. Generate fresh standalone HTML, open on two devices, join as Agent + Visitor.
2. As visitor: click Pointer → move over iframe → agent sees the dot, agent's iframe is locked.
3. As visitor: Draw and Focus Rope (circle + box) → strokes render live on agent; final shape matches on commit.
4. As visitor: Clear → wipes both canvases; Exit → unlocks agent iframe.
5. Repeat all of the above as agent (unchanged behavior — regression check).
6. Both sides annotate at once → both canvases show both stroke sets; both iframes are locked; either side hitting Exit releases its own lock on the other peer.
7. Teleport during annotation → both canvases wipe (existing behavior).
8. Verify `bun run scripts/verify-portal-html.mjs` still passes and `tests/live-session.test.mjs` is green.
