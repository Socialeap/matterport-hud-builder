
# Calling Card Generator

A new section on **/dashboard/branding** lets MSPs configure a flippable, embeddable Calling Card matching the provided front/back reference art, then copy an `<iframe>` snippet OR a standalone share URL.

## What the MSP sees

A new collapsible card on the branding page titled **"Calling Card (Embeddable)"** with:

1. **Live flippable preview** — clicking the card flips between front and back (CSS 3D transform), so the MSP sees exactly what visitors will see.
2. **Three editable fields**:
   - **Studio name** — fills the "Visit *{our 3D Presentation}* Studio" CTA pill on the front.
   - **Headline** — defaults to "Your Custom 3D Presentation Starts Here…"
   - **CTA button label** — defaults to "Visit our 3D Presentation Studio"
3. **Logo source** — automatically reuses the MSP's existing primary logo (already uploaded in the Branding section above), replacing the round photo on the front. No new upload needed.
4. **Generate / Copy panel** — two read-only fields with copy buttons:
   - `<iframe src="https://3dps.transcendencemedia.com/card/{slug}" width="600" height="340" frameborder="0"></iframe>`
   - `https://3dps.transcendencemedia.com/card/{slug}` (good for email signatures, QR codes, social posts)
5. **Open preview in new tab** link.

The back of the card is **fixed marketing copy** (White Label / Smart Chat / End Digital Rent / Live Guided Tours), exactly as in the reference image — no per-MSP editing.

## CTA behavior

The "Start" button on the card and the "Visit our 3D Presentation Studio" pill both link to the MSP's public studio: `https://3dps.../p/{slug}` (opens in `_blank` with `rel="noopener"`). Uses the existing `buildStudioUrl(slug)` helper.

## Technical Section

### Files added

```text
src/components/branding/CallingCard.tsx          // pure presentational, props-driven
src/components/branding/CallingCardSection.tsx   // editor + preview + copy panel (mounted on /dashboard/branding)
src/routes/card.$slug.tsx                        // public route that renders CallingCard from DB lookup
public/card-assets/matterport-service-partner.png  // copied from user-uploads
```

### Files edited

- `src/routes/_authenticated.dashboard.branding.tsx` — mount `<CallingCardSection branding={branding} onChange={...} />` between existing Branding and Marketplace sections; add three new fields to `BrandingData` and the upsert payload.
- `src/routes/__root.tsx` (only if needed) — no change expected; route auto-registers.

### Database (one migration)

Add three nullable columns to `branding_settings`:

```sql
ALTER TABLE public.branding_settings
  ADD COLUMN calling_card_studio_name text,
  ADD COLUMN calling_card_headline text,
  ADD COLUMN calling_card_cta_label text;
```

No new RLS policies needed — existing `branding_settings` policies cover read/write by `provider_id`.

The public `/card/{slug}` route reads via the **existing** public-readable view path used by `/p/{slug}` (anon SELECT on `branding_settings` for the public-facing fields by `slug`). I'll verify the existing policy covers these new columns (it should, since it's a row-level grant). If not, the migration will extend it.

### Public route (`/card/$slug`)

- Server loader: `supabase.from("branding_settings").select("brand_name, slug, logo_url, accent_color, calling_card_*").eq("slug", slug).maybeSingle()`.
- Renders `<CallingCard ... />` full-bleed, no app chrome, with `<head>` meta for embedding (`X-Frame-Options` removed — TanStack default already permits embedding; no CSP frame-ancestors restriction in this project).
- 404 via `notFoundComponent` if slug not found.
- Card width 100% / height 100vh, designed to fit an iframe of any size while preserving 16:9 aspect.

### CallingCard component

- Pure CSS flip (`perspective` + `transform-style: preserve-3d` + `rotateY`), no JS state needed beyond a `flipped` boolean.
- Front: brand-painted SVG/CSS reproduction of the reference art (green speech bubbles, asterisk shape, Matterport badge top-right, headline + green pill + studio CTA pill, circular logo slot on the right showing `logo_url`).
- Back: hardcoded 4-column feature grid matching the reference, with the back-arrow circle in the top-left that flips back to front. "Start" button bottom-right links to `buildStudioUrl(slug)`.
- All colors derive from MSP's `accent_color` for the green-family tints (HSL shifts) so it adapts to brand palette while keeping the reference layout.

### Copy-to-clipboard

Reuse existing `Copy` icon + `navigator.clipboard.writeText` + `toast.success` pattern already used elsewhere in the file.

### Why iframe + URL (not a script widget)

- Works in every CMS (Wix, Squarespace, WordPress, Webflow) with zero JS execution permissions.
- No CSP/CORS surprises.
- Standalone URL doubles as a shareable landing page for emails, QR codes, business cards.
- Self-contained route — matches the project's "no phone-home from end product" philosophy at the embed boundary.

### Risk / regression analysis

- **Branding page state**: new fields plumbed through the same `branding` state object and `handleSave` upsert — no parallel save path.
- **Public anon read**: `/card/{slug}` uses the same access pattern as the existing `/p/{slug}` route, so RLS exposure is identical to today.
- **No tier gating** — calling card is available to Starter and Pro (it actively promotes the platform).
- **No edge function**, no new secrets, no Stripe touch.
- Auto-generated Supabase types regenerate after the migration; the upsert uses `as any` already (line 372) so no type break in the interim.
