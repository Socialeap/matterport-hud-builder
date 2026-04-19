

## Plan: Fix Branding asset persistence + Public Demo "View Live" link

### Issue 1 — Logo & Favicon don't persist

**Root cause:** Two compounding problems:

1. **Files only upload on Save click.** `handleFileChange` only stores a `File` object + a temporary `blob:` URL in component state (lines 252–260 of `_authenticated.dashboard.demo.tsx`). The actual upload to Supabase Storage happens inside `ensureBrandAssetUrls()` which runs only when the user explicitly clicks "Save Draft" or toggles Publish. If the user uploads an image and then navigates away (e.g., switches tabs, leaves the page), nothing is persisted — the `blob:` URL dies with the page.
2. **Even after Save, blob URLs sometimes get filtered out on reload.** Lines 101–106 correctly skip `blob:` URLs, but if the upload succeeded the durable URL should be in the DB. Current DB row confirms `logoUrl: null, faviconUrl: null` for the test user — meaning the user never successfully completed a Save *with files staged*, OR the upload silently failed and was swallowed.

**Fix:** Upload-on-select. The moment the user picks a file in `BrandingSection`, immediately upload it to `brand-assets` storage, then set `logoPreview`/`faviconPreview` to the durable public URL (not a `blob:` URL). Show a small inline "Uploading…" spinner during the round trip. This way:
- The image survives navigation away even without clicking Save (the URL is durable).
- Save just persists the already-durable URL into `sandbox_demos.brand_overrides`.
- We auto-trigger a silent `saveDemo` after a successful upload so the URL gets persisted to DB immediately (no manual Save needed for the asset to stick across sessions).

**Files touched:**
- `src/routes/_authenticated.dashboard.demo.tsx` — rewrite `handleFileChange` to upload immediately via the existing `uploadIfFile` helper, set `logoPreview`/`faviconPreview` to the public URL, then call `saveDemo` to persist. Same treatment for `handleAgentAvatarChange`.
- `src/components/portal/BrandingSection.tsx` — add `uploading` prop + small spinner overlay on the file input rows. Add tiny "Remove" buttons next to each preview so users can clear an asset (currently impossible).

### Issue 2 — "View Live" appears to reopen the dashboard

**Root cause:** The button's href IS correct (`/p/transcendencemedia/demo`, opens in new tab). I verified the slug exists in DB, the demo is published, and `/p/$slug/demo` is a real, distinct route. **However**, the destination page (`src/routes/p.$slug.demo.tsx`) renders the exact same `HudPreview` with the same brand colors and same property data as the dashboard's right-column preview, so it visually looks identical. Combined with both opening to similar layouts, this gives the impression nothing changed. The actual navigation IS happening — but the page itself doesn't differentiate as a public, prospect-facing demo.

**Fix (two parts):**

A. **Make the public demo page visually distinct as a "live presentation"** (not a builder echo):
   - Drop the dashboard-style header/labels currently at the top of `/p/$slug/demo`
   - Replace with a full-bleed cinematic presentation layout: brand header bar at top, large HUD preview centered, a clear "This is a live 3D Property Presentation by {brandName}" subtitle, and a prominent "Build Your Own" CTA at the bottom only.
   - Remove the redundant "Interactive Demo" title block — the page IS the demo.

B. **Add the actual published-presentation URL prominently in the dashboard**, so the user can see and copy it:
   - Replace the icon-only "View Live" button with a labeled URL display block: shows `3dps.transcendencemedia.com/p/{slug}/demo`, a copy-to-clipboard button, and a clearer "Open in new tab ↗" button. This makes it unambiguous that it's a different URL/page.

**Files touched:**
- `src/routes/p.$slug.demo.tsx` — restructure layout into a presentation-first page (kill builder-echo framing, add cinematic header/footer).
- `src/routes/_authenticated.dashboard.demo.tsx` — replace the "View Live" button block (lines 429–445) with a URL display + copy button + open-in-new-tab button.

### Out of scope
- No DB schema changes.
- No changes to the HudPreview component itself.
- No changes to publish/license logic.

