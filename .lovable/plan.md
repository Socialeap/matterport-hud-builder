Root cause found: the new stable `/api/mp-attachment?...` URLs are valid relative image URLs in the Builder preview, but the export-generation sanitizer in `src/lib/portal.functions.ts` currently keeps only `http(s)` Mattertag media. That strips every proxy-backed uploaded image from generated presentations, so feature cards render without thumbnails and the media player has no image URL to open. There is also a second runtime mismatch: the generated HTML media-player opener still detects images only by file extension, so `/api/mp-attachment?...` would not open as an image even if preserved.

Plan:

1. Preserve safe Mattertag attachment proxy URLs during export
   - Update only the Mattertag media sanitization in `src/lib/portal.functions.ts`.
   - Keep existing `http(s)` media support unchanged.
   - Add a strict allow-list for same-origin `/api/mp-attachment` URLs with valid query parameters: `m` and `t` as 11-character Matterport IDs, `id` as a 16-64 character alphanumeric attachment ID.
   - Reject all other relative URLs so no broad URL-sanitization hole is introduced.

2. Make generated HTML route proxy-backed images into the media player
   - In the generated runtime’s `window.__openMattertagMedia`, replace extension-only image/video checks with the existing `classifyMediaUrl(url)` helper already used by the card renderer.
   - Treat `classifyMediaUrl(url) === "image"` as a photo, including `/api/mp-attachment?...`.
   - Treat `"videoFile"` as direct video and keep hosted video behavior unchanged.
   - Leave external/social/document handling unchanged.

3. Keep Builder preview and import flow untouched
   - Do not modify `HudPreview.tsx`, `fetch-mattertags`, video thumbnail logic, Netlify popup code, routing, database schema, or generated route files.
   - This avoids repeating the recent regression pattern where unrelated systems were changed while fixing media handling.

4. Verification
   - Run a focused static trace after the edit to confirm `/api/mp-attachment` is accepted in export sanitization and classified as an image at runtime.
   - Run the relevant targeted tests/scripts available for exported portal HTML integrity if appropriate, without touching unrelated code paths.

Expected result:
- Imported uploaded-image Mattertags keep their thumbnail source in generated presentations.
- Feature-card thumbnails render again.
- Clicking those thumbnails opens the image in the existing media player.
- Video thumbnails and internal video playback remain unchanged.