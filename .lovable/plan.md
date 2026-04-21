
## Fix the Free-Client Download Entitlement Flow

### What is actually broken

There are two separate conditions being mixed together today:

1. **MSP pricing is configured**
2. **The signed-in client is entitled to a free download**

Those are not the same thing.

The current Studio card uses:
- `pricingConfigured` from MSP branding/pricing
- `checkoutReady` from payout connection state
- `isFreeClient` from `client_providers.is_free`

The backend currently shows:
- the MSP **does have pricing configured**
- the MSP **does not have payouts connected yet**
- the “free client” path only works if `client_providers.is_free = true`

So the “Payment Temporarily Unavailable” message appears whenever the UI believes the client is **not free** and the MSP has no live payout connection. That message is correct for a paid client, but incorrect for a client who should have inherited a free entitlement.

### Root causes to fix

#### 1) Legacy studio signup path bypasses invitation entitlement
`PortalSignupModal.tsx` can create a `client_providers` row directly with:

- `provider_id`
- `client_id`
- default `is_free = false`

That path does **not** use the invitation token and does **not** propagate the MSP’s Free/Pay assignment.

So a client invited as Free can still end up linked as Pay if they authenticate through the old modal instead of the invitation flow.

#### 2) Invitation acceptance does not heal existing links
Both database paths currently do:

```sql
INSERT INTO client_providers (...) VALUES (...) ON CONFLICT DO NOTHING
```

That means if a non-free link already exists, accepting the invitation later does **not** update `is_free` to `true`.

So once a wrong `client_providers` row exists, the system can stay wrong permanently.

#### 3) There are accepted invitations without a matching client-provider link
The data already contains accepted invitations that are not backed by a `client_providers` row. In those cases the Studio cannot resolve free status correctly at all.

#### 4) The Studio trusts a narrow free-status lookup
`HudBuilderSandbox` only asks `getClientFreeStatus(providerId)` and treats “no row found” as “not free”.
That is too brittle when the invitation was accepted but linkage is missing or stale.

### Safe, comprehensive fix

## 1) Make invitation acceptance the single source of truth for client entitlement

Update both database acceptance paths so they **upsert** the client-provider link and **synchronize** `is_free` instead of silently doing nothing.

### Change in database functions
Update:
- `public.handle_new_user()`
- `public.accept_invitation_self(uuid)`

Replace:
```sql
INSERT ... ON CONFLICT DO NOTHING
```

with:
```sql
INSERT INTO public.client_providers (client_id, provider_id, is_free)
VALUES (...)
ON CONFLICT (client_id, provider_id)
DO UPDATE SET is_free = EXCLUDED.is_free;
```

Also keep:
- `user_roles` upsert
- `profiles.provider_id` update
- invitation status update

This ensures:
- new invited clients inherit Free/Pay correctly
- pre-existing links are repaired automatically
- re-accepting or completing auth cannot leave stale entitlement behind

## 2) Add a one-time backend repair migration for already-broken rows

Create a migration that repairs historical data by reconciling accepted invitations into `client_providers`.

### Migration responsibilities
- For every accepted invitation where an auth user exists with the same email:
  - insert missing `client_providers` row
  - update existing `client_providers.is_free` to match the accepted invitation
  - update `profiles.provider_id`
- Prefer accepted invitation data as the authority for invite-based client access

This fixes existing clients who are already stuck in the wrong state.

## 3) Replace the Studio’s free-check with an authoritative “download eligibility” resolver

Create a new server function for the Studio, e.g.:
- `getClientDownloadEntitlement`
or
- `getStudioAccessState`

It should return one authoritative payload for the current signed-in user + provider:

```ts
{
  linked: boolean
  invitationMatched: boolean
  invitationStatus: "pending" | "accepted" | "expired" | "declined" | null
  isFree: boolean
  pricingConfigured: boolean
  payoutsReady: boolean
  providerBrandName: string
}
```

### Server logic
For the authenticated user and provider:
1. read `client_providers`
2. read accepted/pending invitation by matching the user email + provider
3. if invitation is accepted but link is missing or stale, auto-heal it server-side
4. compute effective `isFree`
5. compute pricing/payout readiness from `branding_settings`

This replaces the current fragile split between:
- `getClientFreeStatus`
- client-side pricing checks
- UI guesses

## 4) Rewire the Studio card to branch from entitlement first

Update `HudBuilderSandbox.tsx` so the bottom section uses the new entitlement result.

### Correct branch order
1. `licenseExpired` → block
2. `isReleased` / polling / checkout states → existing fulfillment states
3. `effective isFree === true` → always show **Download Presentation**
4. else if `pricingConfigured && payoutsReady` → show **Pay $X & Download**
5. else if `pricingConfigured && !payoutsReady` → show payment unavailable contact message
6. else → show pricing unavailable message

This guarantees that a Free client never falls into a payment branch simply because payouts are disconnected.

## 5) Remove the legacy “create client link without invitation” behavior from the Studio modal

`PortalSignupModal.tsx` should no longer insert directly into `client_providers` for Studio access.

### Safer behavior
- If the user is not authenticated in the Studio:
  - send them through the invitation-aware auth path when an invite token exists
  - otherwise allow sign-in only, and let the server resolve whether they actually belong to this MSP
- Do not create provider links client-side
- Do not assign entitlement client-side

If a lightweight Studio auth modal remains, it should authenticate only, then let the server determine access and free/pay entitlement.

## 6) Add server-side provider-link validation before save and checkout

To make this flow safe end-to-end, add server validation in:

- `savePresentationRequest`
- `create-connect-checkout`

### Required checks
For the current user and `providerId`:
- confirm the client is actually linked to that MSP, or auto-heal from a valid accepted invitation before proceeding
- ensure the `saved_models` row being checked out belongs to the same `client_id` and `provider_id`

This prevents:
- arbitrary users creating models under any MSP
- checkout being created for a mismatched model/provider pair
- free bypass being applied to the wrong record

## 7) Tighten the UI copy

Update the messages so they reflect the actual business rule:

- **Free client:** no payment language at all
- **Paid client + payouts unavailable:** “If you need help completing payment, please contact {MSP brand name}.”
- Do not imply the client should contact the MSP for general Studio issues unless the issue is payment-related

## Files / areas to update

### Database migration
- Update `handle_new_user`
- Update `accept_invitation_self`
- Add one-time reconciliation SQL for accepted invitations → client links

### Server functions
- `src/lib/portal.functions.ts`
  - add authoritative entitlement resolver
  - validate provider-link access in `savePresentationRequest`
  - optionally retire or replace `getClientFreeStatus`

### Studio UI
- `src/components/portal/HudBuilderSandbox.tsx`
  - replace narrow free lookup with entitlement payload
  - re-order gating so Free wins before payment/payout states

### Studio auth modal
- `src/components/portal/PortalSignupModal.tsx`
  - remove direct `client_providers` insertion
  - route through invitation-aware/authenticated server resolution instead

### Checkout edge function
- `supabase/functions/create-connect-checkout/index.ts`
  - verify `saved_models` ownership/provider match before free bypass or checkout creation
  - keep server-side free bypass as the final authority

## Expected result after the fix

- MSP marks client as **Free**
- client accepts invite and signs in
- backend link is created or repaired with `is_free = true`
- Studio resolves entitlement as Free
- bottom card shows **Download Presentation**
- clicking it saves/releases the model and downloads immediately
- no Stripe flow
- no payment unavailable state
- no dependency on payout connection for free clients

For paid clients, the current payment-unavailable message remains valid when payouts are not connected.

## Verification checklist

1. Invite a brand-new client as **Free**
2. Accept invite via Google
3. Open MSP Studio
4. Confirm bottom card says **Download Presentation**
5. Confirm no payment UI appears
6. Download successfully

7. Invite an existing client who was previously linked as Pay, then flip to **Free**
8. Re-open Studio
9. Confirm the link is auto-repaired and the card changes to **Download Presentation**

10. Test a normal paid client
11. Confirm they still see:
   - pay-and-download when payouts are ready
   - payment-unavailable contact message only when payouts are not ready

12. Confirm model save + checkout cannot be invoked for an unrelated MSP/provider pair
