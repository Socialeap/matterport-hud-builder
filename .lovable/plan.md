

## Plan: Fix live demo rendering + "View Demo" link

### Investigation summary

I checked the network/server-fn payload from the dashboard. Your `sandbox_demos` row IS saved correctly: it contains the property (Villa Nita, 97133, gustavia BL, matterport `9H9XJVQN2sM`, cinematic URL) and the agent (Eddie Char, info@…, 516-…). So this is purely a **rendering bug on the public pages**, not a save bug.

Three concrete root causes:

**1. `logoUrl` is being saved as a `blob:` URL (Studio header logo missing on public site)**
On `/dashboard/demo`, when the user uploads a logo we call `URL.createObjectURL(file)` and store the resulting `blob:https://…/2a9890ee-…` string into `brand_overrides.logoUrl` via Save/Publish. Blob URLs are valid only inside the originating tab — on `/p/$slug` and `/p/$slug/demo` they resolve to nothing, so the logo silently disappears. (Confirmed in the network payload.) The dashboard page also never uploads the logo file to Supabase Storage.

**2. The `View Demo` link works, but `/p/$slug/demo` HUD looks empty because the HUD header is collapsed by default**
`HudPreview` initializes `headerVisible = false`, so on a fresh load the brand name, property name/address, agent name and Contact button are all hidden behind a 6×6 chevron toggle in the top-right corner. On the public demo page this reads as "data didn't render" even though it did. (Click the down-chevron at the iframe's top-right and it appears.) The dashboard preview *also* has this behavior, but you've been clicking around so you've seen it expanded.

**3. The "View Demo" header link click does nothing because it's not a header link — it's a banner that the page never reaches**
There is no "View Demo" button in any header. The only `View Demo` link in the codebase lives in the **purple banner at the very top of `/p/$slug`** (when `demoPublished=true`). On `/dashboard/demo` (your current route) there's a `View Live` button that opens `/p/{slug}/demo` in a new tab — that one works. But on `/p/transcendencemedia` the banner's `<Link to="/p/$slug/demo">` should navigate. I want to confirm with you whether you were clicking the dashboard's "View Live" or the public banner's "View Demo" — because the banner link IS wired correctly, and clicking "View Live" on the dashboard does open `/p/transcendencemedia/demo`, where issues #1 and #2 then make the page look broken.

Also worth noting: the dashboard's "View Live" `<a href="/p/{slug}/demo" target="_blank">` is a **plain anchor**, so it does a full page navigation outside the SPA. That works, but if hitting it during dev with no slug yet, it would 404. Slug exists for `transcendencemedia`, so this isn't the bug.

### Changes

**A. Upload logo to Supabase Storage on the demo dashboard, store the public URL** (`src/routes/_authenticated.dashboard.demo.tsx`)
- In `handleSave` and the publish path, if `logoFile` is a fresh `File`, upload it to the existing public `brand-assets` bucket under `demo-logos/{providerId}/{timestamp}-{name}` and use the resulting public URL as `logoUrl`.
- If `logoPreview` is already a `blob:` URL but `logoFile` is null (edge case after re-render), skip writing it.
- Strip any `blob:` URLs out of `brand_overrides` before save as a safety net.

**B. Default the HUD header to visible on the public demo page** (`src/components/portal/HudPreview.tsx`)
- Add an optional prop `defaultHeaderVisible?: boolean` (default `false` to preserve current builder UX).
- Initialize `headerVisible` from that prop.
- In `src/routes/p.$slug.demo.tsx`, pass `defaultHeaderVisible={true}` so the brand name, property name/address, agent name and Contact button are visible on first paint of the public demo.
- Builder pages keep current behavior (collapsed by default).

**C. Make the public Studio's "View Demo" CTA more prominent and durable** (`src/routes/p.$slug.tsx`)
- Keep the builder blank per your answer.
- Convert the banner `<Link>` into a styled button-link so it's an unmistakable, larger affordance (still using TanStack `<Link to="/p/$slug/demo" params={{ slug }}>`, which is the correct pattern). This rules out any "the link does nothing" perception caused by the small underlined text.

**D. Sanity fix: log a clear warning if `logoUrl` starts with `blob:`** (defensive, in `getPublicDemoBySlug` consumer side in `p.$slug.demo.tsx`) — coerce blob URLs to `null` so the brand-name fallback renders cleanly.

### Files touched
- `src/routes/_authenticated.dashboard.demo.tsx` — upload logo to storage; sanitize brand_overrides before save.
- `src/components/portal/HudPreview.tsx` — add `defaultHeaderVisible` prop.
- `src/routes/p.$slug.demo.tsx` — pass `defaultHeaderVisible`; coerce stale `blob:` logo to null.
- `src/routes/p.$slug.tsx` — promote View Demo CTA visually (no routing change).

### Out of scope
- The `/p/$slug` builder stays blank (per your answer).
- No DB migrations; uses existing public `brand-assets` bucket.
- No changes to the dashboard "View Live" anchor — it already works.

