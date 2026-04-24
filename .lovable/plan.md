## Updated diagnosis

You are right: if you hard-refreshed, regenerated, and added new Property Intelligence data, this is not adequately explained by “older build.” The stronger diagnosis is:

**The main presentation IIFE is too fragile.** It contains the critical startup code (gate-button listeners and `frame.src = props[i].iframeUrl`) and the large inlined Ask AI / Property Intelligence runtime in the same `<script>` execution context. If anything in that context throws during parse or early startup, the page fails in the exact way you see: the gate buttons do nothing and the Matterport iframe never receives its `src`.

The JSON draft itself is not the likely cause. The Matterport IDs and generated iframe URLs are valid. The issue is in how the generated HTML is structured and guarded.

## Plan

### 1. Split critical tour startup from Ask AI runtime

Refactor `src/lib/portal.functions.ts` so the core tour shell is isolated from Property Intelligence code:

- Script A: minimal bootstrap only
  - decode config
  - define `props`, `frame`, `tabsEl`, etc.
  - bind `gate-sound-btn` and `gate-silent-btn`
  - assign initial `matterport-frame.src`
  - setup tabs, HUD, contact, media modals

- Script B: Ask AI / Property Intelligence runtime
  - inlined `ASK_RUNTIME_JS`
  - `__docsQa` pipeline
  - Orama / embedding loading
  - synthesis bridge

This makes the 3D tour and start buttons independent of the AI layer. Even if AI parsing/indexing fails, the tour still opens.

### 2. Move `load(0)` earlier and make it fail-soft

Update generated runtime so the iframe `src` is assigned as early as possible and guarded:

```js
try {
  if (props.length > 0 && frame) frame.src = props[0].iframeUrl;
} catch (err) {
  console.error("presentation bootstrap failed", err);
}
```

Then the richer `load(i)` function can update HUD/docs/tabs after bootstrap. This ensures the Matterport iframe is not blocked by later HUD or AI logic.

### 3. Add visible fallback behavior for gate buttons

If a future runtime error occurs, the gate buttons should still have a minimal inline fallback. Add simple `onclick` attributes or a tiny pre-bootstrap script that hides the gate independently of the full runtime.

Goal: a future bug degrades to “HUD/Ask may be unavailable,” not “entire presentation is dead.”

### 4. Strengthen the HTML verifier

Extend `scripts/verify-portal-html.mjs` beyond escape/token checks to perform a smoke test on the assembled output:

- extract the generated main script sections;
- validate the core startup script parses independently;
- validate the Ask runtime parses independently;
- assert required startup strings exist:
  - `gate-sound-btn`
  - `gate-silent-btn`
  - `matterport-frame`
  - `frame.src=props[i].iframeUrl` or equivalent guarded bootstrap assignment

This catches broken generated HTML structure before users download it.

### 5. Add a fixture-level smoke test

Add a lightweight test script that runs against the uploaded/generated fixture shape:

- mock a tiny DOM with the gate buttons, tabs, and iframe;
- execute the bootstrap portion;
- assert:
  - the iframe gets a non-empty Matterport URL;
  - clicking `gate-silent-btn` hides the gate;
  - clicking `gate-sound-btn` does not throw.

Wire it into `npm run verify:html` or a new package script so it runs with the existing Ask runtime tests.

### 6. Verification

After implementation, run:

- `npm run verify:html`
- `npm run test:ask`
- if available, generate a fresh HTML from the same uploaded draft and inspect that:
  - the closing `</html>` is present;
  - `#matterport-frame` has an initial/assigned Matterport `src`;
  - the start buttons are bound or have fallback behavior.

## Expected outcome

The generated HTML becomes production-safe in the most important way: **the Matterport tour startup no longer depends on the Ask AI / Property Intelligence layer.** The AI layer can still fail independently, but it cannot kill the welcome gate or prevent the iframe from loading.