## Problem

The live site (`matterport-hud-builder.lovable.app` / `3dps.transcendencemedia.com`) is serving a bundle built **before** the Supabase key rotation. Its baked-in `VITE_SUPABASE_PUBLISHABLE_KEY` is no longer valid, producing the "Missing Supabase environment variables" crash. The preview is fine because it rebuilt against the new managed `.env`.

The Publish button is grayed out because Lovable's publish system compares **source code hashes**, not environment values. Since no source files have changed since the last publish, it thinks there's nothing new to deploy — even though the *build inputs* (env vars) have changed.

## Fix

Make a trivially small, no-op source change so the publish system sees a delta and rebuilds. The rebuild will pick up the rotated `VITE_SUPABASE_PUBLISHABLE_KEY` from the managed `.env` and produce a working bundle.

### Step 1 — Touch one file with a harmless edit

Add a single comment line to `src/router.tsx` (or any other source file). Example:

```ts
// Rebuild marker: refresh published bundle after key rotation 2026-05-11
```

This changes the file hash without altering any runtime behavior. No logic, types, or imports are affected.

### Step 2 — Publish

The Publish button will become active. Click **Publish → Update**. Wait for the build to finish.

### Step 3 — Verify

1. Hard-refresh the live site (Cmd/Ctrl+Shift+R) to bypass the cached old bundle.
2. Open DevTools → Network and confirm the new `index-*.js` filename differs from `index-B_IvnPv_.js`.
3. Confirm the homepage renders without the "Something went wrong" error.
4. If you have a custom-domain visitor, do the same hard-refresh on `3dps.transcendencemedia.com`.

## Why not other approaches

- **Reconnecting the Supabase integration** would also work but is heavier and risks touching unrelated config.
- **Editing `.env` directly** is blocked — that file is managed by the platform.
- **Code changes to `client.ts`** are unnecessary; the file is correct, it just needs a fresh build.

## Technical detail

`src/integrations/supabase/client.ts` reads `import.meta.env.VITE_SUPABASE_URL` and `import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY`. Vite inlines those at **build time**, so a published bundle's keys are frozen until the next build. The rotated keys are already present in the sandbox env (preview proves it) — we just need to trigger a new production build to bake them in.