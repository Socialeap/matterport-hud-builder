## Goal

Give Shakoure a private, admin-only web URL (`/admin/visual-map`) to view `docs/operations/visual-map/index.html` from the Admin Portal. No public exposure, no copy into `public/`, no raw HTTP endpoint.

## Approach

Single admin-gated TanStack route. The docs HTML is imported as a bundled raw string via Vite's `?raw` query and rendered inside an `<iframe srcDoc={...} sandbox="allow-scripts">`. Auth is enforced by the existing `_authenticated.admin.tsx` layout (admin check + redirect). No `fs`, no server handler, no `/admin/visual-map/raw`.

## Changes

1. **New route** `src/routes/_authenticated.admin.visual-map.tsx`
   - `createFileRoute("/_authenticated/admin/visual-map")`.
   - `import visualMapHtml from "../../docs/operations/visual-map/index.html?raw";` (path verified relative to `src/routes/`).
   - Page layout:
     - Header: title **"Operation Visual Map"** + subcopy: *"Owner-facing orientation map. Source-of-truth remains Product End-States, GitHub main, Backend Activation, Current Queue, and STATUS.md when present."*
     - Optional "Open in new tab" link to `/admin/visual-map`.
     - Full-width `<iframe srcDoc={visualMapHtml} sandbox="allow-scripts" className="w-full h-[calc(100vh-180px)] border rounded" title="Operation Visual Map" />`.

2. **Admin nav link** in `src/routes/_authenticated.admin.tsx`
   - Add `<Link to="/admin/visual-map">Visual Map</Link>` in the admin header row (next to "Settings").

3. **README update** `docs/operations/visual-map/README.md`
   - Add "Private admin access" section noting:
     - URL: `/admin/visual-map`
     - Rendered from this docs HTML via Vite raw import (no duplication, no `public/` copy)
     - Not public, not indexed, not a source of truth
     - Update cadence: major milestones, backend activations, roadmap decisions, or weekly owner review

## What does NOT change

- `docs/operations/visual-map/index.html` — untouched, remains canonical.
- No `public/` copy. No sitemap entry. No public route. No raw HTTP endpoint.
- No `fs` / `path` / server file reads.
- No backend, migrations, RLS, Edge Functions, secrets, dependencies, Atlas runtime, Builder runtime, or `PRODUCT_END_STATES.md` changes.
- `src/routeTree.gen.ts` regenerates automatically — not hand-edited.

## Verification

- Signed-in admin → `/admin/visual-map` renders header + interactive iframe.
- Non-admin → redirected to `/dashboard` by existing admin layout.
- Signed-out → redirected to `/login` by `_authenticated` layout.
- No `/admin/visual-map/raw` exists; no `public/` copy exists.
- `git diff --name-only` → only: new route file, edit to `_authenticated.admin.tsx`, edit to README (+ auto-regenerated `routeTree.gen.ts`).
- `git diff --check` clean.
- `npm run verify:no-secrets` if present.

## End-State Alignment

- Component: Operations / owner-facing documentation
- Approved outcome advanced: Private admin access to the visual operation map without making it public or authoritative.
- Boundaries preserved: Admin-only via existing layout gate; docs file canonical; no raw unauthenticated endpoint; no public route; no backend changes.
- Cross-component effects: Improves owner / AI handoff orientation.
- Acceptance evidence: Manual admin / non-admin / signed-out sign-in test.
- Remaining gap: None.
- PRODUCT_END_STATES.md revision required: NO

## Backend Activation Required: NO

Reason: Frontend-only admin route with a bundled raw import. No migrations, Edge Functions, RLS, storage, or secrets.
