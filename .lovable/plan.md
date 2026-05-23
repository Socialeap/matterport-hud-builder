# Fix: Mattertag photo thumbnails are 410 Gone

## Root cause (verified against the database and Matterport)

The Mattertag import (edge function `fetch-mattertags`) stores the raw signed Matterport CDN URL it gets from GraphQL into `tag.media`, e.g.:

```
https://cdn-2.matterport.com/attachments/<attachmentId>/full.jpeg?t=2-<sig>-<timestamp>-1
```

That URL's `t=` token expires within ~24h. I confirmed with `curl -I` against the URL currently stored for "View Our Food Menu" — Matterport responds **HTTP 410 Gone**. The `<img onError>` handler in `HudPreview` then hides the whole thumbnail button, so the entire photo card looks like it has no image. The classifier and rendering pipeline are fine — the URL itself is dead.

Re-querying the Matterport GraphQL endpoint returns the same `FileAttachment.id` but a **freshly-signed** `downloadUrl`. So the durable identifier is the pair `(modelId, attachmentId)`, and we already use exactly this pattern for skybox images in `src/routes/api/mp-image.ts`.

Video thumbnails (YouTube `img.youtube.com/vi/<id>/hqdefault.jpg`) are not signed, so they keep working — that matches what the user is seeing.

## Solution: stable proxy `/api/mp-attachment` + store the proxy URL, not the CDN URL

Mirror the existing `/api/mp-image` pattern. The proxy converts a stable `(modelId, attachmentId)` pair into a fresh 302 redirect on every request.

### 1. New route `src/routes/api/mp-attachment.ts`

`GET /api/mp-attachment?m={modelId}&t={mattertagId}&id={attachmentId}`

- Validate `m` and `t` as 11-char alphanumeric Matterport IDs; validate `id` as a 20–64-char alphanumeric attachment slug. Reject anything else with 400.
- Per-IP rate limit (60 req/min) using the same in-memory bucket as `mp-image.ts`.
- POST to `https://my.matterport.com/api/mp/models/graph` with the hardcoded SDK app key (`h2f9mazn377g554gxkkay5aqd`, same key used by `fetch-mattertags`), requesting just that one mattertag's `fileAttachments { id downloadUrl mimeType }`.
- Find the attachment whose `id` matches the requested `id`. Return **302 → `downloadUrl`**. Cache `max-age=300` (5 min) so the browser doesn't refetch on every render but the URL still rotates well before the token expires.
- On any failure (timeout, 401/403, attachment not found) serve the same 1×1 transparent PNG fallback `mp-image.ts` uses, so cards never show a broken-image icon.
- CORS: same `Access-Control-Allow-Origin: *` headers as `mp-image.ts`; this URL is also embedded in the generated standalone HTML which runs from arbitrary origins.

### 2. `supabase/functions/fetch-mattertags/index.ts` — store the proxy URL, not the expiring CDN URL

In `sanitizeMattertags`, when an image is promoted from `fileAttachments`, store:

```
/api/mp-attachment?m={modelId}&t={tag.id}&id={attachment.id}
```

instead of `attachment.downloadUrl`. To do that:

- Thread `modelId` from the request handler down to `sanitizeMattertags(payload, modelId)`.
- Keep the existing `externalAttachments` branch and the legacy `media` branch unchanged — those URLs are not signed and stay valid.
- The `id`, `description`, `anchorPosition`, label, etc. fields are untouched.

### 3. `src/components/portal/HudPreview.tsx` — make the classifier treat the proxy URL as an image

`classifyMediaUrl` currently parses `tag.media` with `new URL(u)`. A relative URL starting with `/api/mp-attachment` will throw, fall through, and end up as `"unknown"` — which means the thumbnail won't render and the click won't open the photo modal.

Fix at the top of `classifyMediaUrl`:

```ts
if (/^\/api\/mp-attachment\b/.test(u)) return "image";
```

`openMattertagMedia`'s `"image"` branch already sets `proxyUrl: mediaUrl` on `mattertagMediaAsset`, so the existing photo modal will load the same proxy URL and the 302 will re-sign on open. No change needed in `MattertagMediaPlayer` / photo modal.

### 4. `src/lib/portal.functions.ts` — same classifier tweak for the standalone end-product HTML

The generated `.html` has its own `classifyMediaUrl` (line 2739). Add the identical short-circuit:

```js
if(/^\/api\/mp-attachment\b/.test(u)) return "image";
```

Because the standalone HTML is served from a different origin than `/api/mp-attachment`, also rewrite the URL we store/use in the standalone build to an absolute one. Easiest: have the proxy URL string built once in JS using `location.origin` at generation time is not viable for a fully-static export. Instead, store an absolute URL `https://<published-host>/api/mp-attachment?...` in the mattertag `media` field when we know we're exporting, OR — simpler and aligned with how `/api/mp-image` is already used in the export — always store the path-relative form and have the export's HTML resolve it against `BUILDER_API_ORIGIN` (the same constant `portal.functions.ts` already uses to absolutize `/api/mp-image`). Reuse that exact mechanism, no new config needed.

### 5. Backfill (no migration, user-driven)

Already-stored `cdn-2.matterport.com/attachments/...` URLs are dead and there is no `attachmentId`+`modelId` audit trail in the JSON aside from the URL path itself. Rather than ship a fragile SQL migration that string-parses URLs, the user re-runs the "Import Mattertags" action on each affected model — the same one-click flow they used the first time. After step 2 lands, that re-import writes the new stable proxy URLs and the photos return immediately. The plan should call this out so the user knows the one manual step.

## Files changed

- `supabase/functions/fetch-mattertags/index.ts` — promote `fileAttachments` images to the `/api/mp-attachment?...` form; pass `modelId` into `sanitizeMattertags`.
- `src/routes/api/mp-attachment.ts` — **new** stateless 302 proxy that re-queries Matterport GraphQL and redirects to a freshly-signed `downloadUrl`.
- `src/components/portal/HudPreview.tsx` — add the `/api/mp-attachment` short-circuit at the top of `classifyMediaUrl`.
- `src/lib/portal.functions.ts` — same short-circuit in the standalone-HTML twin of `classifyMediaUrl` (~line 2739); rely on the existing `BUILDER_API_ORIGIN` absolutization the file already does for `/api/mp-image`.

## What is intentionally NOT touched

- Video thumbnails (YouTube/Vimeo) — already use unsigned thumbnail hosts, working today.
- YouTube `nocookie` embed host swap from the previous fix — stays as-shipped.
- Card-number badge position, removal of the "Open Media" CTA — stay as-shipped.
- `extractMattertagLinks`, `findImageUrlIn`, the photo carousel modal, and `MattertagMediaPlayer` — no changes; the proxy URL flows through them unchanged.

## Verification

1. Hit `/api/mp-attachment?m=XjKKxpzSJdM&t=MD6E7vF2Uej&id=pnehuwsk5dhcf1nq307ygytwa` directly → 302 → image loads.
2. Re-import Mattertags for the Noir Restaurant model → "View Our Food Menu" and "View Our Beverage Menu" cards show thumbnails again.
3. Click either thumbnail → photo opens in the in-HUD media player (same proxy URL is used by the modal, so the 302 re-signs again).
4. YouTube tag ("See this space before and after") still shows its video thumbnail and still plays via the `youtube-nocookie` host (regression check).
5. Generate / re-publish the standalone end-product HTML, open it in a fresh browser → photo thumbnails resolve via the absolute `https://<published-host>/api/mp-attachment?...` URL, same as `/api/mp-image` already does today.
