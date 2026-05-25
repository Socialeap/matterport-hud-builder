## Why the last fix failed

Adding `popup=yes` is correct per spec and is necessary, but on its own it is not always sufficient in current Chromium. Two things in the existing call are working against us:

1. **Named target reuse.** We pass `"netlifyPublishWindow"` as the second argument to `window.open`. Once Chrome has ever resolved that name to a tab in the current session (which happened during the time the bug was live), subsequent calls re-target the *same* browsing context and silently ignore the `features` string — so even with `popup=yes` it keeps opening as a tab.
2. **No verification.** We mark the open as successful as soon as we get a non-null `Window` back. A tab is also a non-null `Window`, so we cannot tell from the return value alone whether Chrome honored the popup hint, and the user gets no recovery path.

The user has confirmed the failure reproduces on the published site (not just the Lovable preview iframe), so this is a code/browser-contract issue, not a sandbox issue.

## Fix (single file: `src/components/portal/PublishDistributeSection.tsx`)

Surgical changes inside `openNetlifyPublishWindow` (lines 243–287) and the small status block beneath the button (lines 448–454). No other files, routes, server functions, styling tokens, or flows touched.

### 1. Use `_blank` instead of a fixed name

Change the second arg of `window.open` from `"netlifyPublishWindow"` to `"_blank"`. This prevents Chrome from re-binding to a previously-opened tab and forces it to evaluate the `features` string fresh on every click.

Trade-off: clicking the button twice will open two popups instead of focusing the existing one. We handle that by tracking the last opened `Window` in a ref and calling `.focus()` / `.close()` on the prior one before opening a new one — so behavior from the user's perspective is unchanged (one window, reopen works).

### 2. Keep `popup=yes` and tighten the features string

Keep the existing `popup=yes,width,height,left,top,resizable,scrollbars` set. Ensure no whitespace in the joined string (already the case). Leave the manual `publishWindow.opener = null` line intact.

### 3. Detect "opened as a tab" after the call

After `window.open` returns, schedule a one-shot check on the next animation frame:

```text
requestAnimationFrame(() => {
  if (!publishWindow || publishWindow.closed) return;
  // A real popup honors the size hint within ~5px; a tab returns the
  // full browser viewport (typically >> 560×760).
  const looksLikePopup =
    publishWindow.outerWidth  > 0 &&
    publishWindow.outerHeight > 0 &&
    publishWindow.outerWidth  <= width  + 40 &&
    publishWindow.outerHeight <= height + 80;
  setNetlifyOpenedAs(looksLikePopup ? "popup" : "tab");
});
```

Cross-origin access to `outerWidth`/`outerHeight` on a same-noopener popup is allowed (these are not protected by the cross-origin policy — only DOM/document access is). If for any reason the read throws, we treat it as "unknown" and fall back to the same UX as "tab".

### 4. Replace the misleading warning with a three-state status

Today the block beneath the button has only two states (silent / "popup blocked"). Replace with:

- **opened as popup** → existing green "Netlify is open" instructions (unchanged copy).
- **opened as tab** → new neutral notice: *"Your browser opened Netlify in a regular tab instead of a floating window. You can keep using it there, or click below to retry as a floating window."* + a "Retry as floating window" button that closes the existing tab/window (via the stored ref) and calls `openNetlifyPublishWindow` again. After 2 consecutive tab outcomes, swap the retry button for permanent guidance: *"Your browser is configured to open new windows as tabs. Use the 'Open Netlify Drop in New Tab' link — it works identically."*
- **blocked (null return)** → existing amber "popup blocked" warning (unchanged copy).

State is tracked with a single `netlifyOpenedAs: "popup" | "tab" | "blocked" | null` replacing the current `netlifyOpened` + `netlifyBlocked` pair. The retry-count is a `useRef<number>` so it doesn't trigger re-renders.

### 5. Bookkeeping

- Track the last opened popup in `const lastPublishWindowRef = useRef<Window | null>(null)`; on each new open, `try { lastPublishWindowRef.current?.close(); } catch {}` first so we never accumulate windows.
- On component unmount, attempt the same close (best-effort, ignore errors).

## What this gives the user

1. On a normal Chrome/Edge/Firefox/Safari install on the published site, Netlify Drop opens as the 560×760 floating popup over `/builder` — restored behavior.
2. If the browser (or an extension, or a Chrome setting) demotes the popup to a tab, we **detect it**, tell the user honestly, and offer one-click retry. After a second tab-outcome we stop pestering and point them at the existing "Open in New Tab" link.
3. The false "popup blocked" warning disappears in every case where a window actually opened — that misfire is fully gone.
4. Reopen still focuses a single window; no popup pileup.

## Verification checklist

- Published site, default Chrome → click button → popup opens at 560×760, status shows "Netlify is open".
- Published site, click again → previous popup closes, new one opens, no pile-up.
- Chrome with popup blocker enabled for the site → status shows the amber "popup blocked" warning (unchanged).
- Chrome with extension forcing popups to tabs (or `chrome://flags` equivalent) → status shows the new "opened as tab" notice with retry; after second tab outcome, shows the permanent guidance.
- TypeScript build clean; no other components import the removed `netlifyOpened`/`netlifyBlocked` names (they are local component state, confirmed by file scan).

## Scope

- Files touched: **1** — `src/components/portal/PublishDistributeSection.tsx`.
- ~30–40 lines changed within the existing function and its adjacent status JSX.
- No deps, no routes, no server fns, no DB, no styling tokens, no other components.
