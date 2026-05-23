# Fix: YouTube "Error 153" in Mattertag video player

## Root cause

The YouTube embed URL is built in two places, and both return `www.youtube.com/embed/<id>?...`:

- `src/lib/video-embed.ts` → used by the React `CinemaModal` (admin preview, builder, public `/p/<slug>/demo`).
- `src/lib/portal.functions.ts` (the standalone-HTML twin parser at line 2557) → used by the generated end-product HTML.

Both files' own comments document that the fix for Error 153 ("Video player configuration error") is to embed via **`www.youtube-nocookie.com/embed/<id>`** — YouTube's official share-embed host, which is more tolerant of strict referrer policies and being nested inside another iframe (which is exactly the Lovable preview situation). Somewhere along the way the host was reverted to `www.youtube.com` while the rationale in the comments stayed. That is the regression.

Recent UI work (card numbers, thumbnails, removing "Open Media") did not touch player wiring. The click path
`thumb → openMattertagMedia(tag.media) → CinemaModal videoUrl={tag.media} → parseCinematicVideo` is intact. The broken piece is purely the embed URL string.

## Changes

### 1. `src/lib/video-embed.ts` — YouTube branch of `parseCinematicVideo`

Swap host to `www.youtube-nocookie.com` and keep all current params (rel, modestbranding, playsinline, autoplay, mute). Same params satisfy autoplay policy + iOS inline.

```
embedUrl: `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&modestbranding=1&playsinline=1&autoplay=1&mute=1`
```

No change to `getVideoThumbnail` — `img.youtube.com/vi/<id>/hqdefault.jpg` is the right thumbnail host and is unaffected.

### 2. `src/lib/portal.functions.ts` — `parseCinematicUrl` (≈ line 2557)

Same one-line host swap so the generated standalone HTML stays in sync:

```
src:"https://www.youtube-nocookie.com/embed/"+yt[1]+"?rel=0&modestbranding=1&playsinline=1&autoplay=1&mute=1"
```

No other code in `portal.functions.ts` needs to change. `classifyMediaUrl`, `isPlayableMedia`, `__openMattertagMedia`, and the cinema-modal `<iframe>` host wrapper are correct as-is.

### 3. Sanity-check the iframe attributes in `CinemaModal.tsx`

Already correct: `allow="...; fullscreen"`, `allowFullScreen`, `referrerPolicy="strict-origin-when-cross-origin"`. The nocookie host accepts this combination; no change needed.

## What is intentionally NOT touched

- `openMattertagMedia` in `HudPreview.tsx` — wiring is correct.
- The standalone-HTML `__openMattertagMedia` in `portal.functions.ts` — wiring is correct.
- Vimeo / Wistia / Loom / mp4 branches — not affected by Error 153.
- Thumbnail derivation, card number badge position, removal of the Open Media button — these stay as last shipped.

## Verification (after switch to build mode)

1. Open a YouTube Mattertag (e.g. the "View our Food Menu" tag's sibling video tag) from the Features drawer in the admin preview → CinemaModal opens, video plays muted, no Error 153.
2. Same flow in `/p/<slug>/demo` (public demo, `fullViewport` HudPreview inside another iframe — the worst case for Error 153) → plays.
3. Generate / re-publish a standalone end-product HTML, open it directly and inside an iframe → YouTube tag plays from the nocookie host.
4. Vimeo tag still plays (regression check on the unchanged branch).
5. Image tag still opens the carousel modal (regression check on the unchanged image path).

## Files changed

- `src/lib/video-embed.ts` — 1 line (YouTube embed host).
- `src/lib/portal.functions.ts` — 1 line (YouTube embed host in `parseCinematicUrl`).
