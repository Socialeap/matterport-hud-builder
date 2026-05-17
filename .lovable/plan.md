
# Focus Rope annotation tool

Add a "Focus Rope" tool to the Live Tour annotation overlay that lets the agent draw a colored **Circle** or **Box** outline around any object on the 3D tour and resize it after creation via a latch handle. Reuses the existing color dropdown for foreground contrast. All changes are confined to `src/lib/portal.functions.ts` (the same file that holds the existing Pointer / Draw toolbar). **No changes to the live-session wire format or `live-session.mjs`** — keeps the P2P contract and `tests/live-session.test.mjs` green.

## What the user sees

Toolbar, left to right (additions in **bold**):

```text
[Pointer] [Draw] [color ▾] [Focus Rope] [shape: Circle ▾] [Clear] [Capture]
```

- Clicking **Focus Rope** activates rope mode (toolbar button toggles `.active`, same pattern as Pointer/Draw).
- The shape dropdown (Circle / Box) sits next to it; whitelist-guarded just like the color picker.
- In rope mode, the agent click-drags on the canvas: a colored outline is drawn from the press point to the cursor (circle bounded by drag rect, or rectangle). On release the rope **stays on screen** and a small filled latch handle appears at the bottom-right of the shape's bounding box.
- The agent can grab the latch and drag to resize the rope at any time while it's the active rope. Picking a different tool, hitting **Clear**, or teleporting deactivates the latch and bakes the rope as a committed annotation (still visible, no longer resizable).
- Color dropdown selection applies to subsequent ropes (and to the active rope while it's still being resized), mirroring existing Draw behavior.
- Hotkey: **R** for Focus Rope (next to existing P/D/C/S). Esc deselects.

## Wire-compatible rendering strategy

Strokes on the wire are arrays of normalized `[x,y]` points connected with `lineTo` (see `drawStroke`). A circle is sent as a 48-point polyline approximation; a box is 5 points (closed). This means:

- The visitor renders ropes using the **existing** stroke pipeline. No new packet types.
- Resize updates re-send `stroke_begin` for the **same** `strokeId` with the new full point set. The visitor's `incomingStrokeEvent` handler is extended so a `begin` for an existing `strokeId` **replaces** that stroke's points (today it always pushes a new one). This change is backward-compatible — vanilla Draw strokes always use fresh ids, so behavior is identical for them.
- `stroke_commit` is sent on the final mouseup (end of resize session, or when leaving rope mode), matching today's commit semantics.
- The latch handle is an **agent-only local UI affordance** — never serialized over the wire and never written into `localStrokes` on the visitor.

## Technical changes (all in `src/lib/portal.functions.ts`)

### 1. CSS (near the existing `.anno-tool-btn` / `.anno-color-wrap` block, ~lines 1605–1612)
- Add `.anno-shape-wrap` / `.anno-shape-select` mirroring the color picker styles (so the Circle/Box dropdown matches visually).

### 2. Toolbar markup (in the `#anno-toolbar` block, ~lines 1745–1758)
- Insert after the color picker, before `#anno-clear-btn`:
  - `<button class="anno-tool-btn" data-tool="rope" id="anno-rope-btn" aria-keyshortcuts="R">Focus Rope</button>`
  - `<label class="anno-shape-wrap"><select id="anno-shape-select" class="anno-shape-select"><option value="circle">Circle</option><option value="box">Box</option></select></label>`

### 3. State (near `ANNO_STROKE_COLOR`, ~line 3843)
- `var ANNO_ROPE_SHAPE="circle";` plus a whitelist `{circle:1, box:1}`.
- `var activeRope=null;` holding `{strokeId, color, width, shape, x0,y0,x1,y1}` in normalized coords. Distinct from `activeStroke` (free-draw).
- `var ropeLatchDragging=false;` and a `var LATCH_PX=10;` constant for hit-tolerance.

### 4. Geometry + rendering helpers
- `ropeToPoints(rope) -> number[][]`: produces the polyline (48-pt circle / 5-pt closed box) from the bounding rect.
- `ropeLatchPos(rope) -> {x,y}`: bottom-right of the bbox in normalized coords (translated to pixels at draw time).
- Extend `redrawAllStrokes()` to also draw the latch handle for the active rope when present (after the strokes loop) — small filled disc using the rope's color with a thin white outline for contrast.

### 5. Tool selection
- Extend `setToolMode("rope")` to set canvas cursor (`crosshair`) and toggle the toolbar `.active` state via the same query that already handles `[data-tool]` buttons.
- Switching away from `"rope"` while an `activeRope` exists: send a final `stroke_commit` for that rope, then null out `activeRope` (the rope's points stay in `localStrokes`).

### 6. Pointer wiring (canvas handlers, ~lines 4100–4151)
- `pointerdown` in rope mode:
  - If there's an `activeRope` and the press is within `LATCH_PX` of `ropeLatchPos`, enter resize mode (`ropeLatchDragging=true`).
  - Otherwise commit any prior active rope (`sendStrokeCommit`), then create a new `activeRope` with a fresh `strokeId`, anchor at the press point, push to `localStrokes`, and call `pushRopeUpdate()` (see below).
- `pointermove` in rope mode: update `x1,y1` (or, during latch drag, only the dragged corner), regenerate the rope's `points` in place inside its `localStrokes` entry, call `redrawAllStrokes()`, and call `scheduleRopeFlush()`.
- `pointerup` in rope mode: end the local drag — but **do not** commit yet; the rope remains active so the latch can be grabbed again. The rope is committed when the agent switches tools, teleports, or starts a new rope.

### 7. Throttled outbound updates
- `scheduleRopeFlush()` mirrors `scheduleStrokeFlush()` — coalesces to one rAF tick.
- `pushRopeUpdate()` calls `session.sendStrokeBegin(currentViewKey, activeRope.strokeId, activeRope.color, activeRope.width, ropeToPoints(activeRope))`. Reusing `stroke_begin` for live updates is intentional: paired with the visitor-side "replace if id exists" change, it gives us atomic full-shape snapshots without protocol churn or risk of partial polylines flashing on the visitor.

### 8. Visitor receive path (in `onState`, ~lines 4490–4513)
- In the `sev.kind === "begin"` branch, look up `findLocalStroke(sev.strokeId)`:
  - If found → replace `existing.points` with `sev.points.slice()` (and update color/width if present).
  - If not found → existing push-new behavior.
- `patch` branch unchanged (free-draw keeps appending).
- `commit` branch unchanged.
- Net effect: free-draw works exactly as today; ropes get atomic snapshot updates.

### 9. Shape picker wiring (mirrors color picker block at ~lines 4172–4185)
- Bind `change` on `#anno-shape-select`; reject anything outside the whitelist; update `ANNO_ROPE_SHAPE`. If an `activeRope` is mid-edit, regenerate its points so the visible shape switches immediately and `pushRopeUpdate()` fires.

### 10. Clear, teleport, teardown
- `wipeAnnotations()` already clears `localStrokes` + `activeStroke`; extend it to also null out `activeRope` and `ropeLatchDragging`.
- `applyTeleport()` already calls `wipeAnnotations()` — rope auto-clears on teleport, viewKey filter on the visitor drops late rope packets. No extra work.
- `teardownSession()` already calls `wipeAnnotations()` — covered.

### 11. Hotkey
- Add `else if(k==="r"){ setToolMode("rope"); e.preventDefault(); }` in the existing keydown handler (~line 4202). Pointer/Draw/Clear/Capture/Esc behavior unchanged.

### 12. Capture spec
- `downloadCaptureSpec()` iterates `localStrokes` and serializes `points` — ropes are already in `localStrokes` as polylines, so they're captured automatically with no extra code. Verified by tracing the function at ~lines 4050–4096.

## Safety / regression analysis

- **Wire format unchanged.** `tests/live-session.test.mjs` and the PeerJS controller are not touched. The new behavior is realized entirely through `stroke_begin` snapshot semantics on the agent side and a single client-side "replace if id matches" tweak on the visitor side.
- **Free-draw unaffected.** Free-draw uses fresh strokeIds per stroke and uses `stroke_patch` for incremental updates, so the visitor's new "replace on begin if id matches" branch never fires for legacy draw strokes.
- **Color whitelist preserved.** Ropes adopt `ANNO_STROKE_COLOR` at creation time and stay re-tintable while active; the whitelist guard on the existing `#anno-color-select` is reused as-is.
- **Shape whitelist added** so a hijacked `<option>` value can't push arbitrary state into rendering.
- **Visitor never sees the latch.** The latch is only drawn when `activeRope` is non-null, and `activeRope` is set exclusively in agent-side pointer handlers.
- **Per-frame throttling** via `scheduleRopeFlush()` keeps the DataChannel under the existing backpressure guard in `live-session.mjs` (`LIVE_SESSION_POINTER_BACKPRESSURE_BYTES`) — at ~60Hz × ~48 points × ~12 bytes/point we're well under 64 KiB queued.
- **No new packet types**, so no migration concerns for visitors loading an older runtime against a newer agent (and vice-versa): worst case on an old visitor is that a rope resize re-shows as a stacked duplicate, never a crash.
- **Capture JSON unchanged in shape** — ropes flow through naturally; existing consumers see polylines as they always have.

## Out of scope (not changed)

- `src/lib/portal/live-session.mjs`, `src/lib/portal/live-session-source.ts`, the PeerJS wire format, the tests under `tests/live-session.test.mjs`, the visitor-side pointer cursor, the color whitelist contents, and any builder / dashboard UI.
