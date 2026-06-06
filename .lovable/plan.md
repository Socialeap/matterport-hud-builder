## Plan: Fullscreen Toggle for /Atlas Page

### Overview
Add a clearly visible fullscreen toggle button to the Atlas page header. Clicking it enters/exits browser fullscreen mode for the entire Atlas page, hiding browser chrome to maximise the map and listing view.

### Browser & Mobile Compatibility
The Fullscreen API is supported in:
- Chrome/Edge (all versions)
- Firefox (all versions)
- Safari 16+ (macOS) and iOS 15.4+ (any element)
- Android Chrome (all versions)

The button will be **hidden on browsers that do not expose the API** (graceful degradation). On iPhones running older iOS, the button simply won't appear — no broken UI.

### Files to Change

| File | Change |
|---|---|
| `src/hooks/use-fullscreen.ts` | **New hook.** Wraps `requestFullscreen` / `exitFullscreen`, listens to `fullscreenchange`, exposes `isFullscreen`, `isEnabled`, `toggle()`. |
| `src/routes/atlas.tsx` | Import hook + `Maximize2`/`Minimize2` icons. Add toggle button to `<header className="atlas-header">`. |
| `src/styles.css` | Add `.atlas-fullscreen-btn` styles (dark-themed, bordered, 36×36 px, hover transition, visible on all screen sizes). |

### Button Placement
Placed as the **last child** of `.atlas-header`, sitting to the right of the existing meta block on desktop and alone on the right on mobile (the meta block is hidden below 768 px, but the button remains visible).

### Button Behaviour
- **Icon:** `Maximize2` when not fullscreen, `Minimize2` when fullscreen.
- **Tooltip:** "Enter fullscreen" / "Exit fullscreen" via existing `<Tooltip>` infrastructure.
- **Touch target:** 36 × 36 px (above the 44 px recommendation where possible without breaking header height; the header is 64 px tall so 36 px fits comfortably).
- **Keyboard:** `Esc` already exits fullscreen natively; no extra wiring needed.

### Technical Details

**Hook signature:**
```ts
function useFullscreen(targetRef: RefObject<Element>): {
  isFullscreen: boolean;
  isEnabled: boolean;
  toggle: () => void;
}
```

**Atlas page wiring:**
1. Create a `shellRef = useRef<HTMLDivElement>(null)` on `.atlas-shell`.
2. Pass `shellRef` to `useFullscreen`.
3. In the header, render:
   ```tsx
   {isEnabled && (
     <Tooltip …>
       <button
         onClick={toggle}
         className="atlas-fullscreen-btn"
         aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
       >
         {isFullscreen ? <Minimize2 /> : <Maximize2 />}
       </button>
     </Tooltip>
   )}
   ```

**CSS additions:**
- `.atlas-fullscreen-btn` — `display:inline-flex`, `align-items:center`, `justify-content:center`, `width:2.25rem`, `height:2.25rem`, `background:#0f172a`, `border:1px solid #1e293b`, `border-radius:0.5rem`, `color:#e2e8f0`, hover → `background:#1e293b`, `border-color:#334155`, `color:#fff`.
- Same visual language as the existing map zoom controls (`.atlas-map-ctrl`) for consistency.

### Out of Scope
- No changes to the embedded showcase iframe (fullscreen inside the modal is handled by the showcase's own player, not this page-level toggle).
- No backend, database, or auth changes.

### Verification Steps
1. Load `/atlas` on desktop — button visible in header, right side.
2. Click button — page enters fullscreen, icon flips to `Minimize2`.
3. Press `Esc` — exits fullscreen, icon flips back.
4. On mobile (or emulated) — button visible; tap toggles fullscreen where supported.
5. On browsers without Fullscreen API — button hidden, page renders normally.
