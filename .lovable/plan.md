## Findings

The current fix is failing because the media logic is still too broad in one place and too strict in another:

1. **YouTube player**: the code now converts YouTube links to `youtube-nocookie.com` embeds. Your working embed code uses `www.youtube.com/embed/...` with `referrerpolicy="strict-origin-when-cross-origin"`. Error 153 is commonly triggered when YouTube rejects the embed identity/referrer/origin configuration, so we should match YouTube’s official embed shape instead of using the no-cookie host.
2. **Social links showing Open Media**: the new `isLikelyImageUrl()` treats almost any non-video URL as image/media. That makes Instagram/Facebook/TikTok/etc. links look like media and creates invalid Open Media buttons.
3. **Photo thumbnails still missing**: thumbnail discovery is relying on “try any URL and let `<img onError>` hide it.” That is unsafe for social links and may still miss Matterport photo URLs or URL wrappers. We need a deterministic classifier, not a permissive guess.

## Options evaluated

- **Keep permissive URL guessing and hide broken images on error**: rejected. It already caused false Open Media buttons for social links and still doesn’t reliably surface photos.
- **Probe every URL with `fetch`/HEAD to check `Content-Type`**: rejected for the exported standalone HTML. It can fail under CORS, adds latency, and makes the self-contained output less predictable.
- **Use a deterministic shared media classifier and official embed URLs**: safest. It keeps social/external links as links only, routes only true media to in-app players, and mirrors behavior in both Builder preview and generated HTML.

## Implementation plan

### 1. Replace broad Mattertag media guessing with a classifier

Create/inline a small deterministic classifier in both surfaces:

- `image`: image extensions, data images, and known Matterport/CDN/photo URL patterns.
- `videoFile`: direct `.mp4/.webm/.mov/.m4v` URLs.
- `hostedVideo`: YouTube/Vimeo/Loom/Wistia URLs parsed by the cinematic parser.
- `external`: social media, documents, listing pages, and all other non-media URLs.

Social domains will be explicitly excluded from media handling, including Facebook, Instagram, Threads, X/Twitter, TikTok, LinkedIn, Pinterest, and common document/file links like PDF/DOC/XLS.

### 2. Fix Mattertag card rendering

Update both `HudPreview.tsx` and the exported runtime in `portal.functions.ts` so each card resolves:

```text
thumbnailUrl = first classified image from tag.media or description URLs
mediaActionUrl = first classified image/video/hostedVideo only
external links = link-icon buttons only
```

Result:

- Social links remain as external-link icons only.
- No Open Media button appears for social posts.
- Photo Mattertags show a thumbnail when the URL is a real image candidate.
- Thumbnail clicks open the in-app carousel.
- Video/hosted-video Mattertags show Open Media and open the proper in-app player.

### 3. Fix YouTube embed generation

Update `parseCinematicVideo()` and the mirrored runtime `parseCinematicUrl()` to use YouTube’s official embed host and referrer behavior:

```text
https://www.youtube.com/embed/<id>?rel=0&playsinline=1&autoplay=1&mute=1&enablejsapi=1&origin=<valid-http-origin>
```

Also update iframe referrer policy from `origin` to `strict-origin-when-cross-origin`, matching the embed code YouTube provided.

If the exported file is opened from an invalid origin like `file://`, the code will avoid sending `origin=null`; if YouTube still blocks local-file embeds, the fallback remains the YouTube “Watch on YouTube” button because no app code can override YouTube’s embed restrictions.

### 4. Improve imported Mattertag media normalization where needed

Review `fetch-mattertags` normalization so it does not accidentally discard usable Matterport image/media URLs. If Matterport returns absolute media URLs, preserve them. If it returns wrapped/HTML-encoded URLs in descriptions, decode and classify those before rendering.

No database schema change is planned unless the existing imported payload proves unable to represent the media URL at all.

### 5. Trace and verify the complete path

After implementation, verify this full dependency path:

```text
Matterport import -> MattertagData.media/description
-> HudPreview card classifier
-> generated portal.functions runtime classifier
-> thumbnail/card rendering
-> click handler
-> MediaCarouselModal or CinemaModal
-> iframe/video embed URL
```

Validation targets:

- The provided YouTube URL opens inside the in-app player without Error 153 where YouTube permits embedding.
- Social post links do not show Open Media.
- Photo Mattertags render thumbnails and open in the carousel.
- External links still open in a new tab through link icons.
- Property-level Cinematic Video still works.
- Generated standalone HTML matches Builder preview behavior.