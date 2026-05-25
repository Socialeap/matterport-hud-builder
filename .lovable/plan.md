## Goal

Make the MSP's uploaded favicon appear in the browser tab on **both** the studio landing page (`/p/$slug`) and the builder page (`/p/$slug/builder`). Today only the landing page overrides the parent app's `/favicon.png`; the builder still inherits the Transcendence Media icon from `__root.tsx`.

## Why the builder is broken

`src/routes/__root.tsx` injects `<link rel="icon" href="/favicon.png">`. TanStack Router concatenates `<link>` entries without dedup, and browsers honor the first `rel="icon"` they see. The landing route already has a runtime `useEffect` that purges every `link[rel="icon" | "shortcut icon" | "apple-touch-icon"]` and replaces them with `branding.favicon_url` (falling back to `branding.logo_url`). The builder route (`src/routes/p.$slug.builder.tsx`) loads the same `branding` row but never runs that override, so the TM favicon wins.

## Changes

1. **Extract the favicon override into a small shared hook** so the logic stays identical and we don't duplicate the MIME-type detection / purge code.

   New file: `src/hooks/use-branded-favicon.ts`
   - Exports `useBrandedFavicon(faviconUrl?: string | null, logoUrl?: string | null)`.
   - Body is the same `useEffect` already in `p.$slug.index.tsx` lines 406–439 (purge competing icons, infer MIME from extension, inject new `rel="icon"` + `rel="apple-touch-icon"`).
   - SSR-safe (`if (typeof document === "undefined") return;`).
   - Cleanup on unmount: when the component unmounts or `branding` becomes unavailable, restore the parent `/favicon.png` so navigating back to non-MSP routes (e.g. `/dashboard`) doesn't leave the previous MSP's icon stuck in the tab.

2. **Use the hook on the landing route**
   File: `src/routes/p.$slug.index.tsx`
   - Replace the inline `useEffect` (lines 401–439) with `useBrandedFavicon(branding?.favicon_url, branding?.logo_url)`. No behavior change.

3. **Use the hook on the builder route**
   File: `src/routes/p.$slug.builder.tsx`
   - Inside `BuilderPage`, after `const { branding } = Route.useLoaderData();`, call `useBrandedFavicon(branding?.favicon_url, branding?.logo_url)`. This is the fix.

## What stays the same

- Parent app default favicon in `__root.tsx` — untouched.
- Branding upload flow (`BrandingSection`, `uploadBrandAsset`, `branding_settings.favicon_url` / `logo_url`) — untouched. The MSP already has the UI to upload a favicon (and to fall back to their logo if no favicon is provided).
- No database, RLS, or server-function changes.
- No changes to `HudBuilderSandbox` or any other component.

## Verification

- Load `/p/<slug>` for an MSP with a custom favicon → tab icon = MSP favicon (already works, must not regress).
- Load `/p/<slug>/builder` for the same MSP → tab icon = MSP favicon (the fix).
- For an MSP with no `favicon_url` but a `logo_url` → both pages use the logo.
- Navigate `/p/<slug>/builder` → `/dashboard` → tab icon resets to the parent `/favicon.png` (cleanup).
- SSR build: hook is a no-op on the server; no hydration warning.
