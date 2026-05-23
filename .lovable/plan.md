## Goal

Polish the Property Features drawer cards in `src/components/portal/HudPreview.tsx`:

1. Move the per-card number badge from top-right (inside card) to center-left (outside the card edge).
2. Remove the redundant "Open Media" button — the thumbnail is already clickable.
3. Show a thumbnail for video tags (not just images), reusing the same click-to-open-internal-player behavior.

Scope is purely presentational — no schema, no importer, no backend changes.

## Changes

### 1. `src/lib/video-embed.ts` — add `getVideoThumbnail(url)`

Pure, synchronous helper that returns a thumbnail URL when one can be derived from the URL alone:

- **YouTube** → `https://img.youtube.com/vi/<id>/hqdefault.jpg` (always available, no API call).
- **Vimeo** → `https://vumbnail.com/<id>.jpg` (free public thumbnail proxy; falls back gracefully via `onError`).
- **Wistia / Loom / direct mp4** → return `""` (no reliable synchronous thumbnail; card simply renders without one, same as today).

Reuses the same regex matchers already in `parseCinematicVideo` so we stay consistent with what the cinema modal can actually play.

### 2. `src/components/portal/HudPreview.tsx` — feature card render block (≈ lines 1022–1122)

- **Thumbnail source** — extend the existing `thumbUrl` derivation:
  ```
  image media       → tag.media
  else scraped image in description → that URL
  else video media (YouTube/Vimeo)  → getVideoThumbnail(tag.media)
  else                              → none
  ```
  Click handler stays `openMattertagMedia(mediaUrl, label, id)` — already routes images, YouTube, Vimeo, etc. through the internal player.
- Add `onError` fallback on the `<img>` to hide the thumbnail wrapper if the video thumbnail 404s (matches current image behavior).
- For video thumbnails, overlay a small play-triangle glyph on the thumbnail so users know it plays a video (reuses the same SVG currently inside the Open Media button).

- **Remove the "Open Media" button block** entirely (current lines 1103–1119). The thumbnail click already opens the media player. Tags with no thumbnail (text-only / external-link-only) will simply show label + description + link chips, which is the correct outcome since there is nothing to play.

- **Move the number badge externally to center-left**:
  - Replace `absolute right-2 top-2` with `absolute -left-3 top-1/2 -translate-y-1/2`.
  - Add `pl-4` to the cards container (`flex flex-col gap-2.5`) so the badges sit in clear space inside the drawer's existing `p-4` (no horizontal clipping; the drawer only sets `overflow-y-auto`).
  - Remove the now-unneeded `pr-7` from the label `<p>` (it was reserving space for the old top-right badge).

### 3. Verification

- Test model with: image tag ("View Our Food Menu"), YouTube tag, text-only tag, external-link-only tag.
- Confirm:
  - Image tag — thumbnail renders, click opens internal image viewer, no Open Media button.
  - YouTube tag — `img.youtube.com/vi/<id>/hqdefault.jpg` thumbnail renders with play overlay, click opens cinema modal, no Open Media button.
  - Text-only tag — no thumbnail, no button, just label/description (unchanged).
  - External link tag (social) — link chips render; no media button (unchanged).
  - Number badges sit on the outside-left of each card, vertically centered, accent-colored, not clipped.
- No changes to `fetch-mattertags`, `portal.functions.ts`, `types.ts`, or the standalone generation pipeline.

## Files changed

- `src/lib/video-embed.ts` — add `getVideoThumbnail` export.
- `src/components/portal/HudPreview.tsx` — card render block only.
