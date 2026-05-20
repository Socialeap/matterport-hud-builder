# Branding Page Fixes

Three independent fixes scoped to MSP Branding + the public Studio shell.

## 1. Logo upload: auto-optimize to WebP ≤ 120 KB + responsive display

**File:** `src/routes/_authenticated.dashboard.branding.tsx`

- Wire `optimizeBrandImage()` (already exists in `src/lib/portal/image-optimizer.ts`) into the logo `<Input type="file">` handler — same pattern the demo page already uses.
- Override the existing `logo` preset to `{ maxWidth: 512, targetBytes: 120 * 1024 }` so the user's 120 KB cap wins over the existing 150 KB default. SVG passthrough behavior is preserved.
- Show a small "Optimizing…" spinner while the encoder iterates quality steps; on success, toast the size reduction via `describeOptimization()`; on failure, toast the error from the optimizer (it already returns user-friendly messages) and clear the file input.
- Apply the same wiring to the favicon input using the existing favicon preset (max 128px, 50 KB) — this also protects the stored favicon from being absurdly large when it gets injected into the tab.
- Render both the logo preview and the on-page identity logo with responsive sizing that survives portrait, landscape, and square sources:
  - replace fixed `h-12` thumbnails with a bounded box `max-h-16 max-w-[160px] w-auto h-auto object-contain` so the natural aspect ratio is preserved while neither dimension overflows.

No DB / schema changes. Storage upload path (`uploadBrandAsset`) is unchanged — it already takes whatever `File` we hand it, so the optimized WebP slots straight in.

## 2. Favicon: actually use it in the Studio browser tab

**File:** `src/routes/p.$slug.index.tsx`

The route loader already fetches `favicon_url` (via `select("*")`) but the `head()` builder never emits a `<link rel="icon">`, so the browser falls back to the app's default favicon.

- Extend the typed `b` shape in `head()` to include `favicon_url?: string | null` and `logo_url?: string | null`.
- Append to the `links` array:
  - `{ rel: "icon", href: faviconUrl, type: <mime> }` when `b?.favicon_url` is set, otherwise fall back to `b?.logo_url` (the BrandingSection help text already promises that fallback).
  - Pick `type` from extension: `.svg → image/svg+xml`, `.ico → image/x-icon`, else `image/webp` / `image/png` based on suffix. Default safely to `image/png`.
- Leave canonical link untouched (still leaf-only — no dedupe issue, names differ).
- No change needed to the loader: `favicon_url` is already in the returned branding payload.

Verification: load `/p/<slug>` with an MSP that has a custom favicon — browser tab shows their icon; with no favicon but a logo — tab shows logo; with neither — default Lovable icon.

## 3. Hero preview shows actual headline text

**File:** `src/routes/_authenticated.dashboard.branding.tsx` (line ~702)

Replace the hard-coded `"Headline preview"` string in the Studio Hero Background preview overlay with the live `branding.gate_label` value, falling back to `"Enter Tour"` (the existing placeholder) when the field is empty, so the preview is never blank.

## Verification

- Upload a 4 MB PNG logo → toast shows `"4 MB → ~110 KB"`, stored URL ends in `.webp`, preview keeps aspect ratio for square, portrait, and landscape sources.
- Upload an oversized favicon → optimizer shrinks it; load Studio → custom icon appears in tab.
- Edit Gate Button Label → hero preview overlay updates live to match.
- Existing tests: `tests/upload-limits-parity.test.mjs` is unaffected (we only adjust per-call optimizer opts, not the shared `UPLOAD_LIMITS` policy).

## Files Touched

- `src/routes/_authenticated.dashboard.branding.tsx` (optimizer wiring, responsive preview, hero headline)
- `src/routes/p.$slug.index.tsx` (favicon `<link rel="icon">` in `head()`)
