## Problem 1: Pro features locked for active Pro accounts

**Root cause (verified against the database):**

For `transcendencemedia` we have two competing tier sources:

| Source | Value |
|---|---|
| `licenses.tier` (admin grant / source of truth) | `pro` (active, no expiry) |
| `branding_settings.tier` | `starter` |
| `purchases` rows | `starter_tier` only |

`DashboardSidebar.tsx` reads tier exclusively from `branding_settings.tier`:

```ts
supabase.from("branding_settings").select("tier")...
setTier((data?.tier as "starter" | "pro") ?? "starter");
```

So when an admin grants Pro via `licenses` (or `admin_grants`), `branding_settings.tier` is never updated — the sidebar's `isPro` stays false and the **Marketplace** nav stays locked. The same flag also drives any other `requiresPro` UI.

Meanwhile `useMspAccess` correctly calls `provider_has_paid_access` RPC (which inspects `licenses` + `purchases` + `admin_grants`), so `hasPaid` is true. The two halves disagree.

**Fix:** make sidebar tier detection consistent with the rest of the app.

- Replace the `branding_settings.tier` query in `DashboardSidebar` with a call to `get_license_info` (already used by `useLusLicense`). Treat `tier === 'pro'` AND `license_status === 'active'` AND not expired as Pro.
- Fall back to `branding_settings.tier` only if no license row exists (preserves behavior for brand-new MSPs).
- No DB migration required. (Optionally, we could backfill `branding_settings.tier` from `licenses` via a trigger later, but the read-side fix is sufficient and safer.)

## Problem 2: Marketplace tab shows a hard lock for unpaid MSPs

Currently `_authenticated.dashboard.marketplace.tsx` short-circuits to a "Pro feature" card when `!hasPaid`. The user wants a teaser/preview view instead.

**Fix:**

- Always render the full marketplace layout (header, filters, sample contact cards).
- When `!hasPaid` (or RPC returns `pro_required`):
  - Render 2–3 skeleton/sample `BeaconCard`s populated with blurred/placeholder data ("Jane D.", "•••@•••", masked city) wrapped in a container with `pointer-events-none opacity-60 select-none blur-[2px]` and `aria-hidden`.
  - Overlay a centered "Upgrade to Pro to unlock real contacts" call-to-action card with a `View Plans` button linking to `/dashboard/upgrade`.
  - Disable the "Configure Listing" button (or keep enabled — branding page is fine to visit; we'll keep enabled).
- Also remove the sidebar's `requiresPro` lock for `/dashboard/marketplace` so unpaid MSPs can navigate to the preview. The page itself handles the gating UI.
- Server-side RPC `get_my_matched_beacons` continues to enforce the Pro requirement, so no real contact data leaks.

## Files to change

- `src/components/dashboard/DashboardSidebar.tsx` — switch tier source to `get_license_info`; remove `requiresPro` from the Marketplace nav item (keep the lock for any other Pro-only items if applicable; currently Marketplace is the only one).
- `src/routes/_authenticated.dashboard.marketplace.tsx` — replace the lock-card early return with the always-rendered layout + blurred sample cards + upgrade overlay when unpaid.

No DB migrations, no schema changes.
