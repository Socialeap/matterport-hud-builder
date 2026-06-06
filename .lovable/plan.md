## Findings

- The fullscreen control is now present and working in the Atlas modal toolbar.
- On mobile and tablet, the embedded showcase content has its own top bar directly under the modal controls. The current fullscreen button is icon-only and competes with Share/Open/Close, so it is easy to miss and can feel like part of a small floating icon cluster rather than a primary viewer action.
- The safer fix is not to depend on the underlying page header on small screens. The visible modal toolbar should explicitly prioritize fullscreen for touch devices.

## Safe fix

1. Update `src/routes/atlas.tsx`
   - Keep the existing desktop modal fullscreen icon.
   - Add a mobile/tablet-only, clearly labeled fullscreen button inside the visible modal controls area.
   - Preserve the existing `useFullscreen(modalRef)` behavior and native/CSS fallback.
   - Keep Share, Open, and Close available.

2. Update `src/styles.css`
   - Make `.atlas-modal-controls` responsive:
     - Desktop: keep the compact right-aligned icon row.
     - Tablet/mobile: use a two-row/wrapping control layout where the fullscreen action has a text label like `Fullscreen` / `Exit full` and a larger touch target.
   - Ensure controls stay above the embedded iframe/showcase with explicit sizing and z-index.
   - Avoid hiding controls at narrow widths and prevent overflow/clipping on 320px-wide phones.

3. Verify
   - Check `/atlas?spot=b3b73f4d-f042-4b54-b4bb-153073fb90e6` at phone, tablet, and desktop viewport sizes.
   - Confirm the fullscreen button is visibly present before interaction and still toggles fullscreen/pseudo-fullscreen.
   - Confirm no backend changes are required.

## Backend Activation Required

NO

Reason: This is a frontend-only responsive layout and UI visibility fix for the Atlas page.