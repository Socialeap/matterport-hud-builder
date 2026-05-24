# Fix Netlify "Site not found" after successful upload

## Root cause

The Netlify site is created and the upload returns 200, but visiting the live URL 404s with "Site not found". The deploy itself is fine — the problem is what's *inside* the zip.

In `src/components/portal/HudBuilderSandbox.tsx` (lines ~1455–1488), the same blob is used for both the user's local download and the Netlify publish handoff:

- **With attachments**: the zip nests every file under a top-level folder, e.g.
  `${baseFilename}/index.html`, `${baseFilename}/img1.jpg`. Netlify serves the zip contents verbatim, so there is no `index.html` at `/` — only at `/<folder>/index.html`. Root URL 404s.
- **Without attachments**: `downloadBlob` is a raw `text/html` blob, not a zip at all. Our `/api/public/netlify-deploy` route still sends it with `Content-Type: application/zip`, and Netlify can't extract it. Deploy is effectively empty → 404.

The local download wants the wrapping folder (so a user double-clicking the zip gets a clean folder, not loose files in Downloads). Netlify wants the opposite — files at the root.

## Fix: build a separate "flat" zip for the publish handoff

Make two blobs in the export path when an interceptor is registered: the existing user-download blob (unchanged) and a Netlify-shaped blob that is always a zip with files at the root.

### Edit `src/components/portal/HudBuilderSandbox.tsx`

In the export block currently around lines 1452–1493:

1. Keep `downloadBlob` / `downloadName` exactly as today (folder-wrapped zip for the multi-file case, raw `.html` for the no-attachment case). The user's manual download stays user-friendly.
2. Before calling the publish interceptor, if `publishInterceptorRef.current` is set, build a second `publishBlob`:
   - Always a zip (import `fflate` once, reuse if already imported).
   - Entries keyed at the root: `index.html` and each `att.path` (no `${folder}/` prefix).
   - Same defensive path checks (`..`, leading `/`, backslashes) as the download zip.
   - Same `Uint8Array` copy → `new Blob([copy], { type: "application/zip" })` pattern for Safari compatibility.
3. Pass `publishBlob` (not `downloadBlob`) to `publishInterceptorRef.current.consume(...)`.
4. If no interceptor is registered, behavior is unchanged — only the download path runs.

### What does not change

- `src/routes/api/public/netlify-deploy.ts` — still authenticates, looks up the OAuth token, uploads the zip, polls, renames, returns `{ liveUrl, adminUrl, siteName, fellBackToAutoName }`.
- `src/lib/portal/netlify-deploy.ts` — still POSTs `multipart/form-data` to our proxy.
- OAuth flow, secret trimming, custom-domain logic, slug validation, `PublishDistributeSection` UI — untouched.
- The user's `.zip` download keeps its top-level folder (nicer UX when expanded locally).

## Why this is the safe, comprehensive fix

- Single source of truth for the deploy payload (the publish branch in the sandbox) — the proxy route doesn't need to know or guess about zip structure.
- Server-side repacking was considered but rejected: it would mean unzipping + re-zipping on every publish in the Worker, doubling CPU/memory for large bundles when the client already has all the bytes in memory and has just produced the zip.
- Covers both the attachment and no-attachment cases (the latter is silently broken today even with our prior CORS-proxy fix).
- Leaves the download UX untouched. No DB, no schema, no secret, no OAuth, no UI changes.

## Files touched

- **edit** `src/components/portal/HudBuilderSandbox.tsx` — build a flat zip for the publish interceptor; keep the folder-wrapped zip for manual download.
