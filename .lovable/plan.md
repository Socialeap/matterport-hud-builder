## Visitor freeze never engages — root cause and fix

### Root cause (single bug)

The wire protocol, the `nav_lock` send/receive, the `applyNavLock()` toggle, and the `#live-tour-navlock` overlay element are all wired correctly. The overlay even gets the `.locked` class on the visitor when the agent enters annotation mode.

The freeze still fails because of one CSS gate. In `src/lib/portal.functions.ts` line 1622:

```css
body.live-tour-active.live-tour-visitor #live-tour-navlock.locked{display:block}
```

…requires **both** `live-tour-active` and `live-tour-visitor` body classes. But `setBodyLetterboxClass(active, isAgent)` (lines 3934–3944) only ever adds `live-tour-active` and `live-tour-agent` — there is no code path anywhere that adds `live-tour-visitor`. So on the visitor side, the selector never matches, the overlay stays at `display:none`, and pointer/touch events fall straight through to the Matterport iframe behind it. The agent's own iframe also freezes (because the canvas above intercepts pointer events when a tool is active) — which is why only the visitor side appears broken.

### Fix

Two surgical edits in `src/lib/portal.functions.ts`, both inside `setBodyLetterboxClass`:

1. When `active && !isAgent`, add `live-tour-visitor` to `document.body.classList`.
2. In the `else` branch (teardown), also remove `live-tour-visitor`.

Resulting function:

```js
function setBodyLetterboxClass(active,isAgent){
  if(!document||!document.body) return;
  if(active){
    document.body.classList.add("live-tour-active");
    if(isAgent){
      document.body.classList.add("live-tour-agent");
      document.body.classList.remove("live-tour-visitor");
    } else {
      document.body.classList.add("live-tour-visitor");
      document.body.classList.remove("live-tour-agent");
    }
  } else {
    document.body.classList.remove("live-tour-active");
    document.body.classList.remove("live-tour-agent");
    document.body.classList.remove("live-tour-visitor");
  }
}
```

### Defense-in-depth (optional second edit, included for safety)

To eliminate any possibility of the iframe stealing pointer events even when the overlay is shown, add `pointer-events:none` to the iframe while the visitor is locked. Append one rule next to line 1622:

```css
body.live-tour-active.live-tour-visitor #live-tour-navlock.locked ~ #matterport-frame,
body.live-tour-active.live-tour-visitor #anno-letterbox-wrap:has(#live-tour-navlock.locked) #matterport-frame{pointer-events:none}
```

(Either selector works on all evergreen browsers we ship to; the `:has()` form is the cleaner one and we already use modern CSS elsewhere in this stylesheet.) This guarantees freeze even if a future change reorders DOM nodes inside `#anno-letterbox-wrap`.

### Verification

- Trace: `session.sendNavLock` → wire → `incomingNavLockEvent` → `applyNavLock(true)` (line 4817) → overlay gets `.locked` → CSS selector now matches because both body classes are present → overlay covers iframe → visitor cannot pan/click.
- Auto-release paths (`setToolMode("none")`, X button, teardown, `incomingClearEvent`) all remain intact — none of them depend on the body class.
- Agent role unchanged: agent body still gets `live-tour-agent`, never `live-tour-visitor`, so the agent's own iframe is unaffected by the new overlay rule.
- No wire-protocol changes, no test changes required (existing `tests/live-session.test.mjs` already covers send/receive of `nav_lock`).
- Backward compatible: any older clients still don't send/receive `nav_lock` and behave exactly as before.

### Files touched

- `src/lib/portal.functions.ts` — 1 function body (≈7 lines) + 1 optional CSS rule.

### Out of scope

- No changes to `live-session.mjs`, `live-session-source.ts`, or tests.
- No changes to the rope tool, draw tool, color picker, X exit button, or teleport flow.
