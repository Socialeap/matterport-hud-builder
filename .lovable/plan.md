## Diagnosis

The current regression is caused by the interaction between these recent changes:

1. The Branding page iframe was changed back to `sandbox="allow-scripts ... allow-same-origin"` so the embedded `/p/:slug?preview=studio` page could read the parent page's Lovable Cloud auth session.
2. That makes the iframe same-origin and script-capable, so it boots a second full copy of the app with the same auth storage key as the parent dashboard.
3. Both the parent dashboard and iframe instantiate the Lovable Cloud auth client, call `getSession()`, subscribe to `onAuthStateChange`, and start token auto-refresh against the same browser storage lock.
4. The public Studio route also calls `getSession()` and performs profile/role queries even for unpaid gating, so a non-paying MSP previewing the page creates extra auth lock pressure.
5. The auth callback in `src/routes/p.$slug.index.tsx` calls an async `load()` from `onAuthStateChange`, which can overlap with the initial `getSession()` load and with auto-refresh/visibility events. This matches the reported error: `Lock ... auth-token was released because another request stole it`.

The Chrome sandbox warning is not itself the loop, but it is a red flag that the previous preview fix reintroduced a same-origin iframe that competes with the parent auth client.

I also verified the specific slug `fbiib` in the database: `provider_has_paid_access` returns `false`, with no active license, no completed purchase, and no active admin grant. So the backend entitlement check is correct; the loading issue is on the front-end auth/preview path.

## Safest fix

### 1. Remove auth from the embedded preview iframe

Update `src/components/dashboard/StudioPreviewPanel.tsx` so the dashboard iframe does **not** use the public route's auth-bypassed preview mode.

Instead of embedding:

```text
/p/:slug?preview=studio
```

embed a new non-auth public-preview mode, for example:

```text
/p/:slug?embed=studio-preview
```

Then remove `allow-same-origin` from the iframe sandbox:

```text
sandbox="allow-scripts allow-popups allow-forms"
```

This restores browser isolation and prevents the iframe from sharing the parent's Lovable Cloud auth storage/lock.

The iframe can still render branding/UI, but it should never rely on the user's auth session to bypass the paywall.

### 2. Keep external preview link authenticated, but not iframe-based

Keep the unpaid dashboard button as an explicit owner/admin preview link:

```text
/p/:slug?preview=studio
```

This opens in a new top-level tab, where only one app/auth client owns the page's storage lock. It is far less risky than running same-origin auth inside an iframe embedded in the dashboard.

Paid users still get the bare live Studio URL.

### 3. Refactor `/p/:slug` gating to avoid auth for public and iframe preview cases

Update `src/routes/p.$slug.index.tsx` gating order:

- If `providerActive === true`: render the live Studio immediately.
- If unpaid and `embed=studio-preview`: render the Studio immediately as an isolated dashboard embed, without calling `supabase.auth.getSession()`, without subscribing to auth events, and with a clear preview banner. This mode is not a security boundary because it is only a visual preview of the landing page content; the true public URL remains gated.
- If unpaid and not a preview request: render `Studio Coming Soon` immediately. No auth check is required, so the public page cannot get stuck in a session-loading spinner.
- If unpaid and `preview=studio`: only then perform a lightweight owner/admin check before showing the preview. If the check completes and the viewer is not owner/admin, show `Studio Coming Soon`.

This eliminates the current problem where an unpaid bare URL can sit in a loading state waiting for auth/session work.

### 4. Make the public Studio auth check single-flight and non-blocking-safe

For the `preview=studio` top-level preview only:

- Replace the current `load()` + `onAuthStateChange(() => load())` pattern with a single initial async check.
- Do not call async Supabase queries directly from `onAuthStateChange` in this route. If a subscription is kept at all, it should only update local session state or schedule a non-overlapping check.
- Add a local `authStatus` state such as `idle | checking | authorized | unauthorized` so the component cannot remain in an indefinite loading state after an auth lock error.
- Catch auth-lock/session errors and fail closed to `Studio Coming Soon` for public safety.

### 5. Reduce duplicate entitlement logic in the dashboard

Update `src/hooks/use-msp-access.tsx` to use the same `provider_has_paid_access` RPC as the public route instead of separately querying licenses, purchases, and admin grants client-side. This prevents mismatch between dashboard labels and actual public gating.

While doing that, handle null/non-expiring admin grants correctly through the RPC rather than the current `.gt("expires_at", now)` client query, which cannot match null expirations.

### 6. Preserve strict public gating

The resulting behavior will be:

| URL / context | Unpaid MSP | Paid MSP |
| --- | --- | --- |
| Bare `/p/fbiib` | `Studio Coming Soon` immediately | live Studio |
| Dashboard iframe | isolated visual preview, no auth storage sharing | isolated/live visual preview |
| `Open preview` button | owner/admin-only preview in new tab | not used |
| Shared `?preview=studio` by non-owner | `Studio Coming Soon` | live Studio |
| `/p/fbiib/builder` | unchanged unless separately gated later | unchanged |

### 7. Validation after implementation

After applying the change, I will check:

- `StudioPreviewPanel` no longer includes `allow-same-origin`.
- The iframe `src` uses the new isolated embed preview URL.
- `/p/fbiib` for an unpaid MSP cannot enter the auth loading spinner path and renders the gated state.
- `/p/fbiib?preview=studio` only bypasses for the authenticated owner/admin.
- The public route has no async `onAuthStateChange(() => load())` pattern that can overlap session locks.
- The dashboard still shows the preview panel without re-rendering in a loop.

## Files to change

- `src/components/dashboard/StudioPreviewPanel.tsx`
- `src/routes/p.$slug.index.tsx`
- `src/hooks/use-msp-access.tsx`

No database migration is needed for this fix because the entitlement RPC already returns `false` for the reported unpaid provider.