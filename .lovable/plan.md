## Goal

Let any MSP (paid or unpaid) preview their unpublished Studio page directly from `/dashboard/branding` so they can visually assess branding before purchasing or publishing. The Studio page being previewed is the same `/p/$slug` route end-clients see — we just render it inside the dashboard.

## Approach

The Studio at `/p/$slug` already reads everything from `branding_settings` (logo, accent, hero, slug, tier, etc.). The Branding page already saves there on "Save Changes". So a preview just needs to load that same route inside an iframe, scoped to the MSP's slug.

Two preview modes, both available to paid and unpaid MSPs:

1. **Inline iframe** — embedded at the bottom of the Branding page, with desktop/tablet/mobile width toggles and a Refresh button.
2. **Open in new tab** — convenience link (full-screen review).

No changes to the public Studio route. No data flow changes. No paywall changes.

## What gets built

### 1. New component: `src/components/dashboard/StudioPreviewPanel.tsx`

Props:
- `slug: string | null`
- `tier: "starter" | "pro"`
- `customDomain: string | null`
- `hasUnsavedChanges: boolean`

Renders a `Card` titled "Studio Preview" containing:
- An info row showing the URL being previewed (built via existing `buildStudioUrl`).
- A device-width toggle (Desktop 100%, Tablet 768px, Mobile 390px).
- A Refresh button that bumps a `key` on the iframe to force reload (so the MSP sees their latest saved branding).
- An "Open in new tab" link.
- An `<iframe>` pointing at the in-app preview path. The iframe is sandboxed (`sandbox="allow-scripts allow-same-origin allow-popups allow-forms"`) and sized to a fixed height (e.g. `h-[700px]`) with a horizontal-centered inner frame for tablet/mobile widths.

Empty / edge states:
- If `slug` is empty/null → render a friendly placeholder: "Set your Studio URL slug above and save to see a live preview." (no iframe).
- If `hasUnsavedChanges` → show a small amber notice "You have unsaved changes. Save to update the preview." above the iframe (the iframe still shows the last-saved version, which is honest — preview = "what visitors would see right now").

### 2. Wire it into `src/routes/_authenticated.dashboard.branding.tsx`

- Track an `initialBranding` snapshot after `fetchBranding` so we can compute `hasUnsavedChanges` (shallow compare of editable fields + presence of `logoFile`/`faviconFile`/`heroFile`).
- After `handleSave` success, refresh the snapshot so the unsaved indicator clears and the iframe reloads (bump a local `previewVersion` integer state and pass it to the panel).
- Render `<StudioPreviewPanel ... />` just above the final "Save Changes" button so the preview is the natural last step before saving/publishing.
- Available regardless of `hasPaid` — no gating.

### 3. Preview URL strategy

Use the **same-origin** preview path so it works in both dev and production with no CORS or cookie issues, and renders the most-recently-saved branding:

- URL: `` `/p/${slug}` `` (same site, same `branding_settings` row).

Why not `buildStudioUrl(...)`?
- `buildStudioUrl` may return a custom domain (Pro) which can't be embedded reliably and isn't yet provisioned for unpaid MSPs.
- The same-origin `/p/$slug` always renders the current saved branding for that provider.

We'll still **display** `buildStudioUrl(...)` as the human-readable "Public URL" text and use it for the "Open in new tab" link only when the MSP has a slug set; the embedded iframe always uses the relative same-origin path.

### 4. No backend, no schema, no security changes

- No new tables, RLS, or env vars.
- The `/p/$slug` route is already public (it's the end-client landing). Embedding it in the dashboard introduces no new exposure.
- Existing publish gating (`lusActive`) is unchanged — unpaid MSPs can preview but their Studio still won't show paid-only sections (AI features, vault add-ons, etc.) because `/p/$slug` already reads those flags from licenses.

## Execution-path sanity checks

- **Unpaid MSP**: `hasPaid=false` → no gating on the panel. The iframe renders `/p/$slug` which reads the same `branding_settings` row. Locked features (Vault, AI) simply don't appear in the public Studio body — exactly what the MSP needs to see.
- **No slug saved yet**: panel shows the friendly empty state instead of attempting to load `/p/`.
- **Unsaved edits in form**: the iframe shows the *saved* state (truth). Banner tells the MSP to save to refresh — avoids the false impression that unsaved color changes are "live".
- **After Save**: `previewVersion` bump remounts the iframe → MSP sees fresh content immediately.
- **Custom domain (Pro)**: even if set, embed uses same-origin `/p/$slug`. The "Open in new tab" link uses `buildStudioUrl` so the MSP can also test the real custom domain.
- **Logo / hero re-uploads**: those are stored in Supabase storage on Save and the public route reads the URLs from `branding_settings` — no special handling needed beyond the post-save refresh.
- **Tier toggling / `hasPaid` flips after purchase**: no impact; the panel is always visible. The embedded Studio updates automatically next time the MSP refreshes.
- **Iframe of same TanStack route**: TanStack Start serves `/p/$slug` as a normal SSR page; embedding same-origin is supported. Default headers don't set `X-Frame-Options: DENY`, so same-origin embedding works. (If a future hardening adds frame-ancestors, the dashboard origin would still match same-origin and continue to work.)

## Files to create / edit

- create `src/components/dashboard/StudioPreviewPanel.tsx`
- edit `src/routes/_authenticated.dashboard.branding.tsx` (snapshot for dirty-tracking, mount preview panel, bump version on save)

No DB migrations, no edge functions, no auth/role changes, no changes to `/p/$slug` or generated `.html` output.
