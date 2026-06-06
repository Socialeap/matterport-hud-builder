The current fullscreen control exists on the underlying Atlas map header, but `/atlas?spot=...` immediately opens the immersive showcase modal. That modal covers the map header, so the new button is hidden behind the modal in the exact view shown in your screenshot.

Plan:
1. Add the fullscreen toggle directly to the visible modal control bar, next to Share / Open / Close.
2. Wire it to fullscreen the modal viewer shell (`.atlas-modal-backdrop` or `.atlas-modal`) instead of only the underlying map page shell.
3. Keep the existing fallback behavior so browsers or embedded contexts that reject native fullscreen use CSS pseudo-fullscreen.
4. Make the button unmistakable with an expand/collapse icon plus an explicit accessible label/title: “Enter fullscreen” / “Exit fullscreen”.
5. Verify the actual `/atlas?spot=...` view at the screenshot-sized viewport and confirm the fullscreen button is visible in the modal controls.

Backend Activation Required: NO
Reason: UI-only change to the Atlas route and existing fullscreen hook; no backend/database/auth changes.