## Goal

1. Make `www.frontiers3d.com` the single canonical, user-facing domain for every public-facing route.
2. Replace every user-visible occurrence of the brand string `Frontiers3D` with `Frontiers|3D` (internal code comments and identifiers are left alone).

## Important finding — the redirect itself is not in code

Both `frontiers3d.com` and `3dps.transcendencemedia.com` are attached as custom domains on this Lovable project (see project URLs). The behavior you described — visiting `frontiers3d.com/p/transcendencemedia/builder` and ending up on `3dps.transcendencemedia.com/...` — is **not** caused by anything in `src/`. The TanStack routes serve identically on whichever host hits them. That redirect is configured at the **Lovable Publish / custom-domain layer** (one domain is marked primary and the others 301 to it).

To flip the primary, open **Publish → Domains** in Lovable and set `www.frontiers3d.com` as the primary custom domain. Once that's flipped, `3dps.transcendencemedia.com/...` will redirect to `www.frontiers3d.com/...` instead of the reverse. The code changes below make sure every share link, canonical, sitemap entry, email link, and crawler signal *already* points at frontiers3d.com so the flip is seamless.

I cannot toggle that publish setting from this session — it requires your confirmation in the Publish panel. I'll call it out again at handoff.

## Scope of code changes

### A. Canonical / SEO wiring (already mostly done — finish the gaps)

Audit shows these public routes already canonicalize to `https://www.frontiers3d.com/...`: `/`, `/agents`, `/atlas`, `/businesses`, `/opportunities`, `/privacy`, `/terms`, `/p/$slug`, `/card/$slug`. `src/lib/public-url.ts` already defaults all studio + share links to `www.frontiers3d.com`.

Gaps to close:

- `src/routes/privacy.tsx`, `src/routes/terms.tsx` — confirm both have canonical + og:url to `www.frontiers3d.com/...` (already do; leave).
- `src/routes/index.tsx` — verify `SITE_URL` is wired into JSON-LD homeUrl as well (currently uses constant). No change expected.
- `src/routes/__root.tsx` — sitewide `og:site_name` and JSON-LD already use `https://www.frontiers3d.com`. Leave structure; only edit brand string (see section C).
- `public/sitemap.xml.ts` — verify `BASE_URL` = `https://www.frontiers3d.com` and includes every public route (`/`, `/agents`, `/atlas`, `/businesses`, `/opportunities`, `/privacy`, `/terms`). Add any missing.
- `public/robots.txt` — verify `Sitemap:` line points to `https://www.frontiers3d.com/sitemap.xml`. Update if not.
- `public/llms.txt` — already correct (Pages list uses relative paths).

### B. Email template preview defaults (cosmetic, but visible to ops)

The following template files hardcode `https://3dps.transcendencemedia.com/...` in their **storybook/preview default props**. Replace with `https://www.frontiers3d.com/...` so previews and any accidental fallback render the canonical domain:

- `src/lib/email-templates/grant-expiry-warning.tsx`
- `src/lib/email-templates/beacon-match-found.tsx`
- `src/lib/email-templates/marketplace-outreach.tsx`
- `src/lib/email-templates/marketplace-lead-assigned.tsx` (two refs + the default-prop fallback)
- `src/lib/email-templates/service-match-ready.tsx`
- `src/lib/email-templates/trial-expired.tsx`
- `src/lib/email-templates/trial-purge-warning.tsx`

Real runtime sends already use `buildStudioUrl()` / `buildPlatformUrl()` (which return frontiers3d.com); these edits only fix the static demo defaults.

### C. Rebrand `Frontiers3D` → `Frontiers|3D` (user-visible strings only)

Replace in these files, only at user-visible string sites (titles, headings, meta descriptions, toasts, body copy, og: tags, JSON-LD `name`, footer text, button labels). **Do NOT** change code comments, JSDoc, file headers, or internal identifiers.

User-visible string locations to update:

- `src/routes/__root.tsx` — `title`, `description`, `og:site_name`, `og:title`, JSON-LD `WebSite.name`.
- `src/routes/atlas.tsx` — meta title/description, og:title, two body copy strings (lines ~425, 499, 500).
- `src/routes/businesses.tsx` — meta title (line 14), description (18), og:title (20), feature copy (40), hero aria-label (54), hero body (82), footer (173).
- `src/routes/agents.tsx` — body copy (306).
- `src/components/portal/AtlasOptInCard.tsx` — toast text (186), checkbox label (231).
- `src/components/portal/HudBuilderSandbox.tsx` — visible strings on lines 2451, 2497 (skip the comment on 1786).
- `src/routes/_authenticated.dashboard.orders.tsx` — line 160 helper text.
- `src/routes/_authenticated.dashboard.clients.tsx` — line 239 helper text.
- `src/routes/_authenticated.admin.atlas.tsx` — admin UI copy lines 299, 301, 356 (admin is technically authenticated, not "public," but the rebrand should still be consistent).
- `src/lib/email-templates/map-oracle-preview-offer.tsx` — body copy lines 151, 178, 211, 227 (outbound email — counts as public-facing).

Leave alone (internal, not user-visible):
- All `* Frontiers3D ...` JSDoc / header comments.
- `src/lib/atlas.functions.ts`, `src/lib/portal.functions.ts`, `src/routes/lovable/email/map-oracle/render.ts` (comment / internal-only string).
- `src/lib/public-url.ts`, `src/routes/sitemap[.]xml.ts`, `public/robots.txt` — these reference the domain `frontiers3d.com`, not the brand wordmark.

### D. Out of scope (will not change)

- Domain primary-flip in Lovable Publish (manual — flagged above).
- The `3dps.transcendencemedia.com` user-agent string in `src/server/geocode.server.ts` (internal identifier sent to Nominatim; not user-visible).
- Links to the marketing site `https://transcendencemedia.com` and `mailto:` addresses on `transcendencemedia.com` (separate marketing domain — out of scope).
- `routeTree.gen.ts` (auto-generated).

## Verification

- `rg "3dps\.transcendencemedia\.com" src/lib/email-templates/` → no matches.
- `rg "Frontiers3D" src/routes/ src/components/` → only matches inside `/*` comments or JSDoc.
- View `/` source in browser → `<link rel="canonical">` and `og:url` resolve to `https://www.frontiers3d.com/`.
- `curl https://www.frontiers3d.com/sitemap.xml` includes `/`, `/agents`, `/atlas`, `/businesses`, `/opportunities`, `/privacy`, `/terms`.
- Visual spot-check on `/atlas`, `/businesses`, `/agents`, builder pricing card, atlas opt-in card, orders + clients dashboard rows: wordmark reads `Frontiers|3D`.

## Handoff note to user

After this ships, open **Publish → Domains** in Lovable and set `www.frontiers3d.com` as the **primary** custom domain so `3dps.transcendencemedia.com` 301s to it instead of the other way around. That platform setting — not the code — is what governs the address bar.
