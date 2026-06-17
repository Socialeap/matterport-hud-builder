# PWA / App Shell Memory

Scoped detail for the installable web-app layer. Part of **Public Marketing And PWA**
(see [operations-roadmap.md](operations-roadmap.md) and `PRODUCT_END_STATES.md` §K).
Source-of-truth is the service worker + cache policy on GitHub `main`, not this file.

## Status
- Current / Mixed — the app shell is live; richer offline + notification capabilities are planned.

## Current / shipped
- Installable web app shell: `public/manifest.webmanifest` (standalone, `start_url=/atlas?source=pwa`) + icons (`public/icons/`).
- Service worker `public/sw.js` (production-only registration; never auto-activates — user confirms an update, then one reload).
- Update manager: `src/components/pwa/ServiceWorkerManager.tsx`.
- Atlas-only install prompt (after engagement, hidden in standalone, iOS instructions): `src/components/pwa/InstallPrompt.tsx` + `src/lib/pwa/install-controller.mjs`.
- Branded offline fallback page `public/offline.html`.
- Conservative static caching `public/sw-cache-policy.js`: ALLOW = Vite hashed `/assets`, `/icons`, `manifest.webmanifest`, `offline.html`, `favicon.png`. Navigations are network-first → offline fallback; personalized HTML is never stored.
- Tests: `tests/pwa-manifest.test.mjs`, `tests/pwa-cache-policy.test.mjs`, `tests/pwa-install.test.mjs`.

## Boundaries (do NOT claim or implement without owner approval)
- No offline Matterport tours, offline Live Tour, or offline Atlas map data.
- No cached private/admin/API/server-function data, uploads, or offline dashboard workflows.
- Hard DENY in the cache policy: `/api`, `/admin`, `/dashboard`, `/agent-dashboard`, `/login`, `/forgot-password`, `/email`, `/p/`, `/_serverFn`, `/__server`. Defense-in-depth so a future allowlist widening cannot start caching auth/API/personalized responses.
- Do not broaden service-worker caching scope to any private/admin/API/upload/Matterport/Live-Tour surface without explicit owner approval.

## Future opportunities (planned, not built)
- Push notifications; long-running job/deploy/publish + TrueSpace conversion alerts.
- Local draft persistence; dashboard shortcuts; app badging; share-target; owner/admin docs availability.
