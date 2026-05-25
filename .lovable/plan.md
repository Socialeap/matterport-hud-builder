## Problem

The Netlify Drop window is opening as a regular browser tab instead of a floating popup window over the /builder page.

In `src/components/portal/PublishDistributeSection.tsx` (`openNetlifyPublishWindow`, lines 243–286), the `features` string passed to `window.open` includes `width`, `height`, `left`, `top`, `resizable`, and `scrollbars` — but it is missing the `popup=yes` token.

Per the modern HTML spec and Chromium's window-opening behavior, Chrome (and Edge) now require an explicit `popup=yes` (or `popup=1`) in the features string to force popup/window chrome. Without it, browsers are free to honor the user's preference and open the URL as a regular tab, ignoring the size/position hints entirely. Firefox and Safari are more lenient and still honor size hints, but Chrome — which is what the user is on — does not.

This regressed when the prior `noopener`/`noreferrer` flags were removed; the original popup behavior in older builds either relied on different feature semantics or happened to satisfy Chrome's heuristics. Now the call falls through Chrome's "open as tab" path.

## Fix

Single, surgical change in `src/components/portal/PublishDistributeSection.tsx` — add `"popup=yes"` to the `features` array (lines 253–260). Leave every other line of the function untouched, including:

- the manual `publishWindow.opener = null` cleanup (already preserves cross-origin isolation),
- the `setNetlifyOpened` / `setNetlifyBlocked` logic (still works because `popup=yes` does NOT cause `window.open` to return `null` on success — only `noopener` does),
- width/height/left/top centering math,
- the warning UI shown when a real popup block occurs.

### Exact change

In the `features` array:

```text
const features = [
  "popup=yes",            // ← add as first entry
  `width=${width}`,
  `height=${height}`,
  `left=${left}`,
  `top=${top}`,
  "resizable=yes",
  "scrollbars=yes",
].join(",");
```

## Why this is the right fix

- `popup=yes` is the documented signal to Chromium/WebKit that the caller wants a popup window with chrome reduced, sized and positioned per the other hints — not a tab.
- It does not affect the `Window | null` return contract (unlike `noopener`), so the existing "popup blocked" detection (`if (publishWindow) … else setNetlifyBlocked(true)`) keeps working correctly.
- No other browsers regress: Firefox/Safari already treat sized window.open as a popup and ignore unknown tokens gracefully.

## Verification

1. From /builder, click **Open Netlify Publish Window** → Netlify Drop opens as a small floating popup window (560×760, centered), NOT as a new tab. The 3DPS /builder page remains visible behind/beside it.
2. Block popups for the site in Chrome → click again → popup is blocked, the existing warning message appears (unchanged behavior).
3. The "Open Netlify Drop in New Tab" fallback link continues to open a full tab as before.
4. The popup cannot navigate the parent 3DPS tab (`opener` is already nulled).

## Scope

- Files touched: **1** — `src/components/portal/PublishDistributeSection.tsx`
- Lines changed: **1** (added inside the `features` array)
- No routes, server functions, DB, auth, Stripe, styles, or other components affected.
- No new dependencies.
