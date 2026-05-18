## Problem

The generated standalone 3D presentation HTML only emits `<link rel="icon">` when `overrides.faviconUrl` is truthy (`src/lib/portal.functions.ts` line 1412). When the client hasn't uploaded a favicon — or the HTML is opened/embedded under the MSP domain `3dps.transcendencemedia.com` — the browser falls back to that host's `/favicon.png`, which is the Transcendence Media (TM) app icon. Result: TM's icon shows in the tab instead of the client's brand.

The client's favicon is already captured, uploaded to Supabase storage (`brand-assets` bucket via `uploadBrandAsset(...,'favicon')`), and threaded through to `tourConfig.brandingOverrides.faviconUrl` in both the refresh and save flows (`HudBuilderSandbox.tsx` lines 1176 / 1448). The piping is correct; the generator just doesn't guarantee an icon tag is emitted, and doesn't fall back to the client's logo.

## Goal

Every generated `.html` presentation must declare an icon tag in `<head>` that points at the client's branding assets, in this priority order:

1. Client's uploaded favicon (`overrides.faviconUrl`)
2. Client's uploaded logo (`overrides.logoUrl`) as a graceful fallback
3. Otherwise, an inline transparent 1×1 data-URI (suppresses the host's TM `/favicon.png` from leaking in)

Never fall through to the MSP/Lovable host favicon.

## Changes

### 1. `src/lib/portal.functions.ts` — generator

- Around line 1061, compute a single `effectiveFaviconUrl`:
  - prefer `overrides.faviconUrl`
  - else `overrides.logoUrl`
  - else a constant `EMPTY_ICON_DATA_URI` (1×1 transparent PNG data URI declared at the top of the file)
- Derive `iconMimeType` from the URL extension (`.png` / `.jpg` / `.jpeg` / `.svg` / `.webp` / `.ico` → matching `image/*`; default `image/png` for data-URIs and unknowns).
- Replace the single conditional line at 1412 with three deterministic tags so different browsers/PWA contexts pick the right one:
  ```html
  <link rel="icon" type="${mime}" href="${escapeHtml(url)}">
  <link rel="shortcut icon" type="${mime}" href="${escapeHtml(url)}">
  <link rel="apple-touch-icon" href="${escapeHtml(url)}">
  ```
- Do not change ordering relative to `<title>` (icon tag must remain before `<title>`, already the case).
- Keep everything inside the existing `escapeHtml` boundary; no new template variables exposed to user-controlled HTML.

### 2. `src/components/portal/HudBuilderSandbox.tsx` — builder UX (small clarification only)

No logic change to upload/save flow — already correct. Only update the hint text under the favicon input in `BrandingSection` so clients understand the fallback:
- "If left empty, your uploaded logo will be used as the browser tab icon."

This means a tiny prop addition (or just adjust copy inside `BrandingSection.tsx` `Favicon / Tab Icon` block, lines 130-140).

### 3. No DB / migration / RLS changes

The `branding_settings.favicon_url` column, `brand-assets` bucket, and existing storage policies are unchanged. The override payload already carries `faviconUrl` and `logoUrl`. Existing saved presentations regenerate with the new fallback automatically the next time the user clicks Generate.

## Execution trace (verified before plan)

1. Client uploads favicon → `uploadBrandAsset(...,'favicon')` → public URL in `brand-assets` bucket.
2. Builder save path: `HudBuilderSandbox.tsx:1418-1448` writes `faviconUrl` into `tourConfig.brandingOverrides`.
3. Builder refresh path: `HudBuilderSandbox.tsx:1119-1176` mirrors the same write.
4. `generatePresentation` server fn reads `tourConfig.brandingOverrides` → `overrides.faviconUrl` (line 1049 / 1061). **(new)** Computes effective URL with logo + data-URI fallback.
5. HTML template (line 1407+) emits `<link rel="icon"|"shortcut icon"|"apple-touch-icon">` before `<title>`.
6. End user downloads `.html` or views it on any host → browser resolves the absolute Supabase storage URL (works for `file://`, `3dps.transcendencemedia.com`, custom domains, embeds).

## Risk / regression check

- **Saved models without an uploaded favicon**: previously emitted no icon tag → now emits logo-as-icon, or transparent pixel. Both are strictly better than the current TM bleed-through.
- **CORS / hotlink**: Supabase storage public URLs already serve `brand-assets` publicly (existing logo embeds rely on this). No new CORS surface.
- **HTML quality check / regex safety**: `assertRuntimeRegexSafety(html)` runs on the final HTML (line 5259); the added tags use the same `escapeHtml` helper used elsewhere, so no new injection vector.
- **End-product self-contained constraint** (Core memory): all values are baked at generation time; no runtime phone-home.
- **Tier gating**: favicon is a branding asset already available to Starter and Pro — no tier logic affected.
- **Build/lint**: changes are additive string concatenation inside an existing template literal; no new imports, no new dependencies, no schema changes.

## Files touched

- `src/lib/portal.functions.ts` (generator: add helper constants + fallback logic + 3-tag emission)
- `src/components/portal/BrandingSection.tsx` (single hint string under the favicon input)

No other files require edits.
