## Problem

On `/p/{slug}/builder`, signing in with any account that has the `provider` or `admin` role triggers a hard "Wrong Account Signed In" block, even when that user is visiting a *different* MSP's Studio. This prevents legitimate cross-MSP purchases — exactly the lead-capture flow you want to keep open.

## Root Cause

`src/components/portal/HudBuilderSandbox.tsx` line ~594:

```ts
const isWrongAccount =
  accessVerified &&
  (accessState.viewerRole === "provider" ||
   accessState.viewerRole === "admin"   ||
   accessState.viewerMatchesProvider);
```

The first two clauses block **every** provider/admin account from buying from **any** Studio. Only the third clause (`viewerMatchesProvider`) is the legitimate "owner trying to buy their own Studio" guard.

The DB resolver (`resolve_studio_access`) already returns `viewer_matches_provider = true` only when `auth.uid() === _provider_id`, so it's safe to rely on it as the sole signal.

## Fix

**File:** `src/components/portal/HudBuilderSandbox.tsx`

1. **Line ~594** — change `isWrongAccount` to only fire when the signed-in user is literally the owner of this Studio:

```ts
const isWrongAccount = accessVerified && accessState.viewerMatchesProvider;
```

2. **Lines ~917–925 (approved-free-download effect)** — narrow the early-return so we still skip for the owner but allow other providers/admins (they'll just get an empty result and fall through to normal pricing):

```ts
if (accessState.viewerMatchesProvider) return;
```
(remove the `viewerRole === "provider" / "admin"` clauses; update the dep list accordingly.)

3. **Update the warning copy** at lines ~2076–2083 to match the narrower meaning ("This Studio is yours — switch to a buyer account to test the purchase flow.") so an MSP who *does* land on their own Studio still sees a sensible message.

## Ripple Check

- `EnhancementsSection` reads `viewerRole` independently (only swaps the BYOK Ask-AI section for clients) — **unaffected**.
- `getApprovedFreeDownloadFn` lookup for non-owner providers will return no approved record, so the normal checkout path runs — **safe**.
- `resolve_studio_access` RPC is unchanged.
- The owner-self-purchase guard is preserved via `viewerMatchesProvider`.
- Anonymous (unauthenticated) visitors are unaffected — `viewerRole` is `"unknown"` and `viewerMatchesProvider` is false.

No DB migration, no edge function, no auth/RLS changes required.
