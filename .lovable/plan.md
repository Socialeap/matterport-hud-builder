## Goal

Make `www.frontiers3d.com` the canonical home for the new Atlas pages. Both custom domains continue to serve the app; this change only fixes the SEO/share metadata and discoverability so search engines, link previews, and AI crawlers attribute Atlas to `frontiers3d.com` (matching `/`, `/agents`, `/privacy`, `/terms`, etc.).

## Why this is needed

The new Atlas routes don't actually live on a specific domain — TanStack routes are domain-agnostic and already resolve on `frontiers3d.com`, `www.frontiers3d.com`, and `3dps.transcendencemedia.com`. But unlike every other public page, `/atlas` currently has:
- no `og:url`
- no `<link rel="canonical">`
- no entry in `sitemap.xml`
- no entry in `public/llms.txt`

That's why it looks "tied" to the wrong domain — crawlers and shares have nothing pointing them at `frontiers3d.com`.

## Changes

### 1. `src/routes/atlas.tsx` — add canonical + og:url

Extend the existing `head()` with:
- `{ property: "og:url", content: "https://www.frontiers3d.com/atlas" }`
- `links: [{ rel: "canonical", href: "https://www.frontiers3d.com/atlas" }]`

(Leaf-only canonical, per TanStack head rules.)

### 2. `src/routes/sitemap[.]xml.ts` — add `/atlas`

Append one entry:
```ts
{ path: "/atlas", changefreq: "daily", priority: "0.8" }
```

`BASE_URL` is already `https://www.frontiers3d.com`, so this also emits the correct domain.

### 3. `public/llms.txt` — list Atlas under Pages

Add:
```
- [Atlas](/atlas): Interactive dark-themed map of verified immersive 3D listings.
```

### 4. Admin route stays noindex-by-default

`/admin/atlas` is behind `_authenticated` and admin gating — no canonical, no sitemap entry, no llms.txt mention. No change needed.

## Out of scope (per your answer)

- No server-side redirect from `3dps.transcendencemedia.com` → `www.frontiers3d.com`. Both domains keep serving the app; only crawlers and share previews are steered to `frontiers3d.com`.
- No changes to email templates, edge functions, or backend code that still reference `3dps.transcendencemedia.com` (those are tracked separately in `BACKEND_ACTIVATION.md`).
- No DB / RLS / migration work.

## Verification

- View source of `/atlas` and confirm `<link rel="canonical" href="https://www.frontiers3d.com/atlas">` and `og:url` are present.
- `curl https://www.frontiers3d.com/sitemap.xml` includes `<loc>https://www.frontiers3d.com/atlas</loc>`.
- `curl https://www.frontiers3d.com/llms.txt` includes the Atlas line.

## Backend Activation Required: NO
Frontend metadata + static file edits only.
