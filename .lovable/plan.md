

## Plan: Vault preview polish + Free/Pay invitation attribute

Three coordinated changes: (A) fully expose Vault category content to Starter MSPs as a read‑only preview, (B) drop `.wav` from the Sound Library, (C) add a Free/Pay attribute to invitations + clients that controls whether a client's Presentation download is free.

---

### A. Production Vault — full preview for Starter

**File:** `src/routes/_authenticated.dashboard.vault.tsx`

Today the Tabs component is wrapped in `pointer-events-none` for Starters, so they cannot click through tabs. Fix:

- **Remove** the `pointer-events-none select-none opacity-70` wrapper around `<Tabs>` so Starters can switch between all 6 category tabs and read each Category Guide.
- Keep the existing top "Pro feature" banner and bottom "Unlock — View Pricing" CTA.
- Inside each tab, keep these disabled for Starter:
  - "Add Asset" button (already `disabled={isStarter}`).
  - The asset cards section: render a small dimmed placeholder block "Sample assets appear here for Pro members" instead of the empty/asset list (so they see the structure but cannot create or interact with rows).
  - `AssetEditorDialog` stays gated by `open && !isStarter` (already correct).
- For the `property_doc` tab, the "Manage Templates" link is also blocked: render the row as a non‑link with a `Lock` icon for Starter.

Net result: Starters can browse all 6 tabs, read the Category Guides, but cannot add assets or open the editor / templates page.

### B. Sound Library — remove `.wav`

**File:** `src/routes/_authenticated.dashboard.vault.tsx` (line ~91‑92)

Change the `spatial_audio` entry:
- `format: ".mp3 or Audio URL"`
- `accept: ".mp3,audio/mpeg"`

(Existing `.wav` uploads in the database are unaffected; new uploads simply can't pick `.wav`.)

### C. Free/Pay attribute for invited clients

#### C.1 Database migration

```sql
-- Default behavior on a brand-new invite is "Pay"
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;

-- Mirror the attribute onto the actual client↔provider link so the
-- download fulfilment path can read it after signup.
ALTER TABLE public.client_providers
  ADD COLUMN IF NOT EXISTS is_free boolean NOT NULL DEFAULT false;
```

Update `handle_new_user()` so when a signup consumes an invite token, the matching `is_free` value is copied from the invitation onto the newly created `client_providers` row (single line change inside the existing INSERT).

No new RLS policies needed — existing provider-owns-row policies on both tables already allow the MSP to UPDATE these columns for their rows.

#### C.2 Clients page UI — `src/routes/_authenticated.dashboard.clients.tsx`

**Send Invitation card**
- Add a `Switch` (shadcn) to the right of the email input labeled **"Free"** / **"Pay"** (default OFF = "Pay"). Helper text under it: "Free clients can download their Presentation at no cost."
- `handleInvite` includes `is_free: inviteFree` in the insert payload.

**Invitations table**
- Add a new column **"Attribute"** between Status and Sent.
- Each row renders a small interactive `Switch` (or a click‑to‑toggle Badge: `Free` ↔ `Pay`) bound to `inv.is_free`.
- Toggling calls `supabase.from("invitations").update({ is_free: next }).eq("id", inv.id)` and, if the invite has been accepted, ALSO updates the matching `client_providers` row (`provider_id = me, client_id = inv.accepted_client_id`). Because we don't currently store `accepted_client_id` on the invite row, the simpler approach is to update by email-join: run a follow‑up update against `client_providers` for any client whose `auth.users.email` matches `inv.email` AND `provider_id = me`. This match happens server-side via a new server function `setClientFreeFlag` to avoid leaking emails through RLS.

**New server function (in `src/lib/portal.functions.ts`):**

```ts
setClientFreeFlag = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { invitationId: string; isFree: boolean }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // 1) update invitation row (RLS confirms ownership)
    await supabase.from("invitations")
      .update({ is_free: data.isFree })
      .eq("id", data.invitationId)
      .eq("provider_id", userId);
    // 2) propagate to client_providers link via service role lookup by email
    //    (uses supabaseAdmin to look up auth user by invitation.email,
    //    then updates client_providers where provider_id=userId)
    return { success: true };
  });
```

#### C.3 Enforce Free vs Pay during checkout

The download checkout path is `HudBuilderSandbox.tsx` → `create-connect-checkout` edge function → on payment → `payments-webhook` flips `saved_models.status='paid'`.

- **Edge function `supabase/functions/create-connect-checkout/index.ts`** (server‑side, authoritative):
  - After resolving `user.id` (the client) and `providerId`, look up `client_providers` for `(provider_id, client_id)` and read `is_free`.
  - If `is_free === true`: skip Stripe entirely. Directly `update saved_models set status='paid', is_released=true, amount_cents=0, model_count=:n`. Return `{ free: true, modelId }` instead of `{ clientSecret }`.
  - Otherwise: existing Stripe flow.
- **Client `HudBuilderSandbox.tsx`** (around line 624–638):
  - If response includes `free: true`, do NOT open the Stripe modal. Instead show a success toast ("Your Presentation is ready") and trigger the existing post‑payment "download / generate" flow against `result.modelId`.
  - Update the purchase button label preview: when the loaded branding/clientProvider link indicates the user is a free client, render `Get Presentation — Free` (instead of `Purchase — $X`). To know this on the client, `fetchBrandingBySlug` (or a small new server fn `getClientFreeStatus({ providerId })`) returns the `is_free` flag for the current logged-in user.

> Non-invited clients (anyone whose signup did NOT consume an invite token, or anonymous prospects on the public Studio page) have no `client_providers` row — `is_free` defaults to false / not found, so they always go through Stripe. Requirement satisfied automatically.

---

### Files touched

| File | Change |
|---|---|
| Migration | Add `is_free` to `invitations` + `client_providers`; update `handle_new_user` |
| `src/routes/_authenticated.dashboard.vault.tsx` | Unwrap Tabs from pointer-blocking, dim asset list area only, drop `.wav` from sound library |
| `src/routes/_authenticated.dashboard.clients.tsx` | Free/Pay switch on send form + interactive column in table |
| `src/lib/portal.functions.ts` | New `setClientFreeFlag` + `getClientFreeStatus` server fns |
| `src/components/portal/HudBuilderSandbox.tsx` | Recognize `free: true` checkout response, skip Stripe, swap button label when free |
| `supabase/functions/create-connect-checkout/index.ts` | Branch on `client_providers.is_free` → bypass Stripe & mark paid+released |

### Acceptance check

1. Starter MSP can click each of the 6 Vault tabs, see the Category Guide, and the Add Asset button is disabled with a 🔒 icon.
2. New `.wav` files are no longer accepted on the Sound Library upload picker.
3. Clients page shows a Free/Pay switch in Send Invitation (default Pay) and a new Attribute column with a Switch on every row.
4. Toggling the row Switch immediately persists for both pending and accepted invitations.
5. A client invited as Free, on clicking Purchase in the Builder, sees no Stripe modal — the Presentation is immediately marked paid+released and downloads.
6. A client invited as Pay (or any non‑invited Studio visitor) goes through the normal Stripe checkout.

