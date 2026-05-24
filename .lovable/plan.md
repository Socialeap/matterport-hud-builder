# Fix Netlify deploy CORS failure

## Root cause

The browser error is unambiguous:

> The 'Access-Control-Allow-Origin' header contains multiple values '*, *', but only one is allowed.

This is a **response-header** problem — the browser is rejecting Netlify's CORS response, not ours. `api.netlify.com` is emitting `Access-Control-Allow-Origin: *` **twice** on the preflight/response for `POST /api/v1/sites` when the request is a cross-origin upload with `Content-Type: application/zip` + `Authorization`. This is a long-standing, intermittent Netlify edge/CDN bug that surfaces unpredictably for browser-origin calls and cannot be fixed from our client code — no fetch option, header tweak, `mode: 'cors'`, `XMLHttpRequest` swap, or retry will change what Netlify's edge returns.

The project does not register a service worker and does not wrap `fetch` in a way that could inject response headers (response headers can only come from the server / intermediaries). So the only durable fix is to **stop calling `api.netlify.com` from the browser**.

## Fix: route Netlify deploy traffic through our own server

Move the three Netlify REST calls in `src/lib/portal/netlify-deploy.ts` behind a single server route on our origin. The browser uploads the zip to **us** (same-origin, no CORS), and our server forwards it to Netlify with the user's stored OAuth token.

### New server route — `src/routes/api/public/netlify-deploy.ts`

A `POST` handler that:

1. Authenticates the caller via the standard Supabase bearer header (reuse the same pattern as `getNetlifyAccessToken` — read the user's access token from `netlify_connections` server-side; never trust a token from the request body).
2. Accepts a `multipart/form-data` body with:
   - `zip` (the presentation blob, `application/zip`)
   - `desiredSlug` (string)
3. Server-side, performs the existing 3-step Netlify flow:
   - `POST https://api.netlify.com/api/v1/sites` with the raw zip bytes + `Authorization: Bearer <token>`
   - Poll `GET /sites/:id/deploys/:deployId` until `ready` (with the existing 90s ceiling)
   - `PATCH /sites/:id` to rename to `desiredSlug`; on failure, fall back to auto name
4. Returns the same JSON shape the client already expects: `{ liveUrl, adminUrl, siteName, fellBackToAutoName }`.

Because this route is server-to-server, **CORS does not apply** — Netlify's duplicate-`*` header is irrelevant. The route lives under `/api/public/` only so it can be called without the platform's session middleware getting in the way; the handler still enforces auth itself.

### Update `src/lib/portal/netlify-deploy.ts`

Replace the three direct `fetch("https://api.netlify.com/...")` calls in `deployZipToNetlify` with one same-origin `fetch("/api/public/netlify-deploy", { method: "POST", body: formData })`. Keep the existing `onProgress` callbacks ("Uploading to Netlify…", "Finalizing deploy…", "Setting your custom URL…") — fire them around the single request so the UI feedback in `PublishDistributeSection` stays the same. Slug validation helpers (`slugifyForNetlify`, `isValidNetlifySlug`, `NETLIFY_SLUG_REGEX`) stay client-side.

### What does not change

- OAuth flow, canonical redirect URI, origin allowlist, secret trimming — all the prior fixes stay.
- `getNetlifyAccessToken` server function stays (still used by any non-deploy paths and as the lookup the new route reuses internally).
- UI in `PublishDistributeSection.tsx` — no changes; it still calls `deployZipToNetlify(...)` with the same arguments.

## Technical notes

- Cloudflare Worker request body limit is 100 MB; presentation zips are well under that based on the existing zip pipeline. If a future zip approaches the cap, we'd switch to Netlify's file-digest deploy API, but that is not needed today.
- The server route reads the zip with `await request.formData()` and forwards `file.stream()` (or the `Blob`) directly to Netlify — no buffering of the whole zip into a JS string.
- Errors from Netlify are passed back to the client with status + message body so the existing `[publish] failed` UI surface keeps working.
- No DB schema changes, no new secrets, no auth changes.

## Files touched

- **new** `src/routes/api/public/netlify-deploy.ts` — server proxy
- **edit** `src/lib/portal/netlify-deploy.ts` — swap 3 direct Netlify calls for 1 same-origin call
