## What's broken

1. **Photo Mattertags show no thumbnail.** Both the Builder preview (`HudPreview.tsx`) and the generated runtime (`portal.functions.ts`) only accept `tag.media` as a thumbnail when the URL ends in `.jpg/.png/.gif/.webp/.avif`. Matterport's CDN/photo URLs typically don't carry an extension before the query string, so the regex fails and no `<img>` is rendered. The `findImageUrlIn(description)` fallback also requires an extension, so it doesn't recover.

2. **YouTube "Open Media" opens a new tab.** `openMattertagMedia` (preview) and `window.__openMattertagMedia` (runtime) only treat URLs ending in `.mp4/.webm/.mov/.m4v` as in-app video. Anything else — including all YouTube/Vimeo/Loom/Wistia URLs — falls into the `window.open(..., "_blank")` branch. The cinematic player that already exists in the codebase (`CinemaModal` in React, `cinema-modal` + `parseCinematicUrl` in runtime) is never consulted.

## Fix overview

Apply two surgical, frontend-only changes to both surfaces in lockstep so the Builder preview and the exported `.html` behave identically. No backend, edge-function, schema, or routing changes.

### Fix A — Permissive thumbnail detection

Treat `tag.media` as an image candidate unless it is provably a video (file extension `.mp4/.webm/.mov/.m4v`) or a known hosted-video URL (YouTube, Vimeo, Loom, Wistia — detected with the existing `parseCinematicVideo` / `parseCinematicUrl` helpers).

- `thumbUrl = isLikelyImage(tag.media) ? tag.media : findImageUrlIn(description)`
- `isLikelyImage(u)`: non-empty AND not a video extension AND not a hosted-video URL.
- The existing `<img onError>` handler already removes/hides the thumbnail button if a non-image slips through, so this is safe — a broken-image flash is the worst-case fallback, and it self-heals.

### Fix B — Route hosted video through the in-app cinema player

Update the media open handler to inspect the URL with the existing cinematic parser before deciding how to display it:

Priority order (both surfaces):
1. Direct image extension → existing `MediaCarouselModal` photo branch (preview) / `renderCarousel` photo branch (runtime).
2. Direct video extension → existing `MediaCarouselModal` video branch / `renderCarousel` video branch.
3. `parseCinematicVideo` / `parseCinematicUrl` returns iframe or mp4 → open the **existing** `CinemaModal` (preview) / `cinema-modal` (runtime). Reuses the same player Cinematic Video already uses.
4. Otherwise → unchanged `window.open(..., "_blank")` fallback for genuinely-non-media external links.

For images where we can't be sure (no extension, not a known video host), step 1's permissive detection kicks in — the image carousel attempts to load it, and `onError` hides it if it isn't actually an image.

## Files to change

### `src/components/portal/HudPreview.tsx`

- Add a small `mattertagCinemaUrl` state alongside `mattertagMediaAsset`.
- Rewrite `openMattertagMedia(mediaUrl, label, tagId)`:
  - Import `parseCinematicVideo` (already exists in `src/lib/video-embed.ts`, already used by `CinemaModal`).
  - If `isLikelyImage` → carousel photo asset (current behavior).
  - Else if direct video file → carousel video asset (current behavior).
  - Else if `parseCinematicVideo(url).kind !== "invalid"` → `setMattertagCinemaUrl(url)`.
  - Else → `window.open`.
- Update `tagMediaIsImage` / `thumbUrl` resolution in the card-render loop to use the new permissive `isLikelyImage` helper so photo thumbnails appear.
- Mount a second `<CinemaModal open={!!mattertagCinemaUrl} ... />` next to the existing one, isolated from the property-level cinematic state so closing it doesn't affect the main player.

### `src/lib/portal.functions.ts`

- Mirror the same helpers (`isLikelyImage`, hosted-video detection via existing `parseCinematicUrl`) inside the IIFE so the exported `.html` carries the same logic.
- Update `renderMattertags`' `thumbUrl` resolution to use `isLikelyImage(tag.media)`.
- Update `window.__openMattertagMedia(tagIdx, overrideUrl)`:
  - Image path → unchanged (loads into `carousel-modal`).
  - Video-file path → unchanged.
  - New iframe/mp4-parsable path: temporarily inject the parsed embed into `#cinema-content` (same pattern `__openModal('cinema')` uses at lines 3424-3428) and open `cinema-modal`. To avoid clobbering the property's own cinematic video on next close/reopen, set the iframe directly and add a close hook (or just let `__closeModal('cinema')` clear `cinema-content` as it already does at line 3458 — verified safe).
  - Fallback to `window.open` only for truly unparseable URLs.

## What's intentionally NOT changing

- `extractMattertagLinks` (URL-stripping for descriptions) — already correct from the previous turn.
- Numbered badge, "(beta)" label, link-icon rendering — already correct.
- Deep-link card-click → `__navigateToMattertag` behavior — unchanged; the new media handler still `stopPropagation()`s so it never double-fires.
- Regular media gallery (`carouselMedia` from `props[current].multimedia`) — fully isolated; the synthetic single-asset payload is overwritten on the next `__openModal('carousel')` call as it is today.
- Backend, RLS, edge functions, Supabase config — untouched.

## Verification checklist

After implementation, in both the Builder preview AND a freshly-downloaded `.html`:

1. A Mattertag whose `tag.media` is a Matterport-hosted photo (no `.jpg` extension) shows a thumbnail in its card.
2. Clicking that thumbnail opens the in-app `MediaCarouselModal` / `carousel-modal` with the photo — not a new tab.
3. A Mattertag with a YouTube `tag.media` shows the "Open Media" CTA; clicking it opens `CinemaModal` / `cinema-modal` inline with the YouTube embed autoplaying — NOT a new browser tab.
4. Vimeo, Loom, Wistia, and direct `.mp4` URLs also open inline (carousel for direct mp4, cinema modal for hosted).
5. A Mattertag with a non-media external link (e.g. a PDF or listing page) still opens in a new tab (unchanged).
6. Closing the Mattertag cinema modal does not break the property-level "Cinematic Video" button (re-open it and confirm the original cinematic video still plays).
7. Card-body click on a deep-link-capable Mattertag still triggers the tour camera jump; clicking the thumbnail or "Open Media" CTA does not trigger the jump.
