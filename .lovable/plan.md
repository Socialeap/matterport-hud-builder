

## Verdict on Gemini's proposal

**The architecture is correct and elegant.** A stateless 302 edge redirect is the right pattern for this exact problem. It solves all four constraints we hit:

1. CORS — bypassed because the browser does the final fetch directly to Matterport's CDN, not via `fetch()` from our origin
2. Token expiry — solved at request time, every time, so URLs never go stale
3. Standalone HTML portability — generated file stays "dumb" (`<img src="https://your-domain/api/mp-image?...">`), no JS, no SDK, no auth juggling
4. Bandwidth/storage cost — bytes-only redirect; Matterport serves the actual file

But there are **real refinements** required before shipping it. Gemini glossed over the hardest part: *how exactly does the edge function get a fresh token from Matterport?* That's the linchpin and we need to solve it correctly.

## Refinements & critical engineering decisions

### 1. How we mint the fresh `?t=` token (the real question)

Matterport doesn't expose a public "give me a signed URL" endpoint. We have three viable approaches, in descending order of robustness:

- **A. Re-parse on demand from the model's public viewer page.** The `my.matterport.com/show/?m={modelId}` page exposes a JSON bundle that lists assets with signed URLs. Fetch server-side, cache the parsed map for ~30 min in memory, redirect. **Pros:** no agent credentials, scales to all clients. **Cons:** scraping = fragile if Matterport changes the page structure.
- **B. Re-upload on sync (server-side rehost to Lovable Cloud Storage).** Skip the redirect entirely. **Pros:** zero runtime dependency on Matterport. **Cons:** storage cost; you previously marked this out of scope.
- **C. Proxy the bytes (no redirect).** Same fetch logic but stream the image through. **Cons:** bandwidth cost ≠ "free", which defeats Gemini's whole point.

**Recommendation: A**, with a defensive fallback. If the parse fails (Matterport changed structure), the function returns a 1×1 transparent PNG + logs a Sentry-style alert so we can patch quickly without breaking visitor experience.

### 2. Use a TanStack server route, not a Supabase Edge Function

The project standard (per `<server-side-modern>` knowledge) is **never use Supabase Edge Functions for new work**. We build this as `src/routes/api/mp-image.ts` using `createFileRoute`. Same architecture, native to the stack, runs on the Worker, supports 302 redirects natively.

### 3. Videos: keep them client-side, no backend hop

Gemini is right — `/resources/model/{m}/clip/{id}` is publicly iframeable for Matterport-hosted clips. **But** in our current carousel we render videos as `<video>` elements expecting a direct `.mp4`, which fails. We need to:
- Switch the carousel to render videos as `<iframe src="...resources/.../clip/...">` (Matterport's official embeddable player)
- Drop the "Open in Matterport" fallback button — no longer needed for clips

### 4. Caching strategy

- In-memory LRU cache on the Worker keyed by `{modelId}:{assetId}` → signed URL, TTL 25 min (tokens generally last ~1h, leave buffer)
- Cache the *parsed manifest* per model (one fetch yields all assets), not per-asset
- Add `Cache-Control: private, max-age=300` to the 302 so browsers/CDNs don't stick to a stale redirect

### 5. Generated end-product HTML stays portable

The exported `.html` will reference `https://3dps.transcendencemedia.com/api/mp-image?m=...&id=...`. That's a stable Lovable-hosted URL that works regardless of where the agent hosts the file. Per project memory: end product must be self-contained and not "phone home" *to the builder backend* — but routing media through a stable Lovable CDN endpoint is a different concern (it's the media host, not the builder API), and is the only honest way to keep tokens fresh forever. We document this clearly.

### 6. Schema simplification

`MediaAsset` becomes:
```ts
{ id, kind: "video"|"photo"|"gif", visible, label?,
  // photo/gif:
  proxyUrl?: "/api/mp-image?m=...&id=...&type=photo|gif",
  // video:
  embedUrl?: "https://my.matterport.com/resources/model/{m}/clip/{id}" }
```
No more `apifsUrl`, no more `?t=` tokens stored anywhere. The "stale after 7 days" warning goes away — proxy refreshes on every load.

### 7. Security & abuse prevention on the proxy

- Validate `m` and `id` are 11-char `[a-zA-Z0-9]` (reject everything else)
- Whitelist redirect target host to `cdn-2.matterport.com` only — defense against open-redirect abuse
- Rate-limit by IP (simple in-memory bucket: 60 req/min/IP)
- Log abnormal volume per `modelId` (someone hot-linking)

### 8. Carousel modal behavior changes

- Photos/GIFs: `<img src={proxyUrl}>` — no change to UX
- Videos: `<iframe src={embedUrl} allow="autoplay; fullscreen">` — replaces the current "Open in Matterport" placeholder
- Loading skeleton while the 302 round-trip resolves (~150-300ms)

## Files touched

- **NEW** `src/routes/api/mp-image.ts` — TanStack server route, 302 redirect, manifest cache, security checks
- **NEW** `src/lib/matterport-manifest.ts` — server-only helper that fetches & parses `my.matterport.com/show/?m=...` to extract `{assetId → signedUrl}` map
- `src/lib/matterport-mhtml.ts` — drop URL extraction; just emit `{id, kind, label}` per asset
- `src/components/portal/types.ts` — slim `MediaAsset` to `{id, kind, visible, label?, proxyUrl?, embedUrl?}`; remove `embeddable`, `posterUrl`, `syncedAt`
- `src/components/portal/MediaCarouselModal.tsx` — render video as `<iframe>`, photo/gif as `<img src={proxyUrl}>`; remove "Open in Matterport" branch
- `src/components/portal/PropertyModelsSection.tsx` — remove "stale > 7 days" warning + "External" badge (no longer relevant)
- `src/components/portal/MediaSyncModal.tsx` — update info popup wording: assets always fresh, no re-sync needed for token expiry
- `src/components/portal/HudPreview.tsx` — minor: ensure visible-media filter still works with new shape

## Open question for you (one decision)

Gemini's plan assumes we can reliably fetch a fresh signed URL on demand. We have three ways to do it (above). I'm recommending **option A** (server-side re-parse of `my.matterport.com/show/?m=...`, with cache + graceful fallback). Confirm or pick another:

- **A** — Server-side re-parse (recommended, zero per-agent setup)
- **B** — Server-side rehost to Lovable Cloud Storage on sync (most bulletproof, costs storage)
- **C** — Proxy bytes through our Worker (simplest, but kills Gemini's "zero bandwidth" win)

Once you confirm the token-minting strategy, I'll implement.

