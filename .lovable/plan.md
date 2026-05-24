
## Goal

Turn the 3-step manual Netlify Drop workflow in `PublishDistributeSection.tsx` into a single "Connect Netlify → Choose URL → Publish" flow that never makes the agent leave the app or touch a `.zip` file.

## Prerequisite (user action required)

Netlify OAuth needs an app registered by us:

1. User (or we, on their behalf) registers an OAuth application at https://app.netlify.com/user/applications → **New OAuth app**.
2. Redirect URI: `https://matterport-hud-builder.lovable.app/api/public/netlify-oauth-callback` (and the preview/custom-domain equivalents — Netlify allows multiple).
3. We store the resulting **Client ID** and **Client Secret** as Lovable Cloud secrets (`NETLIFY_OAUTH_CLIENT_ID`, `NETLIFY_OAUTH_CLIENT_SECRET`). Client ID also exposed publicly as `VITE_NETLIFY_OAUTH_CLIENT_ID` for the popup URL.

I'll request these via the secrets tool at the start of build.

## UX flow (new PublishDistributeSection)

```text
┌─ Connect Netlify ─────────────────────────────┐
│ [Connect your Netlify Account]   (or)  ✅ Connected as jane@acme.com  [Disconnect] │
└────────────────────────────────────────────────┘
┌─ Choose your URL ─────────────────────────────┐
│ https:// [ socialeap-tour      ] .netlify.app │
│   ✓ available    (or)  ✗ taken, try another   │
└────────────────────────────────────────────────┘
┌─ Publish ─────────────────────────────────────┐
│ [ 🚀 Publish Presentation ]                   │
│   ↳ "Packaging files…" → "Uploading to Netlify…" → "Renaming site…" → ✅ Live │
└────────────────────────────────────────────────┘
┌─ Live URL + Share Kit (auto-revealed) ────────┐
│ https://socialeap-tour.netlify.app  [Copy] [Open] │
│ (existing Listing Launch Kit renders here)    │
└────────────────────────────────────────────────┘
```

The old Step 1 (download zip), Step 2 (open Netlify), Step 3 (paste URL) cards are removed. The Listing Launch Kit (link list + QR codes) is preserved and now triggered automatically by the deploy success instead of by manual URL paste.

## Implementation

### 1. Netlify OAuth (Authorization Code flow)

- **Popup launcher (client):** `window.open` to `https://app.netlify.com/authorize?client_id=…&response_type=code&redirect_uri=…&state=<random>`. Sized popup, listen for `postMessage` from the callback page with the token.
- **Server callback route:** `src/routes/api/public/netlify-oauth-callback.ts` (public so Netlify can hit it without auth). Exchanges `code` → `access_token` via `POST https://api.netlify.com/oauth/token` using the client secret, then returns an HTML page that does `window.opener.postMessage({ token, user }, origin)` and closes.
- **Token storage:** `sessionStorage` keyed per builder slug (per spec: "store … for that user session"). Not persisted to DB — keeps blast radius small and matches the "session" requirement. A small `useNetlifyAuth()` hook wraps connect / disconnect / token / current user (fetched from `GET /api/v1/user`).

### 2. Custom slug input

- Controlled `<Input>` with live regex validation `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$` (Netlify subdomain rules), auto-lowercase, hyphenate spaces.
- Debounced availability check via `GET https://api.netlify.com/api/v1/sites?name=<slug>` (returns the site if taken). Shows ✓/✗ inline.
- Default slug seeded from `propertyName` slugified.

### 3. One-click deploy

New helper `src/lib/portal/netlify-deploy.ts`:

1. **Build the zip in memory.** The existing download flow assembles the presentation package and triggers a browser download. I'll refactor that path so the underlying "build package → Blob" step is callable directly (returning the `Blob`) and the existing download button becomes a thin wrapper that saves it. The new Publish button consumes the same Blob in memory — no double-implementation, no double-pricing trigger.
2. `POST https://api.netlify.com/api/v1/sites` with `Content-Type: application/zip`, body = the Blob, `Authorization: Bearer <token>`. Response gives `{ id, ssl_url, name, deploy_id }`.
3. Poll `GET /api/v1/sites/{id}/deploys/{deploy_id}` until `state === "ready"` (or `"error"`), with a spinner label "Uploading to Netlify…" → "Finalizing deploy…".
4. `PATCH /api/v1/sites/{site_id}` (Netlify uses PATCH for site updates; PUT works too — I'll use PATCH per current docs) with `{ "name": "<slug>" }`. On 422 "name already taken" we surface a toast and keep the auto-generated `.netlify.app` URL as fallback, prompting the user to pick a different slug and rename.
5. Final live URL = `https://<slug>.netlify.app` (fall back to `ssl_url` if rename failed).

### 4. Success state + Share Kit

- On success, set `liveUrl` state to the final URL. The existing Listing Launch Kit block already keys off `liveUrl` and will render link list + QR downloads automatically.
- Toast `"Your presentation is live!"` with a Copy URL button.
- Errors → `toast.error(...)` with a friendly message; raw API errors logged to console only.

### 5. Removed / replaced

- Delete the three numbered Step cards (download / open Netlify / paste URL).
- Delete the `openNetlifyPublishWindow`, popup-blocked banner, URL paste form, and the `normalizeLiveUrl` validator (no longer needed; URL is generated by us).
- Keep `buildShareUrl`, `slugifyForFilename`, the QR rendering, and the Listing Launch Kit.

## Files

| File | Change |
|---|---|
| `src/components/portal/PublishDistributeSection.tsx` | Rewrite top half (steps 1–3) into Connect / Slug / Publish cards. Keep Listing Launch Kit. |
| `src/hooks/useNetlifyAuth.ts` | **NEW** — popup launcher, message listener, sessionStorage token, current-user fetch. |
| `src/lib/portal/netlify-deploy.ts` | **NEW** — `deployZipToNetlify(blob, slug, token)` with progress callbacks. |
| `src/lib/portal/netlify-slug.ts` | **NEW** — slug validation + availability check. |
| `src/routes/api/public/netlify-oauth-callback.ts` | **NEW** — server route that exchanges `code` → token and `postMessage`s back. |
| `src/routes/p.$slug.builder.tsx` (or wherever `onDownload` is wired) | Refactor download path to expose an in-memory Blob builder reused by both Download and Publish. |
| Secrets | `NETLIFY_OAUTH_CLIENT_ID`, `NETLIFY_OAUTH_CLIENT_SECRET`, plus `VITE_NETLIFY_OAUTH_CLIENT_ID` mirror for the popup URL. |

## Open questions before I build

1. **Keep the manual "Download .zip" button as a secondary option?** Some users may still want the file for backup or to host elsewhere. I'd suggest keeping it as a small "Advanced: download package" link below the Publish button — confirm or I'll remove it entirely.
2. **Token persistence:** session-only (clears on tab close, matches your spec) vs persisted to the user's profile so they don't re-auth every visit. I'll go with **session-only** unless you'd prefer persisted.
3. **Pricing/paywall:** the current download flow runs through a `pay-and-download` gate (`downloading`, `downloadDisabledReason`). Should the Publish button respect the **same** paywall (i.e. publishing counts as a download)? I'll assume **yes** — same gate, same one-time charge — unless told otherwise.

Reply with answers (or "go") and I'll switch to build mode.
