
## Root cause and safe fix for the incorrect “Pricing Unavailable” state

### What is actually broken

There are two bugs overlapping here:

1. **The Studio absolutely does know who is signed in**
   - It uses the browser’s persisted auth session and sends that JWT to server functions.
   - No auth token in the URL is required.
   - So the problem is not “missing URL identity”; it is **how the current signed-in user is being resolved and handled**.

2. **The authoritative access resolver is still invalid**
   - `public.resolve_studio_access` is currently declared **`STABLE`**.
   - But its body performs an `INSERT ... ON CONFLICT DO UPDATE` to auto-heal `client_providers`.
   - PostgreSQL does not allow writes inside a `STABLE` function.
   - When that RPC fails, `HudBuilderSandbox` catches the error and marks access as `loaded: true` while leaving:
     - `isFree = false`
     - `pricingConfigured = false`
     - `payoutsReady = false`
   - That forces the UI into the misleading **“Pricing Unavailable”** branch.

### Why this explains the current symptom

The MSP pricing is in fact configured:
- `use_flat_pricing = false`
- `base_price_cents = 7900`
- `tier3_price_cents = 15000`
- `additional_model_fee_cents = 5900`

So the page should never say pricing is unavailable just because pricing is missing.

Instead, what is happening is:
- the access-state request fails
- the component falls back to “all false”
- the UI renders the wrong final fallback message

### Additional identity issue to fix

The current preview session is also showing a logged-in user with **provider/admin roles**, not a client role.

That means the builder may be running under the wrong account entirely. Today the builder has no clear role-aware handling for:
- provider viewing their own public Studio
- admin viewing a provider Studio
- actual invited client viewing the builder

So even after fixing the resolver, the Studio still needs a **role-aware identity guard**. Otherwise the provider account can land in a client payment/download flow and produce confusing states.

---

## Implementation plan

### 1) Repair the backend access resolver

Create a migration that drops and recreates `public.resolve_studio_access` as a write-capable function.

#### Required changes
- Change from `STABLE SECURITY DEFINER` to **`VOLATILE SECURITY DEFINER`**
- Keep the current auto-heal behavior:
  - look up authenticated user
  - look up existing `client_providers` link
  - look up invitation by provider + email
  - if accepted invitation exists, upsert `client_providers.is_free`
  - compute `linked`, `is_free`, `pricing_configured`, `payouts_ready`, `provider_brand_name`

#### Add one more field to the resolver
Return enough identity context for the UI to branch correctly:
```ts
viewer_role: "client" | "provider" | "admin" | "unknown"
viewer_matches_provider: boolean
```

This avoids guessing on the client.

### 2) Stop converting RPC failure into fake “pricing unavailable”

Update `src/lib/portal.functions.ts` and `src/components/portal/HudBuilderSandbox.tsx`.

#### In `getStudioAccessState`
- If the RPC errors, do **not** silently convert that to a normal-looking payload.
- Return or throw a typed failure so the UI can distinguish:
  - access verified
  - access failed to verify

#### In `HudBuilderSandbox`
Replace the current “loaded but false everything” catch path with explicit state:
```ts
{
  loaded: false,
  error: string | null,
  ...
}
```

#### Correct fallback behavior
- If access verification fails, do **not** set `pricingConfigured` to false
- Keep pricing derived from branding for display-only fallback
- Show a dedicated message such as:
  - “We couldn’t verify your Studio access right now.”
  - “Retry”
- Do not show “Pricing Unavailable” unless pricing is truly not configured

### 3) Separate three concerns in the Studio UI

Right now these are mixed together:

1. Who is signed in
2. Whether that user is entitled to this Studio
3. Whether payment is required

They should be rendered independently.

#### New UI state order
1. **Auth not yet resolved** → loading
2. **No signed-in user** → sign-in prompt
3. **Signed in as provider/admin** → role mismatch message
4. **Signed in client but access verification failed** → retry/error state
5. **Signed in client, linked, `isFree = true`** → **Download Presentation**
6. **Signed in client, linked, paid, payouts ready** → **Pay $X & Download**
7. **Signed in client, linked, paid, payouts unavailable** → payment contact message
8. **Signed in client, not linked** → invitation-required message

This prevents every failure from collapsing into a fake pricing message.

### 4) Add a role-aware guard for wrong-account sessions

The builder should not quietly behave like a client flow when the current user is actually the provider/admin.

#### Add a clear builder guard
If:
- `viewer_role` is `provider` or `admin`, or
- `viewer_matches_provider = true`

then show:
- “You’re signed in as the provider account, not the invited client.”
- CTA to sign out / switch account
- no pricing or checkout UI

This is important because the current session evidence shows a provider/admin account, which would never correctly resolve as a free invited client.

### 5) Make the messaging accurate

Update the bottom section copy so it reflects the real state:

#### Free client
- “Download Presentation”
- “Included with your account — no payment required.”

#### Paid client, payout unavailable
- “Payment Temporarily Unavailable”
- “If you need help completing payment, please contact {MSP brand}.”

#### Access verification error
- “We couldn’t verify your Studio access right now.”
- Retry button
- no payment-specific language

#### Wrong account
- “You’re signed in as the MSP account, not the invited client.”
- “Please switch to the invited client account to continue.”

### 6) Keep the free-download path authoritative on the server

The final download/payment branch must still be enforced server-side:
- `savePresentationRequest`
- checkout creation
- free bypass

Those should continue to rely on the repaired resolver so the client cannot spoof free status.

---

## Files to update

### Database
- `supabase/migrations/<new_migration>.sql`
  - recreate `public.resolve_studio_access` as `VOLATILE SECURITY DEFINER`
  - add `viewer_role`
  - add `viewer_matches_provider`

### Server functions
- `src/lib/portal.functions.ts`
  - update `StudioAccessState` type
  - update `getStudioAccessState`
  - preserve real errors instead of flattening them into false flags

### Studio UI
- `src/components/portal/HudBuilderSandbox.tsx`
  - separate `accessError` from valid access data
  - stop treating resolver failure as “pricing unavailable”
  - add wrong-account / provider-account guard
  - re-order bottom-card gating
  - keep branding-based pricing display independent from access verification failure

---

## Expected result after the fix

### Correct free-client flow
Invited client → signed in as the invited client account → resolver heals/accesses link → `isFree = true` → builder shows:

- **Download Presentation**
- no Stripe
- no pricing warning
- no payment contact message

### Correct provider/admin flow
Provider/admin signed into the public Studio → builder shows:

- wrong-account notice
- switch-account guidance
- no client payment/download UI

### Correct paid-client flow
Paid client + payouts ready → **Pay $X & Download**

Paid client + payouts unavailable → **Payment Temporarily Unavailable**

### Correct failure behavior
If access resolution fails again for any backend reason:
- user sees a retryable access-verification message
- not the false “Pricing Unavailable” fallback

---

## Verification checklist

1. Sign in as an invited **free client**
2. Open `/p/{slug}/builder`
3. Confirm the bottom section shows **Download Presentation**
4. Confirm no payment messaging appears

5. Sign in as the **provider/admin**
6. Open the same builder
7. Confirm the page shows a **wrong-account** message instead of pricing/payment UI

8. Sign in as a normal **paid client**
9. Confirm price breakdown appears
10. Confirm checkout only appears when payouts are ready

11. Force the resolver to fail
12. Confirm the UI shows an **access verification error**, not “Pricing Unavailable”
