

## Root cause (revised diagnosis)

Looking at your working Gemini-extracted URL:
```
https://cdn-2.matterport.com/models/{modelId}/assets/render/animation-0000-240.gif?t=...&k=...
```

vs. what we're storing:
```
https://cdn-2.matterport.com/apifs/models/{modelId}/images/{assetId}/{assetId}-Photo_NN.jpg
```

Two separate problems, not one:

**1. Photos — wrong CDN path.** The `apifs/...` path I reconstructed is a **private API** path requiring signed `?t=` tokens. The actual public-asset path used by the Matterport viewer is different — it's served from the model's `assets/` tree referenced inside the MHTML itself. We were synthesizing a URL pattern that doesn't exist as a public endpoint.

**2. Videos — embedded in iframe, not a player page.** The `/resources/model/{id}/clip/{id}` URL is a **direct video file/redirect**, not an embeddable HTML page. Matterport's CDN sends `X-Frame-Options: SAMEORIGIN` so an `<iframe src="...">` is blocked ("refused to connect"). The URL itself is valid — you can open it in a new tab — it just can't be iframed. Same applies to the GIF render URL.

The good news: **the MHTML file already contains the correct public URLs for every asset.** We're synthesizing when we should be extracting.

## Fix strategy

### A. Stop synthesizing — extract real URLs from the MHTML

Update `src/lib/matterport-mhtml.ts` to scan for actual URL patterns already present in the decoded text and pair them with each `assetId`:

- **Photos**: find `https://cdn-2.matterport.com/...{assetId}...\.(jpg|jpeg|png|webp)` (any path, with or without `?t=` — keep what's there).
- **GIFs**: find `https://cdn-2.matterport.com/.../animation-...\.gif` near the `assetId`, OR the `render/animation-0000-240.gif` pattern you cited.
- **Videos**: find `https://cdn-2.matterport.com/.../\.(mp4|webm)` URLs near the `assetId`. If only the share-page URL exists, fall back to it but flag as `embeddable: false`.

Result per asset: `{ id, kind, url, embeddable }` — `embeddable` tells the player how to render it.

### B. Render based on `embeddable` flag (not by `kind`)

Update `src/components/portal/MediaCarouselModal.tsx`:

- **Direct media files** (`.jpg`/`.png`/`.gif`/`.mp4`/`.webm`): render with `<img>` or `<video controls autoplay>` — these don't trip frame-blocking because they're media elements, not iframes.
- **Share pages only** (no direct media URL found): show a styled card with "Open in Matterport" button that opens in a new tab. No broken iframe.

This handles the `cdn-2.matterport.com` refused-to-connect error completely — `<img>` and `<video>` requests are not subject to `X-Frame-Options`.

### C. Tokenized URL handling — keep them, but warn

Tokens (`?t=...`) are time-limited but typically last hours-to-days and refresh on each MHTML save. For Phase 1's "agent re-syncs when adding new assets" workflow this is acceptable. We:
- **Keep** the `?t=` tokens (don't strip them — they're required for `cdn-2` to serve the file).
- Store a `syncedAt` timestamp on each asset.
- Show a subtle "Re-sync recommended" badge in the dashboard list when assets are >7 days old.
- Document this clearly in the Sync Modal info popup.

This is the only honest path forward without paying for Matterport's API or running a server-side rehosting pipeline.

### D. One small parser hardening
Once we extract real URLs from the file, also parse the `<title>` of each thumbnail card so labels become "Long Intro", "Dollhouse View", etc. instead of generic "Photo 1" — UX win that comes free.

## Files touched

- `src/lib/matterport-mhtml.ts` — replace URL synthesis with URL extraction; add `embeddable` flag and optional title parsing.
- `src/components/portal/types.ts` — add `embeddable?: boolean` and `syncedAt?: string` to `MediaAsset`.
- `src/components/portal/MediaCarouselModal.tsx` — render `<video>` for mp4/webm, `<img>` for image/gif, fallback "Open in Matterport" card for non-embeddable.
- `src/components/portal/PropertyModelsSection.tsx` — add "Re-sync recommended" badge when `syncedAt` >7 days old.
- `src/components/portal/MediaSyncModal.tsx` — add caveat to info popup: "Token-signed URLs refresh each sync; re-sync if assets stop loading."

## Out of scope (explicit)

- **Server-side rehosting to Lovable Cloud storage**: powerful but adds cost + complexity; defer until tokens prove unreliable in practice.
- **Matterport Bundle/SDK API integration**: requires paid Matterport plan + API key from each agent; rejected per original spec.

