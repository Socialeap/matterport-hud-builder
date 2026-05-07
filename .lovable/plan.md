## Goal

When an MSP is signed in as the owner of a Studio and visits their own `/builder`, treat them as a legitimate user who can save, generate, and download a presentation **without paying and without switching accounts**. Today, the resolver flag `viewer_matches_provider=true` triggers a hard "Sign Out" block; we remove that block and add an owner-free-bypass everywhere a paywall fires.

## Trace of the current restriction

The owner is gated in three places, all keyed on `viewer_matches_provider`:

1. **UI block** — `src/components/portal/HudBuilderSandbox.tsx`
   - Line 597: `isWrongAccount = accessVerified && accessState.viewerMatchesProvider`
   - Lines 2070-2093: renders the "This Studio Belongs to Your Account / Sign Out" panel and short-circuits the download CTA.

2. **Save server fn** — `src/lib/portal.functions.ts` `savePresentation` (lines 118-123)
   - Returns `"You are signed in as the Studio owner…"` before inserting into `saved_models`.

3. **Checkout edge function** — `supabase/functions/create-connect-checkout/index.ts`
   - No owner bypass. Even if the UI lets the owner through, this would either route them through Stripe (fee to themselves) or fail pricing/payouts checks.

Downstream `generatePresentation` already works for the owner because it only requires `client_id = auth.uid()` AND `status='paid'` AND `is_released=true` — the owner bypass below sets both, and RLS on `saved_models` allows `client_id = auth.uid()` regardless of whether that user is also the `provider_id`.

## Changes

### 1. `src/components/portal/HudBuilderSandbox.tsx`

- **Remove** the `isWrongAccount` branch (lines 2070-2093) and the `isWrongAccount` derivation (line 597). The owner is no longer treated as a blocked viewer.
- Where the UI currently shows price / "Buy" copy, when `accessState.viewerMatchesProvider === true` show an owner-mode label instead (e.g. "Owner build — free download"). The download button stays enabled and uses the same `handleDownload` path.
- No other state changes needed; `isFreeClient`/`checkoutReady` logic still runs but the owner path will skip Stripe via the changes below.

### 2. `src/lib/portal.functions.ts` — `savePresentation`

- Replace the `if (access?.viewer_matches_provider) { return error }` block (lines 118-123) with: when the viewer matches the provider, **skip the pricing/payouts gate** (treat as `isFree=true` for the rest of the handler) and proceed to insert the `saved_models` row with `client_id = userId` (which equals `provider_id`).
- No schema change. RLS already permits this insert (policy: `client_id = auth.uid()`).

### 3. `supabase/functions/create-connect-checkout/index.ts`

- Add an **owner-free bypass** immediately after the `ownedModel` ownership guard, before the existing free-client / Stripe branches:
  ```
  if (ownedModel.provider_id === user.id) {
    await supabaseAdmin.from("saved_models").update({
      amount_cents: 0,
      model_count: modelCount,
      status: "paid",
      is_released: true,
    }).eq("id", modelId);
    return new Response(JSON.stringify({ free: true, ownerFree: true, modelId }), { … });
  }
  ```
- This mirrors the existing `oneTimeFree` / `isFree` shape so the client's existing `if (checkoutData?.free === true) { runDownload(...) }` branch handles it with no UI change.
- The ownership guard on `ownedModel.client_id !== user.id` still passes because the owner's saved_models row has `client_id = user.id`.

### 4. (No DB or RLS changes required.)

`saved_models.client_id` accepts the provider's own `auth.uid()`. `generatePresentation` filters by `client_id = userId`, which now matches the owner. `provider_has_paid_access` is unaffected (this flow doesn't gate on it).

## Things deliberately NOT changed

- Pricing / payouts / Stripe Connect onboarding gates remain enforced for true clients.
- The "wrong account" copy is removed entirely, not just hidden — there is no scenario where blocking the owner of a Studio from using their own builder is correct.
- License-expired and access-armed/password guards still apply to the owner (same rules as a client).
- `order_notifications` row still gets created on save; the owner will see their own notification, which is acceptable (and a useful audit trail).

## Risk / regression check

- Public `/p/$slug` viewing for non-owners: untouched.
- Real client checkout: untouched (owner bypass only fires when `provider_id === user.id`).
- Admin viewing another provider: `viewer_matches_provider` is false for admins viewing a different MSP, so they continue to flow through the normal client path.
- Free invitee flow: the new bypass is checked alongside (not replacing) the existing `oneTimeFree` and `isFree` branches.
