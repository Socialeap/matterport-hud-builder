
## 1. P2P + Live Tour Stops audit — verdict

After reading the actual integration (the earlier "not present" reply was a bad search on my part — apologies), the system is correctly wired with no gaps to fix. Summary of what was verified:

- **PeerJS loader**: CDN script tag (`peerjs@1.5/peerjs.min.js`) is injected with `defer` in the generated HTML head, and the inlined controller polls `window.Peer` before constructing a peer, so the load-order race is already handled.
- **Controller (`src/lib/portal/live-session.mjs`)**: Full lifecycle is covered — `open / error / disconnected / close` on the Peer; `open / data / close / error` on the DataChannel; `stream / close / error` on the MediaConnection. A `disposed` flag short-circuits re-entry, and `dispose()` tears down the media call, data conn, mic tracks, and peer in order.
- **Source assembly (`live-session-source.ts`)**: Reads the `.mjs` via `?raw`, strips the trailing `export {…}` block, and runs `findForbiddenTokens` so any TS leak / stray import is caught at build time rather than at runtime in the visitor's browser.
- **Generation (`portal.functions.ts`)**: Sanitizes `liveTourStops` (drops entries without a non-empty `ss`), embeds them per-property, renders the agent's stop list via `renderStops()`, re-renders on `load(i)` so flipping properties refreshes the buttons, and routes clicks through `session.teleportVisitor(ss, sr)`.
- **Builder wiring (`HudBuilderSandbox.tsx` + `HudPreview.tsx`)**: `handleAddBookmark` / `handleRemoveBookmark` mutate the model's `liveTourStops`, draft autosave persists them, and the Guided-Paste toolbar parses Matterport "Press U" links, validates `ss`, and appends with a UUID.
- **End-product self-containment**: Generated HTML still phones home to nothing of ours — only to the public PeerJS CDN and the public PeerServer broker, which is the documented serverless P2P model. No backend dependency was introduced.

No code changes are needed for the P2P layer.

## 2. Bookmark UI overlap — fix

**Problem.** The "Bookmark" pill button and the expanded "Add Bookmark" toolbar are rendered *inside* the iframe wrapper in `HudPreview.tsx` (positioned `absolute … top-2` / `absolute inset-x-0 top-0`). In the Builder, that means they sit on top of the Matterport surface and cover the controls the client needs to read sweep coordinates from. They need to live **above** the preview frame, not inside it.

**Approach.** Add an opt-in prop `bookmarkBarPlacement?: "overlay" | "above"` (default `"overlay"` to preserve the standalone / fullViewport behavior). When `"above"`, render the Bookmark button and the expanded toolbar in a new wrapper *outside* the iframe container, stacked directly above it. The Builder mounts `HudPreview` with `bookmarkBarPlacement="above"`; the standalone end-product never sets it (the bar is Builder-only anyway, gated by `enableBookmarking`).

### Files changed

**`src/components/portal/HudPreview.tsx`**
- Add `bookmarkBarPlacement?: "overlay" | "above"` to `HudPreviewProps`, default `"overlay"`.
- Wrap the existing `return (<div ref={containerRef} …>` in a new outer fragment / flex column.
- When `bookmarkBarPlacement === "above"`:
  - Move the "Bookmark" pill button (lines ~339–366) and the Guided-Paste toolbar block (lines ~207–333, including the saved-stops chip list) out of the iframe `<div>` and into a sibling block rendered *before* the preview container.
  - Use a normal-flow (non-absolute) layout: a rounded card matching the preview's border, with an internal expand/collapse for the toolbar. The button sits on the right of a small header row labeled "Live Tour Bookmarks" so the client immediately understands what it's for; the count badge is preserved.
  - Drop the `absolute right-12 top-2` / `absolute inset-x-0 top-0` positioning for these elements; keep all other styling (glass background uses `hudBgColor`, accent colors, focus behavior, paste handler, name/link inputs, saved-chip list with delete).
  - Keep the existing `headerVisible` force-collapse behavior so toggling bookmark mode still tucks the HUD header away — it just no longer matters for overlap, only for visual focus.
- When `bookmarkBarPlacement === "overlay"` (default), render exactly as today — zero behavior change for the standalone preview.
- The "Show/Hide header" chevron stays inside the iframe overlay in both modes (it belongs to the HUD, not the bookmark feature).

**`src/components/portal/HudBuilderSandbox.tsx`** (line 1598 mount)
- Pass `bookmarkBarPlacement="above"` to the `<HudPreview>` instance in the Builder's right column.

### Layout result

```text
┌────────────────────────────────────────────┐
│ Live Tour Bookmarks            [+ Bookmark]│  ← new, above the frame
│  (toolbar + saved chips appear here when   │
│   bookmarking is active — never covers 3D) │
├────────────────────────────────────────────┤
│                                            │
│         Matterport iframe (clean)          │
│                                            │
│                            [chevron]       │
└────────────────────────────────────────────┘
```

### Out of scope
- No changes to `live-session.mjs`, `live-session-source.ts`, `portal.functions.ts`, the agent-side HTML rendered for the visitor, the data model (`LiveTourStop`), or autosave.
- No changes to the standalone end-product UI.
- Mobile preview / `fullViewport` mode keeps the existing overlay behavior so it still works as a tour surface.
