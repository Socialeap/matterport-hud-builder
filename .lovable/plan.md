# Fix: Atlas fullscreen button not visible

## Root cause

The button is implemented correctly in `src/routes/atlas.tsx` (header right block), but it is gated on `fsEnabled`, which reads `document.fullscreenEnabled`. That property returns `false` whenever the page is loaded inside an iframe that wasn't granted `allow="fullscreen"`.

Lovable's preview embeds the app in such an iframe, so `fsEnabled` is always `false` there and the button never renders. The same can happen in some embedded webviews on mobile. On the bare `frontiers3d.com/atlas` tab it would render, but the user has no way to confirm that from the preview, and we still want a working control in embedded contexts.

## Fix

Make the control always render, and add a CSS-based "pseudo-fullscreen" fallback when the native Fullscreen API is unavailable or rejected. Behavior:

1. Always show the toggle button in the header (drop the `fsEnabled &&` gate).
2. `toggle()` first tries the native Fullscreen API on `.atlas-shell`.
3. If the API is missing OR `requestFullscreen` rejects (typical inside iframes — "Permission denied"), fall back to toggling a `.atlas-shell--pseudo-fs` class on the shell element. That class pins the shell to `position: fixed; inset: 0; z-index: 9999;` to fill the viewport (the iframe's viewport, when embedded).
4. `Esc` key listener exits pseudo-fullscreen (the native API handles Esc itself).
5. Icon + tooltip switch between Enter/Exit based on combined state (native fullscreen OR pseudo-fullscreen active).

## Files to change

**`src/hooks/use-fullscreen.ts`**
- Remove the `isEnabled` gate from the public API (or keep it but always return `true` for "can attempt").
- Add `isPseudoFullscreen` state.
- New `toggle()` logic:
  - If currently in native fullscreen → `exitFullscreen()`.
  - Else if `isPseudoFullscreen` → clear it.
  - Else → `try { await el.requestFullscreen() } catch { setIsPseudoFullscreen(true) }`. Also fall back if `requestFullscreen` is missing.
- Add `Escape` keydown listener that clears pseudo-fullscreen.
- Apply/remove `atlas-shell--pseudo-fs` class on the target element when pseudo-fullscreen flips, so styling is purely CSS.
- Return `{ isFullscreen: nativeOrPseudo, toggle }`.

**`src/routes/atlas.tsx`**
- Remove the `{fsEnabled && (...)}` wrapper around the Tooltip; render the button unconditionally.
- Update destructuring: `const { isFullscreen, toggle: toggleFullscreen } = useFullscreen(shellRef);`

**`src/styles.css`** (atlas components layer)
- Add:
  ```css
  .atlas-shell--pseudo-fs { position: fixed; inset: 0; z-index: 9999; height: 100vh; height: 100dvh; width: 100vw; }
  ```
  `100dvh` keeps it correct on mobile browsers with dynamic toolbars.

## Compatibility notes

- Desktop Chrome/Edge/Firefox/Safari at the top level → native fullscreen, Esc exits natively.
- Inside Lovable preview iframe or any embed without `allow="fullscreen"` → automatically falls back to pseudo-fullscreen, Esc still exits.
- iOS Safari (no element fullscreen on older versions) → pseudo-fullscreen fallback.
- No changes to the showcase iframe, no backend/database/auth changes.

## Verification

- Preview iframe: button visible in header; click expands the Atlas shell to fill the preview frame; click again or press Esc restores.
- Published `frontiers3d.com/atlas` in a normal tab: button visible; click enters real browser fullscreen; Esc exits.
- Mobile width: button still visible (it lives in `.atlas-header-right`, outside the `>=768px` `.atlas-header-meta` block).

Backend Activation Required: NO
Reason: UI-only change in the Atlas page hook, route, and stylesheet.
