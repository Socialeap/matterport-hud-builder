## What's wrong today

For an unpaid MSP, the public Studio route currently has THREE doorways. Only one of them is actually gated:

| URL | Current behavior | Should be |
| --- | --- | --- |
| `/p/fbiib` (bare) | "Studio Coming Soon" | Same — correct |
| `/p/fbiib?embed=studio-preview` | Renders full Studio with no auth check at all | Only allowed inside the dashboard iframe |
| `/p/fbiib?preview=studio` | Renders Studio if visitor is owner/admin, else "Coming Soon" | Same — correct in principle, but currently shipped as a public-shareable link |

The user's complaint: pasting `?preview=studio` shows the page publicly. Looking at the code, it actually does run an owner/admin check — but during the "checking" phase it renders, and more importantly the `?embed=studio-preview` URL is 100% public if anyone discovers it. That's a real leak in addition to the dashboard preview being correct.

Separately, the user is also saying the dashboard preview itself must keep working for the unpaid MSP. That part is already working today via the iframe embed; we must not break it.

## Goal

- Unpaid MSP, viewing their own Branding tab: dashboard preview iframe renders the Studio normally (with a "Preview mode" banner). No regression.
- Unpaid MSP, opening a new tab to preview their Studio: works for them, not for the public.
- Anyone else (no session, wrong user, random visitor) hitting any variant of `/p/fbiib`: gets "Studio Coming Soon".
- Paid MSP: Studio is fully public. No change.

## Fix

### 1. Lock the embed URL to dashboard iframe context only

In `src/routes/p.$slug.index.tsx`, stop treating `?embed=studio-preview` as an automatic bypass. Two layered checks:

- **Frame check (browser-side)**: only honor `isEmbedPreview` when `window.self !== window.top` AND `window.top.location.origin === window.location.origin`. A public visitor pasting the URL fails this (it's a top-level window) → falls through to "Coming Soon". The dashboard iframe passes (same-origin parent).
- This is paired with the existing `sandbox="allow-scripts allow-popups allow-forms"` on the iframe. Because we removed `allow-same-origin` from the sandbox previously, the parent-origin check inside the iframe will throw on `window.top.location` access — so we instead use `window.self !== window.top` as the primary signal and treat any access error on `window.top.location` as "this IS sandboxed-from-parent, allow it". Net effect: only iframed contexts pass; top-level public requests fail.

Result: `?embed=studio-preview` pasted into a browser address bar = "Coming Soon".

### 2. Tighten `?preview=studio` (top-level owner/admin preview)

Keep the current owner/admin auth check for `?preview=studio`, but:

- Render "Studio Coming Soon" (not a spinner) while `authStatus === "checking"`. The spinner page is what the user perceived as "viewable publicly" during the brief auth check window — it doesn't expose Studio content, but it is misleading. Fail-closed UX.
- Keep failing closed on auth errors / no session.

This matches what an unauthenticated visitor or wrong-user session sees: never the Studio, only the gate.

### 3. Dashboard iframe preview keeps working

`src/components/dashboard/StudioPreviewPanel.tsx` already loads `?embed=studio-preview` inside an iframe with the proper sandbox. No change needed beyond confirming the iframe context check in step 1 succeeds for it.

The "Open preview" button (top-level new tab) continues to use `?preview=studio` and the owner/admin check authorizes the MSP themselves.

### 4. No changes to

- `src/hooks/use-msp-access.tsx` — already uses `provider_has_paid_access` RPC.
- Database / RLS — `provider_has_paid_access` already returns `false` for the reported slug.
- Paid-tier behavior — `providerActive=true` short-circuits all gating.

## Resulting access matrix (unpaid MSP)

| Context | URL | Result |
| --- | --- | --- |
| Public visitor | `/p/fbiib` | Coming Soon |
| Public visitor | `/p/fbiib?preview=studio` | Coming Soon |
| Public visitor | `/p/fbiib?embed=studio-preview` | Coming Soon (new — closes the leak) |
| MSP owner, dashboard Branding tab iframe | `/p/fbiib?embed=studio-preview` | Studio renders (preview banner) |
| MSP owner, "Open preview" new tab | `/p/fbiib?preview=studio` | Studio renders (preview banner) |
| Wrong signed-in user | any URL | Coming Soon |

## Files to change

- `src/routes/p.$slug.index.tsx` — add iframe-context check for embed mode; render Coming Soon during preview auth check phase.

That's the entire surface area. Three small, surgical changes inside the existing gating block — no new routes, no migrations, no auth refactor, no risk to the iframe preview UX the MSP already relies on.