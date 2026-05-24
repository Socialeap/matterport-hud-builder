## Root cause

The Netlify popup showing **"Error during authorization — Not Found"** is not a code bug. Netlify's `/authorize` endpoint returns "Not Found" when the `redirect_uri` we pass does not exactly match a URI registered on the **3DPS Studio** OAuth application. Our code correctly builds the redirect URI from the current browser origin — the registered URIs in Netlify just don't include the origin you were testing on.

## Action items

### 1. Netlify dashboard (you — no code change)

In **Netlify → User settings → Applications → OAuth applications → 3DPS Studio**, register exactly these Redirect URIs (no trailing slash, one per line):

```
https://matterport-hud-builder.lovable.app/api/public/netlify-oauth-callback
```

Per your answer, we intentionally **do not** register `id-preview--*.lovable.app`. Connect Netlify can be started from the published site and the custom domain, but it now uses the published site as the single canonical OAuth callback to avoid host-specific mismatch failures.

### 2. Code changes (I will make)

**A. Unsupported-origin guard in `PublishDistributeSection.tsx`**
- Detect when `window.location.origin` is not the published site or custom domain.
- Disable the **Connect Netlify** button on preview and show an inline notice: *"Publishing requires the live site. Open this app at matterport-hud-builder.lovable.app or 3dps.transcendencemedia.com to connect Netlify."* with a button that opens the published URL in a new tab, preserving the current builder state via query params where feasible.

**B. Harden popup error path in `useNetlifyConnection.ts`**
- Track popup lifecycle with three terminal states: `success`, `error`, `cancelled`.
- Add a **90-second timeout**: if no `postMessage` from the callback arrives, mark as `error` with message `"Sign-in timed out. The redirect URI may not be registered on the Netlify OAuth app."`.
- Add a **popup-closed poll** (every 500ms): if `popup.closed === true` before a success message, mark as `cancelled` with message `"Sign-in cancelled or the redirect URI isn't registered on Netlify. See setup instructions."`.
- Clear the polling/timeout on any terminal state to avoid leaks.
- Expose `lastError: string | null` and `clearError()` from the hook.

**C. Surface the error in `PublishDistributeSection.tsx`**
- Replace the silent "Connecting…" state. When `lastError` is set:
  - Show a destructive inline Alert with the message.
  - Include a "Retry" button (calls `clearError()` + `connect()`).
  - Include a collapsible "Setup instructions" disclosure listing the two redirect URIs to register and a link to Netlify OAuth applications settings.
- Also `toast.error(lastError)` so it isn't missed if the panel is scrolled.

**D. Callback hardening in `src/routes/api/public/netlify-oauth-callback.ts`**
- If Netlify returns with `?error=...&error_description=...`, render an HTML page that `postMessage`s `{ type: 'netlify-oauth', status: 'error', message }` to `window.opener` and closes — so the popup never gets stuck on a Netlify error page without the parent knowing.
- Same treatment for token-exchange failures (currently they likely surface as a blank/error page with no parent notification).

### 3. What I will NOT change

- The OAuth flow itself, server-side token storage, deploy logic, slug validation, or the `publishInterceptorRef` wiring — all of that is working and unrelated to the "Not Found" error.
- The publish/deploy logic after OAuth succeeds.

## Verification after changes

1. On preview: Connect button is disabled with the explanatory notice.
2. On published site (after you register the URI): full flow succeeds end-to-end.
3. Simulated failure (temporarily unregister the URI): popup shows Netlify's "Not Found", auto-closes via timeout, inline Alert appears in the Publish panel with retry + setup instructions.

## Files touched

- `src/hooks/useNetlifyConnection.ts` — timeout, popup-closed detection, error state
- `src/components/portal/PublishDistributeSection.tsx` — preview guard, error Alert, retry, instructions
- `src/routes/api/public/netlify-oauth-callback.ts` — postMessage on Netlify error / exchange failure
