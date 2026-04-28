## Goal

Brand the main landing page with the Transcendence Media identity:

1. Show the **Transcendence Media landscape logo** on the left side of the header (to the left of  "3D Presentation Studio" text wordmark) — clickable, links to `https://transcendencemedia.com`.
2. Set the **round TM logo** as the browser tab favicon.
3. Use the **3D Presentation Studio image** as the OpenGraph / Twitter social-share preview image.

## Asset plan

Copy the three uploaded images into the project:


| Upload                            | Destination                            | Used for                                            |
| --------------------------------- | -------------------------------------- | --------------------------------------------------- |
| `TM_LOGO_Landscape_Trnsp.png`     | `src/assets/tm-logo-landscape.png`     | Header logo (imported as ES module)                 |
| `TM-Logo-Round-Trnsp-FAVICON.png` | `public/favicon.png`                   | Browser tab favicon (referenced by URL)             |
| `3D_Presentation_Studio.png`      | `public/og-3d-presentation-studio.png` | OG/Twitter share image (referenced by absolute URL) |


Rationale: components/HMR-friendly assets go under `src/assets`; static URL-referenced assets (favicon, OG image consumed by external scrapers) go under `public/` so they live at predictable absolute paths.

## Code changes

### 1. `src/routes/__root.tsx` — favicon

Add a `links` entry in the root route's `head()`:

```ts
links: [
  { rel: "stylesheet", href: appCss },
  { rel: "icon", type: "image/png", href: "/favicon.png" },
  { rel: "apple-touch-icon", href: "/favicon.png" },
],
```

(Per TanStack SSR head guidance: root sets defaults; child route metadata still overrides title/description.)

### 2. `src/routes/index.tsx` — header logo + OG image

- Add import: `import tmLogo from "@/assets/tm-logo-landscape.png";`
- Replace the `OG_IMAGE` constant:
  ```ts
  const OG_IMAGE = `${SITE_URL}/og-3d-presentation-studio.png`;
  ```
  (The existing `og:image:width`/`height` of 1200×630 stays — the uploaded image is wide-aspect and will display correctly; social platforms will letterbox if needed. No dimension change required.)
- Replace the header brand text (lines ~429–431):
  ```tsx
  <a
    href="https://transcendencemedia.com"
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center"
    aria-label="Transcendence Media — visit main site"
  >
    <img
      src={tmLogo}
      alt="Transcendence Media"
      className="h-8 w-auto sm:h-9"
    />
  </a>
  ```
  Sizing rationale: the landscape logo has a wide aspect ratio (~2.5:1). At `h-8` (32px) it occupies ~80px wide, comfortably fitting the existing 56px-tall header without crowding the nav links or pushing the mobile menu button. `w-auto` preserves aspect ratio; no layout shift since the header already uses `flex items-center justify-between`.

### 3. JSON-LD structured data

The existing `image: OG_IMAGE` line in the SoftwareApplication JSON-LD automatically picks up the new OG image URL since it references the same constant. No additional change needed.

## Verification path

After edits, the auto-build will:

- bundle `tm-logo-landscape.png` with a hashed URL via Vite asset pipeline.
- serve `/favicon.png` and `/og-3d-presentation-studio.png` directly from `public/`.
- inject the new `<link rel="icon">` and updated `<meta property="og:image">` during SSR so social scrapers (Facebook/LinkedIn/Twitter/Slack) and browser tabs see them on first load.

## Out of scope

- No change to the published-domain favicon route, footer, or other pages — only the root layout (favicon) and `/` route (header + OG) change.
- "Powered by Transcendence Media" co-branding in Starter-tier output is unaffected.
- The header text "3D Presentation Studio" is removed in favor of the logo; if you'd prefer to keep both (logo + small wordmark beside it), say the word and I'll add it.