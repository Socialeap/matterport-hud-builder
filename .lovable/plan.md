## Direct answer
No — my first pass did not sufficiently account for the existing embed-preview work. I searched it now and found the prior PR functionality:

- `issue_studio_preview_token(...)` / `verify_studio_preview_token(...)` exist in the database migrations.
- `/p/$slug` already recognizes `?embed=studio-preview&previewToken=...` and treats a verified token as an allowed embedded preview.
- That path is dashboard-owner preview plumbing, not currently wired into `/atlas`.

The screenshot also reveals a simpler active bug: the Atlas modal iframe container appears to have no usable height, so the modal collapses to header/footer and only shows the fallback “Open in new tab” experience.

## Corrected implementation plan

1. **Fix the Atlas modal frame collapse**
   - Give the Atlas modal an explicit responsive height.
   - Give `.atlas-modal-frame` a stable minimum height / flex basis so the iframe is visible inside the popup.
   - Keep the existing header, close button, and fallback link.

2. **Reuse existing presentation/embed behavior where appropriate**
   - Keep public/active Atlas listings loading their `presentation_url` directly inside the iframe.
   - Do not use dashboard preview tokens for public Atlas visitors, because `issue_studio_preview_token` requires an authenticated owner/admin and is intentionally scoped to dashboard previews.
   - If an Atlas listing points to an internal `/p/{slug}` URL, preserve same-page iframe loading rather than opening a new browser tab.

3. **Make the fallback less misleading**
   - Do not show the “refused to embed” warning merely because the iframe took longer than 6 seconds or because the frame area was collapsed.
   - Keep “Open in new tab” available as a secondary fallback only.

4. **Verify both Step Inside entry points**
   - Pinned map card → opens modal with visible embedded presentation.
   - Sidebar card → opens the same modal with visible embedded presentation.
   - Confirm the user remains on `/atlas` unless they explicitly click “Open in new tab”.

## Expected files to change
- `src/styles.css`
- `src/routes/atlas.tsx` only if the fallback/load messaging needs a small adjustment.

## Backend Activation Required
NO

Reason: The relevant backend token functions already exist, and this bug is in the Atlas frontend modal/embed presentation behavior. No migrations, auth changes, storage changes, RLS changes, or secrets are required.