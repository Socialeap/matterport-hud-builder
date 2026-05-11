## Goal

Give every visitor of the Agent Dashboard a clear visual indication of which account they're signed into — and a fast onboarding path (Google or email) when they're not. The same component will be reusable on the portal builder for consistency.

## Current state

- `/agent-dashboard` lives under `_authenticated`, so unauthenticated users get bounced to `/login` before the page mounts. The header today has plain text buttons (`Work Orders`, `Back to /agents`, `Sign out`) — no avatar, no name, no email shown.
- The portal builder (`/p/$slug/builder`) already has `PortalSignupModal` for inline Google + email signup. There's no logged‑in chip there either.
- We already have: `useAuth()` (user, roles, signOut), `lovable.auth.signInWithOAuth("google")`, `Avatar`, `DropdownMenu`, `PortalSignupModal`.

## Plan

### 1. New component: `src/components/account/AccountMenu.tsx`

A self‑contained header widget with two states:

**Signed‑in state** — circular `Avatar` (uses `agent_profiles.avatar_url` if available, else initials from display name / email) inside a `DropdownMenu`:
- Header row: display name + email (muted)
- `My Profile` → `/agent-dashboard`
- `Work Orders` → `/agent-dashboard/work-orders` (only if user has `client` role or any agent history; otherwise hide)
- `MSP Dashboard` → `/dashboard` (only if `provider` role)
- `Admin` → `/admin` (only if `admin` role)
- Divider
- `Sign out` → `signOut()`

Avatar source priority: `agent_profiles.avatar_url` from `getMyAgentProfile` (already cached under `["agent-profile"]` query key — reuse via `useQuery` with `enabled: isAuthenticated`). Falls back to initials from `display_name` or `user.email`.

**Signed‑out state** — two compact buttons:
- `Sign in` (ghost) → opens an inline auth dialog
- `Sign up` (primary) → opens the same dialog in signup mode

The dialog reuses the existing `PortalSignupModal` pattern but generalized: new file `src/components/account/AuthDialog.tsx` extracted from `PortalSignupModal` (the modal already does Google OAuth + email signup/login and wires `onAuthStateChange`). The new dialog drops the `providerId` / `brandName` / `accentColor` props and uses the app's primary color. After successful auth it just closes — `useAuth` will re-render the menu into its signed‑in state automatically. Existing `PortalSignupModal` keeps working unchanged (we don't refactor portal callers).

### 2. Wire `AccountMenu` into the Agent Dashboard header

In `src/routes/_authenticated.agent-dashboard.tsx`:
- Replace the inline `Sign out` button with `<AccountMenu />` on the right side of the header.
- Keep `Work Orders` and `Back to /agents` as quick‑access buttons (the menu duplicates them, which is fine — discoverability + one‑click).
- No change to the Profile card body.

### 3. Wire `AccountMenu` into the portal builder header

In `src/routes/p.$slug.builder.tsx` (and `p.$slug.index.tsx` if it has a header strip): add `<AccountMenu />` to the top‑right of the page chrome so visitors always see whose account they're acting under. The existing `PortalSignupModal` flow stays as the per‑download gate; `AccountMenu` is purely the persistent identity affordance.

### 4. No backend changes

- No new tables, no migrations, no edge functions.
- No changes to `useAuth`, OAuth wiring, or `agent_profiles` schema.
- No changes to existing routes' auth guards.

## Why this is safe (ripple analysis)

- `AccountMenu` is additive — it only consumes already‑exported hooks/components (`useAuth`, `supabase.auth`, `lovable.auth`, `Avatar`, `DropdownMenu`).
- Reusing the existing `["agent-profile"]` query key piggybacks on the dashboard's existing fetch — no extra network calls when the menu is shown on the dashboard. On other pages, the query just runs once and is cached.
- Extracting `AuthDialog` from `PortalSignupModal` is a copy, not a refactor — the original modal is untouched, so portal flows that depend on `providerId`/`brandName` keep working.
- Sign‑out path delegates to the existing `useAuth().signOut()` which already does the hard redirect, so no new session‑clearing logic.
- Route guards untouched: the avatar on the agent dashboard only ever renders for already‑authenticated users (the route layout still redirects). The signed‑out branch of `AccountMenu` only matters on the portal builder, which is a public route.

## Files

- **Create** `src/components/account/AccountMenu.tsx`
- **Create** `src/components/account/AuthDialog.tsx` (generalized copy of `PortalSignupModal`)
- **Edit** `src/routes/_authenticated.agent-dashboard.tsx` — drop the inline `Sign out` button, render `<AccountMenu />`
- **Edit** `src/routes/p.$slug.builder.tsx` — render `<AccountMenu />` in the top bar
