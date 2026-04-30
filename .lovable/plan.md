## Goal

Stop redirecting unpaid MSPs to `/dashboard/upgrade`. Let them explore and brand their Studio freely, but lock four "Special Components" plus Publish behind a Starter or Pro purchase.

## Locked-when-unpaid (Special Components)

1. Clients (`/dashboard/clients`)
2. Custom Domain (Branding page section)
3. Stripe Payouts (`/dashboard/payouts`)
4. Production Vault (`/dashboard/vault`)
5. Publish  Studio (the "Publish & Distribute" section + Download buttons in `HudBuilderSandbox`)

Everything else (Branding basics, Pricing config UI, Demo, Stats, Account, Overview, Orders, Builder editing) stays fully usable.

## Approach

Introduce a single source of truth for "has the MSP paid?" and reuse it everywhere instead of redirecting.

### 1. New hook: `src/hooks/use-msp-access.tsx`

Returns `{ loading, hasPaid, tier, isClient }`. Internally runs the same `licenses` + `purchases` (sandbox completed) query the dashboard layout already does, cached per session via React state in a tiny context provider (mounted inside `_authenticated.dashboard.tsx`). Avoids duplicate Supabase round-trips across pages.

### 2. `src/routes/_authenticated.dashboard.tsx`

- Remove the `if (!hasAccess && !isUpgradePage) navigate({ to: "/dashboard/upgrade" })` redirect.
- Keep computing `hasPaid` and expose it through the new context provider.
- Show a persistent (dismissible-per-session) top banner when `!hasPaid`: "You're in trial mode. Purchase Starter or Pro to unlock Clients, Custom Domain, Payouts, Vault, and Publishing." with a "Choose a plan" button → `/dashboard/upgrade`.

### 3. `src/components/dashboard/DashboardSidebar.tsx`

Currently only Vault uses `requiresPro`. Extend the same pattern:

- Add a `requiresPaid` flag to `Clients`, `Payouts`, `Vault` nav items.
- When `!hasPaid && !isClient`, render those entries with the existing locked tooltip ("Purchase a plan to unlock") and prevent navigation. Reuse the existing `Lock` icon + tooltip code path.
- Vault's existing Pro-only treatment is preserved (locked for Starter), now extended to also lock for unpaid.

### 4. Route-level guards (defense in depth)

For `/dashboard/clients`, `/dashboard/payouts`, `/dashboard/vault`: at the top of each page component, if `!hasPaid && !isClient`, render a friendly "Locked — purchase to unlock" card with a CTA to `/dashboard/upgrade` instead of the page body. Prevents URL-typing bypass while keeping the page reachable.

### 5. `/dashboard/branding` — Custom Domain section

The Custom Domain card (around line 453) is already visually locked when `!isPro`. Extend the lock condition to `!isPro || !hasPaid` and update the inline message to "Purchase a plan to enable a custom domain." The rest of branding (logo, colors, name, hero, gate label, slug) stays fully editable for unpaid MSPs.

### 6. Builder Publish & Download (`HudBuilderSandbox.tsx`)

- Pass `hasPaid` into `HudBuilderSandbox` (read via the new hook; the builder is already auth-aware via `userId`).
- In the `canDownload` expression at line 1668, add `&& hasPaid`.
- Add `downloadDisabledReason: "Purchase Starter or Pro to publish and download your Studio."` when `!hasPaid`.
- Same gate on the two extra `onClick={handleDownload}` buttons (lines 1817, 1863) — disable + tooltip.
- In `handleDownload` (line 1070), after the `!userId` signup branch, add `if (!hasPaid) { toast.info(...); navigate("/dashboard/upgrade"); return; }` as a server-of-truth fallback.
- Inside `PublishDistributeSection`: add an `unpaidLockMessage?: string` prop; when set, render an overlay/lock card on the Netlify publish controls so the entire publish workflow is visibly gated, not just the download button.

### 7. `/dashboard/upgrade` stays accessible

Remains the destination for every "Purchase to unlock" CTA. No code change needed beyond verifying it still mounts when `!hasPaid` (it does — we removed the forced redirect, not the route).

## Execution-path sanity checks

- **Clients (`assign_client_role_on_link`)**: unaffected — this only fires when an MSP's invitee accepts. Unpaid MSPs cannot reach the invite-sending UI, so no client links can be created.
- **Stripe webhook (`assign_provider_role_on_purchase`)**: still grants `provider` role on purchase; once paid, `hasPaid` flips true on next dashboard load and all locks open automatically.
- **Generated `.html` self-containment**: untouched — we only block triggering generation, not its logic.
- **Existing Pro-vs-Starter restrictions** (Vault Pro-only, Custom Domain Pro-only, whitelabel): preserved and now stack cleanly with the new "must be paid at all" gate.
- **Clients (role=client) experience**: `isClient` short-circuits `hasPaid` to true (their provider owns the license), so no regression for invited end-clients.
- **Admin grants**: `admin_grants` already count as paid via `licenses` (granted licenses are inserted there). If a grant is purely a `branding_settings.tier` set without a license row, we should also treat any non-revoked unexpired `admin_grants` row as paid — I'll include that in the `hasPaid` computation to match current behavior.

## Files to edit / create

- create `src/hooks/use-msp-access.tsx`
- edit `src/routes/_authenticated.dashboard.tsx` (remove redirect, mount provider, add trial banner)
- edit `src/components/dashboard/DashboardSidebar.tsx` (lock Clients / Payouts / Vault when unpaid)
- edit `src/routes/_authenticated.dashboard.clients.tsx` (locked-state render)
- edit `src/routes/_authenticated.dashboard.payouts.tsx` (locked-state render)
- edit `src/routes/_authenticated.dashboard.vault.tsx` (extend isStarter lock to also cover unpaid)
- edit `src/routes/_authenticated.dashboard.branding.tsx` (extend Custom Domain lock)
- edit `src/components/portal/HudBuilderSandbox.tsx` (gate download + publish)
- edit `src/components/portal/PublishDistributeSection.tsx` (new `unpaidLockMessage` prop + overlay)

No DB migrations, no new env vars, no auth/role changes.