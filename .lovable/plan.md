## Diagnosis

There are two distinct problems on `/dashboard/branding`:

### 1. Re-render loop (the visible bug)

In `src/routes/_authenticated.dashboard.branding.tsx`, the `<StudioPreviewPanel>` is rendered with:

```tsx
hasUnsavedChanges={
  JSON.stringify(branding) !== JSON.stringify(savedSnapshot) ||
  !!logoFile || !!faviconFile || !!heroFile
}
```

That itself doesn't cause a loop. The actual loop comes from how the iframe is keyed in `StudioPreviewPanel.tsx`:

```tsx
<iframe
  key={`${refreshKey}-${manualBump}-${device}`}
  src={embedUrl}
  ...
/>
```

The iframe loads `/p/${slug}` **same-origin**. That page mounts the full app shell — including our auth/session listeners (`useAuth`) and `MspAccessProvider`. Same-origin iframes share storage and `BroadcastChannel`/`storage` events with the parent. When the iframe initializes Supabase auth, it emits an `onAuthStateChange` `INITIAL_SESSION` / `TOKEN_REFRESHED` event that the **parent** also receives (because the Supabase client uses the shared `localStorage` and a `BroadcastChannel`). That re-runs the parent's `useAuth` subscribers → `user` reference changes → `fetchBranding` callback identity changes → `useEffect` re-runs → `setBranding(next)` with a fresh object → `branding !== savedSnapshot` becomes true via reference-equal `JSON.stringify`, but more importantly the new `branding` object is a new reference each fetch → re-render → the iframe reloads when it triggers another auth event → loop.

Compounding it: every parent render creates a brand-new `hasUnsavedChanges` boolean and a new `StudioPreviewPanel` props object. The panel itself is fine, but each fetch replaces `branding` with a **new object** even when DB content is unchanged (line 116 `setBranding(next)` always creates a fresh object). Combined with the iframe-triggered cross-tab auth events, this produces the visible re-render loop the user sees.

### 2. Sandbox warning

```
An iframe which has both allow-scripts and allow-same-origin for its sandbox
attribute can escape its sandboxing.
```

This is a Chromium warning — having both flags effectively disables sandbox isolation. Since the iframe is same-origin to the dashboard (and shares cookies/localStorage/auth), keeping `allow-same-origin` is also what causes problem #1. The plan already noted "no new exposure" because the page is public, but in practice the embedded app is grabbing the dashboard's auth session.

## Fix

Two coordinated changes, both in safe scope (no DB, no routes, no public pages affected):

### A. `src/components/dashboard/StudioPreviewPanel.tsx` — remove `allow-same-origin`

Change the iframe sandbox to:

```tsx
sandbox="allow-scripts allow-popups allow-forms"
```

Effects:
- Browser warning goes away.
- The iframe runs as a unique opaque origin → it cannot read the dashboard's `localStorage`, cookies, or Supabase session → no cross-tab auth event leaks back into the parent → loop root cause removed.
- The `/p/$slug` page is the public client-facing Studio; it's designed to render without the dashboard's auth. Anonymous Supabase reads of `branding_settings` still work via RLS (same as a real visitor).
- The "Open in new tab" link is unchanged and still gives the MSP a fully-authenticated, real-world view if needed.

Also drop the iframe `key` dependency on `device` — width changes shouldn't trigger a full reload (we change wrapper width, not src). Keep `key={`${refreshKey}-${manualBump}`}` so manual refresh and post-save still reload.

### B. `src/routes/_authenticated.dashboard.branding.tsx` — stabilize dirty-check & avoid needless re-renders

1. Memoize `hasUnsavedChanges` with `useMemo` so the panel doesn't get a new prop value on every keystroke render of unrelated state. The check itself stays the same logic but is referentially stable per relevant input:

```tsx
const hasUnsavedChanges = useMemo(
  () =>
    JSON.stringify(branding) !== JSON.stringify(savedSnapshot) ||
    !!logoFile || !!faviconFile || !!heroFile,
  [branding, savedSnapshot, logoFile, faviconFile, heroFile],
);
```

2. In `fetchBranding`, only `setBranding`/`setSavedSnapshot` if the fetched payload actually differs from the current `savedSnapshot`. Compare via `JSON.stringify(next) !== JSON.stringify(savedSnapshot)` before setting. This prevents redundant state churn if the effect re-fires on auth events. Use a `useRef` for the snapshot so the callback's identity doesn't depend on it (keeps `fetchBranding` referentially stable).

3. Wrap the `<StudioPreviewPanel>` props with the memoized value:

```tsx
<StudioPreviewPanel
  slug={savedSnapshot.slug}
  tier={savedSnapshot.tier}
  customDomain={savedSnapshot.custom_domain}
  hasUnsavedChanges={hasUnsavedChanges}
  refreshKey={previewVersion}
/>
```

These two changes together (A removes the leak source; B is a defense-in-depth so unrelated re-renders never thrash the iframe again).

## Trade-offs considered

- **Keep `allow-same-origin`, fix only the React side**: Risky — even if we stabilize React, we'd still leak the dashboard's auth session into a `/p/$slug` page that's meant to be anonymous. Browser would still warn. Rejected.
- **Use `srcDoc` with a stub document**: Loses the live render. Rejected.
- **Render `/p/$slug` via a dedicated `/preview/...` route with `?preview=1`**: More invasive; not needed once sandbox is correct.
- **Drop the iframe entirely and inline the Studio component**: Couples dashboard to Studio internals; would need to thread unsaved branding through props. Rejected — preview-of-saved-state is the correct UX per the original plan.

## Files to edit

- `src/components/dashboard/StudioPreviewPanel.tsx` — change sandbox attribute, drop `device` from iframe key.
- `src/routes/_authenticated.dashboard.branding.tsx` — `useMemo` for `hasUnsavedChanges`, equality-guard inside `fetchBranding`, `useRef` for snapshot to keep callback stable.

No changes to: `/p/$slug` page, public URL helpers, Supabase schema, RLS, auth, gating logic, or any other dashboard routes.

## Verification

After the fix:
- Open `/dashboard/branding` → page renders once, iframe loads `/p/<slug>` once, no console warning.
- Edit a color → iframe stays on last-saved view, "unsaved changes" amber banner appears (no reload).
- Click Save → snapshot updates, banner clears, iframe reloads exactly once (`previewVersion` bump).
- Click Refresh → iframe reloads exactly once (`manualBump`).
- Toggle device → wrapper width changes; iframe does not reload.
- Open in new tab → still uses `buildStudioUrl` (custom domain for Pro).
