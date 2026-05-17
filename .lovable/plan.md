
## Goal

Stop the "Share your view" card from blocking the 3D tour. Introduce a dedicated **Live Tour HUD** that replaces the regular HUD whenever `body.live-tour-active` is set. For visitors it contains only **Sync My View** and **Leave**, the instructions appear inline on demand, and the entire bar stays hidden until the chevron is clicked.

## Current state (traced)

- `src/lib/portal.functions.ts` renders a single `#hud-header` (brand, mute, map, cinema, media, floormap, Ask, Live Tour, Contact). The chevron `#hud-toggle` and standalone `#hud-leave-btn` already exist.
- During a live tour, `body.live-tour-active.live-tour-visitor` gates a separate fixed card `#loc-sync` at `top:120px` that contains the "Share your view:" instructions + Sync button. This is the blocking overlay.
- `setBodyLetterboxClass(active,isAgent)` (line ~4010) flips `live-tour-active` / `live-tour-visitor` / `live-tour-agent`. `teardownSession()` (~4816) resets everything; `leaveBtn` is currently shown via `leaveBtn.hidden=false` on connect (~5006).
- All Sync click logic (`syncBtn`, `readClipboardAndSend`, `enterPasteMode`, paste fallback, dedupe, `shareLocationWithAgent`) lives between lines 4518–4810. The agent-side `#loc-share-pill` is independent and stays untouched.

## Solution: two stacked headers, CSS-gated by role/state

### 1. Markup (`src/lib/portal.functions.ts`, around lines 1840–1880)

Keep the existing `#hud-header`, `#hud-toggle`, `#hud-leave-btn`. Add a sibling `#hud-header-livetour` that mirrors the structure but renders different children:

```text
#hud-header-livetour (visible only when body.live-tour-active && .visible)
├── #lt-hud-inner
│   ├── #lt-hud-center  → brand/logo (compact)
│   └── #lt-hud-right
│       ├── (visitor)  #lt-sync-btn  "Sync My View"
│       ├── (visitor)  #lt-leave-btn "Leave"
│       └── (agent)    #lt-leave-btn "Leave"   ← agent variant TBD (see Q1)
└── #lt-sync-panel (hidden by default)
    ├── step 1: Press U in the tour
    ├── step 2: Click "Copy to clipboard"
    └── step 3: [Send / paste fallback input + Send]
```

The standalone floating `#loc-sync` card and its inner `#loc-sync-instructions` (with "Share your view:" label) are **removed**. `#loc-sync-action` (the actual sync button + status + paste fallback) is moved inside `#lt-sync-panel` and keeps the same element IDs (`loc-sync-btn`, `loc-sync-status`, `loc-sync-fallback*`) so the existing JS still finds them with no rewiring.

### 2. CSS (replaces `#loc-sync*` positioning rules, ~lines 1639–1675)

```text
/* Hide the regular HUD entirely during a live tour. */
body.live-tour-active #hud-header { display:none; }
body.live-tour-active #hud-leave-btn { display:none; } /* leave now lives inside lt header */

/* Live-tour HUD: same fixed-top + chevron-driven slide pattern as #hud-header. */
#hud-header-livetour {
  position:fixed; top:0; left:0; right:0; z-index:1200;
  transform:translateY(-100%); opacity:0; pointer-events:none;
  transition:transform .3s ease, opacity .3s ease;
  display:none;
}
body.live-tour-active #hud-header-livetour { display:block; }
#hud-header-livetour.visible { transform:translateY(0); opacity:1; pointer-events:auto; }

/* Inline instructions panel — only shown after Sync My View is clicked. */
#lt-sync-panel { display:none; padding:10px 14px; background:rgba(0,0,0,.7); ... }
#hud-header-livetour.show-sync #lt-sync-panel { display:flex; }

/* Visitor-only / agent-only children */
body.live-tour-agent   #lt-sync-btn   { display:none; }
body.live-tour-agent   #lt-sync-panel { display:none !important; }
```

The standalone `#loc-sync` element + all `#loc-sync-instructions*` selectors are deleted.

### 3. JS wiring

- **Header visibility on entering Live Tour**: in `setBodyLetterboxClass(active,isAgent)`, when `active===true` ensure `#hud-header.visible` is removed, `#hud-header-livetour` exists but stays **without** the `.visible` class so it's hidden — visitor must click the chevron to open it. When `active===false`, remove `.visible` from the live-tour header and restore the regular header's previous toggle state.

- **Chevron `#hud-toggle`** (lines 2168–2211, 2449–2468): change the click handler so it toggles whichever header matches the current mode:

  ```text
  var target = document.body.classList.contains("live-tour-active")
    ? document.getElementById("hud-header-livetour")
    : document.getElementById("hud-header");
  target.classList.toggle("visible");
  ```

  Also flip the chevron up/down SVG using `target.classList.contains("visible")`. Keep the existing pulse-on-idle behavior.

- **Sync My View flow**:
  - New `#lt-sync-btn` click handler: adds `.show-sync` to `#hud-header-livetour` (reveals inline instructions + the existing `#loc-sync-btn` button inside the panel).
  - The existing `#loc-sync-btn` click (already wired to `readClipboardAndSend` / paste flow) is unchanged. After `attemptSendLocation` returns `true` (or after paste-submit success), also call `closeLtSyncPanel()`:
    - removes `.show-sync` and `.visible` from `#hud-header-livetour`
    - leaves the success/error toast visible for ~2.2s via a brief fixed-position `#loc-sync-status` clone, then resets (reuses existing `scheduleSyncIdleReset` timing).

- **Leave button**: move the `leaveBtn = document.getElementById("hud-leave-btn")` lookup to `#lt-leave-btn` (rename the element to keep behavior). The existing `teardownSession()` already does the full cleanup; only the show/hide path changes — `leaveBtn.hidden=false` runs on connect, `hidden=true` on teardown.

- **`resetLocationSyncUi()`** also removes `.show-sync` from the live-tour header so a re-join starts collapsed.

### 4. Files touched

- `src/lib/portal.functions.ts` — only file with markup, CSS, and JS for the live-tour HUD. All changes are HTML-template + interpolated CSS + IIFE JS, no backend/server changes.
- `tests/live-session.test.mjs` — no changes; controller surface (`shareLocationWithAgent`, `teleportVisitor`, etc.) is untouched.

### 5. Regression guards traced

- `#loc-sync-btn`, `#loc-sync-status`, `#loc-sync-fallback*`, `#loc-sync-spinner`, `#loc-sync-btn-text` IDs preserved → all current handlers (4518–4810) keep working without edits.
- `#loc-share-pill` (agent's incoming-share notification) is independent and untouched.
- Annotation toolbar `#anno-toolbar` lives inside `#anno-letterbox-wrap` (not in the HUD) — unaffected.
- `setBodyLetterboxClass` is the single switch — used by `onState` for both agent and visitor, so the header swap is symmetric and disposed correctly on teardown.
- Ask AI / Contact / mute / map / cinema / media / floormap buttons remain in `#hud-header` and are simply hidden by `display:none` during live tour. They reappear automatically after `teardownSession()` strips `.live-tour-active`.

## Open question

**Q1 — Agent's Live Tour HUD contents.** You only specified the visitor's side (Sync + Leave). The agent already has the in-frame annotation toolbar (Pointer / Draw / Rope / Clear / X). For the agent's Live Tour HUD bar, should it contain:

- (a) Just **Leave** (annotation toolbar inside the frame stays the only control), or
- (b) **Leave** + the **PIN reminder** ("PIN: 1234"), or
- (c) Something else?

I'll default to **(a)** if you don't specify, since the annotation toolbar already covers the agent's needs and matches your "unobstructed view" principle.
