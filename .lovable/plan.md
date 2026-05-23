Switch the export from a single `.html` to a self-contained **folder bundled as a `.zip**`, so Mattertag images live next to the presentation as real files instead of base64 blobs or backend-hosted URLs. The user downloads one zip, unzips it, and either opens `index.html` locally or drag-drops the whole folder onto Netlify / any static host / their own site — no platform dependency, no inflated backend storage.

## Resulting bundle layout

```text
{property-slug}.zip
└── {property-slug}/
    ├── index.html                 ← the existing self-contained presentation
    └── assets/
        └── mattertags/
            └── {matterportModelId}/
                ├── {attachmentId}.jpg
                ├── {attachmentId}.png
                └── ...
```

- One folder per property model, scoped by Matterport model ID, so multi-model presentations stay organized and collision-free.
- Only Mattertag attachment images get mirrored locally. Absolute `http(s)` media (YouTube, Vimeo, external photos) stays as-is. Video thumbnails are unchanged.
- Filename = `{attachmentId}.{ext}`, where `ext` is derived from the resolved MIME type (`jpg|png|gif|webp|avif`). Deterministic so re-exports are stable.

## Steps

- **New server-only helper: resolve + fetch Mattertag attachment bytes**
  - Add `src/lib/portal/mattertag-bundler.server.ts`.
  - Function `fetchMattertagAttachment({ modelId, mattertagId, attachmentId })` reuses the exact Matterport GraphQL flow that `/api/mp-attachment` already uses to get a fresh signed `downloadUrl`, fetches the bytes once, returns `{ bytes, contentType, ext }`.
  - Bounded concurrency (e.g. 4 in flight), per-attachment cap and total-bytes cap as defensive limits. On any failure, return `null` so the export proceeds without that thumbnail (no broken zip).
- **New export server fn: package the bundle**
  - Add `buildPresentationBundle` in `src/lib/portal.functions.ts` (or a new `presentation-bundle.functions.ts`).
  - Steps inside the handler:
  1. Generate the existing self-contained `index.html` exactly as today.
  2. Walk all Mattertags across all property models; for each whose `media` matches the strict `/api/mp-attachment?m=…&t=…&id=…` shape, fetch the bytes via step 1.
  3. Rewrite that tag's `media` value (in the embedded JSON payload inside `index.html`) to a **relative** path: `assets/mattertags/{modelId}/{attachmentId}.{ext}`.
  4. Use a pure-JS zipper (`fflate`, which is Worker-safe) to build the zip in memory: root folder named after the property slug, containing `index.html` plus all the fetched image files at the paths above.
  5. Return the zip bytes via a dedicated server route (`/api/presentation-bundle/{token}` or a POST that streams `application/zip`) — server fns return DTOs, raw bytes must go through a server route per stack rules.
- **Wire the download button**
  - Replace the current "Download HTML" action in `PublishDistributeSection.tsx` with "Download Presentation (.zip)".
  - Button calls the new server route, triggers a normal browser download of `{property-slug}.zip`.
- Do **not** touch the Netlify Drop popup wiring — it keeps opening at the same configured size and the user drags the unzipped folder (or the zip itself, which Netlify Drop accepts) into it. Add a one-line hint under the Netlify card: "Unzip first, then drop the folder onto Netlify."
- **Runtime compatibility inside `index.html**`
  - `classifyMediaUrl()` already treats relative image paths and any URL ending in a known image extension as `image`, so feature-card thumbnails and the internal media player work without changes.
  - Keep the existing `/api/mp-attachment` fallback classification so the Builder preview (still served by the platform) keeps working unchanged.
- **No regressions**
  - Do not modify: Netlify popup sizing/handler, routing, database schema, Builder UI, multimedia carousel, video thumbnail handling, `fetch-mattertags`, or any generated route files.
  - Builder preview keeps using `/api/mp-attachment` (platform-hosted, fast). Only the exported bundle gets the local-file rewrite.
- **Verification**
  - Re-run the export for the test presentation containing the Noire restaurant model.
  - Confirm the zip contains:
    - `Noire/.../index.html`
    - `Noire/.../assets/mattertags/XjKKxpzSJdM/pnehuwsk5dhcf1nq307ygytwa.jpg` (Food Menu)
    - `Noire/.../assets/mattertags/XjKKxpzSJdM/6k7eefw5dedqepf88hunzuh8d.jpg` (Beverage Menu)
  - Open `index.html` directly from disk (`file://`) and verify both feature-card thumbnails render and clicking them opens in the internal media player.
  - Upload the folder to Netlify Drop and verify the same.
  - Confirm video-thumb tags and YouTube tags remain unchanged.

## Why this is the right call

- **No backend storage growth** — images live in the artifact the user already keeps. At 10k properties × dozens of images, we store zero of them.
- **Truly self-contained** — satisfies the "no phone-home" rule the project already enforces.
- **Portable** — works on Netlify, Vercel, S3, GitHub Pages, an MSP's own webserver, or just a USB stick.
- **Small payload per image** — one ~120-char relative path in the JSON, instead of hundreds of KB of base64 per image.
- **Reversible** — the Builder and platform-hosted preview paths are untouched.