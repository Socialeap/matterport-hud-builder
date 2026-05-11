## Root cause

shakoure@TranscendenceMedia.com (`a3d9b1d1-…`) has:
- `admin_grants`: active **pro** grant (expires 2026-07-21, not revoked)
- `licenses`: tier=**pro**, status=active
- `branding_settings.tier`: **starter** ← stale

Two dashboard surfaces read tier directly from `branding_settings.tier`, so they show Starter and lock Pro features:
- `src/routes/_authenticated.dashboard.index.tsx` (line 115) — Overview banner / "starter plan" / locked Vault tile
- `src/routes/_authenticated.dashboard.vault.tsx` (lines 262–265) — `isStarter` gate around the entire Production Vault

The grant flow in `_authenticated.admin.$providerId.tsx` does write to all three tables today, but the original grant for this account predates the branding write (or branding was edited afterward and reset to starter), so `branding_settings.tier` drifted out of sync. The same drift can happen any time a provider edits their branding form.

## Fix strategy

Make tier resolution authoritative and idempotent rather than depending on whichever code path last touched `branding_settings`.

### 1. New SECURITY DEFINER RPC: `get_effective_tier(_provider_id uuid) returns app_tier`

Returns the highest currently-entitled tier for a provider, in this order:
1. `admin_grants` row where `revoked_at IS NULL` and (`expires_at IS NULL` OR `expires_at > now()`) → use `tier`
2. `licenses` row where `license_status='active'` and (`license_expiry IS NULL` OR `license_expiry > now()`) → use `tier`
3. Fallback `'starter'`

RLS-safe (SECURITY DEFINER, `SET search_path = public`). Mirrors the pattern already used by `provider_has_paid_access`.

### 2. Wire dashboard reads through the RPC

- `dashboard.index.tsx`: replace the direct `branding_settings.tier` read with `supabase.rpc('get_effective_tier', { _provider_id: user.id })`. Keep the rest of the branding select intact (brand_name, logo, slug, accent, etc.).
- `dashboard.vault.tsx`: replace the dedicated tier query (lines 260–266) with the same RPC.

No other consumers change. The public Studio paywall already uses `provider_has_paid_access`, which is unaffected.

### 3. Repair the stale row for shakoure

One-time `UPDATE branding_settings SET tier='pro' WHERE provider_id='a3d9b1d1-326d-405d-bceb-a980bebd77b6'` so the field also matches, in case any other code path still reads it.

### 4. Harden the grant flow (small, no behavior change for happy path)

In `handleGrant` / `handleRevoke` (admin provider detail page), keep the three writes but stop short-circuiting on `branding_settings` failure — the grant + license writes are the entitlement source of truth now; branding tier is only a denormalized cache. Convert the early `return` after a `branding_settings` error into a non-fatal toast so a single failed cache write can never leave a granted user without entitlement again.

## Files touched

- New migration: `get_effective_tier` function + grant of EXECUTE to `authenticated`
- Data repair via insert tool: update branding row for `a3d9b1d1-…`
- `src/routes/_authenticated.dashboard.index.tsx` — swap tier source
- `src/routes/_authenticated.dashboard.vault.tsx` — swap tier source
- `src/routes/_authenticated.admin.$providerId.tsx` — soften branding error handling in grant/revoke

## Ripple check

- `useLusLicense` already reads from `licenses` and is unaffected.
- `MspAccessProvider` uses `provider_has_paid_access` and is unaffected.
- Public Studio (`p.$slug.*`) reads `branding_settings` for display fields but uses `provider_has_paid_access` for gating; tier-based feature flags there are unchanged.
- Admin provider detail page still shows `detail.tier` from `branding_settings` — after the data repair this will read `pro` correctly, and future grants keep updating it.
- No RLS changes; the new RPC is SECURITY DEFINER and only returns an enum value.

## Verification

1. Run the migration; confirm `select get_effective_tier('a3d9b1d1-…')` returns `pro`.
2. Reload `/dashboard` as shakoure — Overview shows "pro plan", Vault tile unlocked.
3. Open `/dashboard/vault` — gate removed, Property Mapper / categories editable.
4. Revoke the grant in admin → confirm Overview and Vault flip back to Starter.
