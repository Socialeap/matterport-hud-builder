# Domain Migration → Frontiers3D + Spatial-Agnostic Note

Shift the platform's canonical web identity from `3dps.transcendencemedia.com` to `www.frontiers3d.com` across SEO surfaces, and document the spatial-agnostic architecture direction. **No DB schema, no edge functions, no email templates, no backend endpoints touched.**

## Scope

### 1. Core constant
- `src/routes/index.tsx` line 59: `SITE_URL` → `"https://www.frontiers3d.com"`. All derived values (`OG_IMAGE`, `og:url`, canonical, JSON-LD `url`) update automatically since they reference `SITE_URL`.

### 2. SEO surfaces (canonical, og:, JSON-LD)
- `src/routes/__root.tsx` — JSON-LD Organization/WebSite `@id`, `url`, and `logo` fields → `https://www.frontiers3d.com`. Update `name` from "3D Presentation Studio" to "Frontiers3D" and `og:site_name` / default title accordingly.
- `src/routes/sitemap[.]xml.ts` — `BASE_URL` → `https://www.frontiers3d.com`.
- `public/robots.txt` — `Sitemap:` line → `https://www.frontiers3d.com/sitemap.xml`.
- `src/lib/public-url.ts` — `FALLBACK_PRODUCTION_DOMAIN` + doc comments → `https://www.frontiers3d.com`. (This is the canonical platform-URL builder used by invitations, OAuth, password resets, studio links.)
- `src/routes/privacy.tsx` + `src/routes/terms.tsx` — canonical/og:url meta entries → frontiers3d.com.
- `src/routes/p.$slug.index.tsx`, `src/routes/card.$slug.tsx`, `src/routes/agents.tsx`, `src/routes/opportunities.tsx` — any hardcoded `3dps.transcendencemedia.com` in head meta → frontiers3d.com.

### 3. Architectural comment
Add a top-of-file block comment in `src/routes/index.tsx` (and a brief mirror in `src/routes/__root.tsx`) noting:
> The platform is intentionally **spatial-agnostic**. Matterport is the current primary 3D source, but the presentation engine, HUD, AI Concierge, and data model are designed to accept any spatial source — including Google Street View panoramas and Genie 3 generative world coordinates — without core rewrites. Future work will add adapters under a unified spatial-source interface.

## Explicitly NOT in scope (will leave alone)

- Database schema, RLS, migrations, edge functions, Supabase config.
- Email templates (`src/lib/email-templates/*`), email infrastructure routes (`src/routes/lovable/email/**`), and the email-sender domain (`notify.3dps.transcendencemedia.com`). Keeping these stable avoids breaking DKIM/SPF until a Frontiers3D email domain is provisioned separately.
- Parent-company footer references in `src/routes/index.tsx` (`https://transcendencemedia.com`, `info@transcendencemedia.com`). These point to the parent company brand, not the product domain, so they remain unless you say otherwise.
- Project-wide rename of the product name string "3D Presentation Studio" → "Frontiers3D" inside body copy, dashboards, and email subjects. I will only update SEO/JSON-LD identity fields (which crawlers consume). A full product-name rebrand is a separate, larger pass — confirm if you want it bundled in.

## Technical notes

- `SITE_URL` uses `www.frontiers3d.com` per your instruction. To avoid duplicate-content with the apex, the apex `frontiers3d.com` should 301 to `www` at the hosting/DNS layer (out of code scope — flagging it).
- `VITE_PUBLIC_SITE_URL` env var still overrides `public-url.ts` if set; ensure the deployment env either unsets it or sets it to `https://www.frontiers3d.com`.
- Custom-domain list already includes `frontiers3d.com` and `www.frontiers3d.com`, so routing is already live.
- No new dependencies, no migrations, no destructive operations.

**Backend Activation Required: NO** — pure frontend config + SEO meta + comments.

## Open question

Want me to also bundle the in-body product-name rebrand ("3D Presentation Studio" → "Frontiers3D" in dashboard headers, landing page copy, footer)? If yes, say so and I'll fold it in; if not, I'll keep this PR tightly scoped to SEO identity + the architectural comment.
