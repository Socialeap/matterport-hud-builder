# Fix: Netlify Popup Opens Blank — Keep Sized Popup Window

## Root cause

In `src/components/portal/PublishDistributeSection.tsx` (`openNetlifyPublishWindow`, ~lines 199–241) the features string passed to `window.open` mixes two kinds of tokens:

```
width=… height=… left=… top=… resizable=yes scrollbars=yes noopener noreferrer
```

`noopener` and `noreferrer` are NOT valid window-feature dimensions — they are post-spec keywords that the HTML standard treats specially when present in the features string:

1. **`noopener` makes `window.open` return `null`.** That immediately falls into our `else` branch and sets `setNetlifyBlocked(true)`, showing the amber "popup blocked" warning even though the popup did open.
2. **`noreferrer` strips the `Referer` request header AND forces no-opener semantics.** `app.netlify.com/drop` reads `document.referrer` during boot and sets `Cross-Origin-Opener-Policy: same-origin`; with no referrer + popup chrome + a named window, the SPA shell fails to hydrate → **white page**. This is the blank window the user is seeing.

Neither token is needed inside the features string. Cross-window isolation can be achieved safely by nulling `publishWindow.opener` after open (the code already attempts this on line ~230, but never reaches it because `publishWindow` is `null`).

The recent Mattertag/video/numbering edits did NOT touch this file — this regression is isolated to the popup features string.

## Fix (single-file, surgical)

**`src/components/portal/PublishDistributeSection.tsx`** — `openNetlifyPublishWindow` only.

1. Remove `"noopener"` and `"noreferrer"` from the `features` array. Keep every dimension/behavior token exactly as configured:
   - `width=${width}` (≥420, ~⅓ of outer width)
   - `height=${height}` (≥480, ~½ of outer height)
   - `left=${left}` (right side of screen, 24px from edge)
   - `top=${top}` (vertically centered)
   - `resizable=yes`
   - `scrollbars=yes`
2. Keep the `try { publishWindow = window.open(NETLIFY_DROP_URL, "netlifyPublishWindow", features) } catch { publishWindow = null }` wrapper unchanged.
3. Keep the **defensive `publishWindow.opener = null`** assignment after a successful open. With `noopener` removed from the feature string, `window.open` now returns a real `Window` reference, so this null-out actually executes and gives us the same cross-origin isolation we wanted from `noopener` — without breaking Netlify's boot.
4. Keep the existing branching:
   - On success → `setNetlifyOpened(true); setNetlifyBlocked(false)` (button label flips to "Reopen Netlify Publish Window", the green/muted "Netlify is open" hint with the 5-step checklist renders).
   - On `null` (genuine popup blocker) → `setNetlifyBlocked(true)` (amber fallback with the "Open Netlify Drop in New Tab" anchor remains visible).

Nothing else in the file is touched:
- Sizing math (`width`, `height`, `left`, `top` calculations) — unchanged.
- "Open Netlify Drop in New Tab" anchor fallback — unchanged.
- Step 1 download button, Step 3 URL parsing, Share Kit, QR canvas/PNG export — unchanged.
- All useCallback/useMemo dependency arrays — unchanged (function identity unchanged).

## Ripple / regression audit

- **Other components**: `PublishDistributeSection` is consumed by the builder page only; no shared utility is touched, so HudPreview, the Mattertag proxy, video-embed, card numbering, and the standalone end-product generator are unaffected.
- **Security**: cross-origin opener access is still blocked because we null `publishWindow.opener` immediately. Netlify is cross-origin so it cannot read our window even before the null-out. Referrer is sent normally — appropriate, since Netlify is a trusted third party we're intentionally handing off to.
- **Popup blockers**: triggered from a synchronous user click handler → permitted by all major browsers; behavior matches what worked previously.
- **Reopen flow**: same `windowName` ("netlifyPublishWindow") means subsequent clicks focus/reuse the existing popup rather than spawning duplicates — preserved.

## Verification

1. Click **Open Netlify Publish Window** → a small popup window opens at the right side of the screen at the configured ⅓×½ size, loaded with the Netlify Drop UI (no blank page).
2. Button label flips to **Reopen Netlify Publish Window**; the "Netlify is open" instruction card with the 5-step checklist renders; amber "popup blocked" warning does NOT show.
3. Click **Reopen Netlify Publish Window** → existing popup is refocused (not duplicated).
4. If the browser's popup blocker actually blocks it (e.g., user has popups disabled), amber fallback appears with the "Open Netlify Drop in New Tab" anchor — unchanged behavior.
5. Smoke-check unrelated areas to confirm no regression: Features-card image thumbnails (Mattertag proxy), video player playback (youtube-nocookie), card numbering position, Share Kit generation after pasting a live URL.
