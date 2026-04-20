

## Plan: Complete the Dashboard Sidebar (Vault, Payouts, Pricing, Account)

Restructure the dashboard left-nav so every MSP-facing area is reachable, repurpose the **Pricing** page to control client/end-user pricing (not MSP tier purchase), and add a new **Account** page.

---

### 1. Sidebar changes — `src/components/dashboard/DashboardSidebar.tsx`

New nav order for providers:

| # | Label | Route | Icon | Behavior |
|---|---|---|---|---|
| 1 | Overview | `/dashboard` | LayoutDashboard | always |
| 2 | Branding | `/dashboard/branding` | Palette | always |
| 3 | Production Vault | `/dashboard/vault` | Archive | **always shown**; disabled + 🔒 icon + "Pro only" tooltip when `tier === 'starter'` |
| 4 | Pricing | `/dashboard/pricing` | DollarSign | always (NEW purpose — see §3) |
| 5 | Orders | `/dashboard/orders` | ShoppingCart | always |
| 6 | Payouts | `/dashboard/payouts` | Banknote | **always shown** (remove `requiresStripe` gate); page itself already handles "not connected yet" state |
| 7 | Clients | `/dashboard/clients` | Users | always |
| 8 | Demo | `/dashboard/demo` | Play | always |
| 9 | Account | `/dashboard/account` | UserCog | always (NEW) |

Disabled-row pattern for Starter Vault: render as a non-link `<SidebarMenuButton>` with `opacity-60 cursor-not-allowed`, a small `Lock` icon, and a tooltip "Upgrade to Pro to unlock the Production Vault".

### 2. Move tier-purchase gate off `/dashboard/pricing` — `src/routes/_authenticated.dashboard.tsx`

`/dashboard/pricing` is being repurposed for client pricing, so it can no longer double as the upgrade landing page.

- Rename the existing tier-purchase page from `_authenticated.dashboard.pricing.tsx` → `_authenticated.dashboard.upgrade.tsx` (route `/dashboard/upgrade`).
- Update the gate redirect in `_authenticated.dashboard.tsx` to `/dashboard/upgrade`.
- Update the banner text and any internal links currently pointing to `/dashboard/pricing` for the purchase flow (e.g. checkout `returnUrl`s) to use `/dashboard/upgrade`.
- The Sidebar does NOT show "Upgrade" — users are routed there only via the gate.

### 3. New Pricing page — `src/routes/_authenticated.dashboard.pricing.tsx` (rewrite)

Purpose: MSP sets the per-presentation price their **clients** pay based on the number of 3D property models in a Presentation Portal.

Three tiered fields:

```
$A — Price for 1–2 property models                (flat fee)
$B — Price for 3 property models (discounted)     (flat fee, replaces 3 × $A)
$C — Price per each additional model beyond 3     (per-model fee)
```

Implementation:
- Reuse existing `branding_settings` columns:
  - `base_price_cents` → **$A** (1–2 models)
  - `additional_model_fee_cents` → **$C** (per additional model)
- Add ONE new column (migration): `tier3_price_cents int4 NULL` → **$B** (flat price for exactly 3 models).
- Set `model_threshold` to a fixed `2` server-side on save (treated as a system constant in the new model: 1–2 = base, 3 = discounted bundle, 4+ = base-3 + extra-per-model).
- UI: three labeled `Input type="number"` (USD) cards with helper text + a live "Example pricing" preview that shows the calculated cost for 1, 2, 3, 4, 5 models.
- Save handler `upsert` to `branding_settings` for the current `provider_id`.
- Show inline warning if Stripe Connect is not yet onboarded ("Set prices now; clients can't check out until you connect Payouts").

### 4. Update price calculator — `src/components/portal/HudBuilderSandbox.tsx`

Replace the current `modelCount <= threshold ? base : base + (modelCount - threshold) * additional` formula with:

```ts
let totalCents = 0;
if (modelCount <= 2) totalCents = priceA;                          // $A
else if (modelCount === 3) totalCents = priceB ?? priceA * 2 + priceC; // $B
else totalCents = (priceB ?? priceA * 2 + priceC) + (modelCount - 3) * priceC; // $B + extras
```

Falls back gracefully if `tier3_price_cents` is null (treats it as `2A + C`).

### 5. Remove pricing fields from Branding page — `src/routes/_authenticated.dashboard.branding.tsx`

Strip the "Base Price", "Model Threshold", and "Additional Model Fee" inputs (lines ~510–565) and replace with a small CTA card: "Pricing has moved → Set client pricing in the Pricing tab" linking to `/dashboard/pricing`. Keeps the save handler intact (those fields just won't be edited here anymore).

### 6. New Account page — `src/routes/_authenticated.dashboard.account.tsx`

Single page with three sections:

**a. Reset Password**
- Inline form: current password, new password, confirm new password.
- Uses `supabase.auth.updateUser({ password })` with a re-auth via `signInWithPassword` first if a current password is provided (or just `updateUser` and rely on session).
- Success toast + clear inputs.

**b. Privacy & Terms**
- Two read-only links: "View Privacy Policy" → `/privacy`, "View Terms of Service" → `/terms` (both routes already exist).
- Open in a new tab.

**c. Delete Account** (danger zone, red border card)
- Button "Delete my account…" opens an `AlertDialog` requiring the user to type their email to confirm.
- Calls a new server function `deleteOwnAccount` (via `createServerFn` + `requireSupabaseAuth`) that:
  1. Uses `supabaseAdmin.auth.admin.deleteUser(userId)` (cascades to dependent rows where FKs are set; cleanup of `branding_settings`, `licenses`, `purchases`, `client_providers` for that user happens via existing `on delete cascade` where present).
  2. Returns success.
- On success, sign out client-side and redirect to `/`.

### 7. Database migration

```sql
ALTER TABLE public.branding_settings
  ADD COLUMN IF NOT EXISTS tier3_price_cents integer;
```

No RLS changes needed (existing policies already cover the row).

---

### Files touched

| File | Change |
|---|---|
| `src/components/dashboard/DashboardSidebar.tsx` | Reorder, always-show Vault (disabled when Starter) + Payouts, add Account, remove Pricing-as-upgrade |
| `src/routes/_authenticated.dashboard.tsx` | Gate redirects to `/dashboard/upgrade` |
| `src/routes/_authenticated.dashboard.upgrade.tsx` | NEW — moved from old pricing.tsx (MSP tier purchase) |
| `src/routes/_authenticated.dashboard.pricing.tsx` | REWRITE — client/end-user pricing form (A/B/C) |
| `src/routes/_authenticated.dashboard.branding.tsx` | Remove pricing inputs, add link to Pricing tab |
| `src/routes/_authenticated.dashboard.account.tsx` | NEW — reset password, privacy/terms links, delete account |
| `src/components/portal/HudBuilderSandbox.tsx` | New 3-tier price calc using `tier3_price_cents` |
| `src/lib/portal.functions.ts` (or new file) | NEW server fn `deleteOwnAccount` |
| Migration | Add `tier3_price_cents` column |

### Acceptance check

1. Sidebar shows: Overview, Branding, Production Vault, Pricing, Orders, Payouts, Clients, Demo, Account.
2. Starter MSP sees Vault as a locked/dimmed row with a tooltip; clicking it does nothing.
3. Pro MSP sees Vault as a normal active link.
4. Payouts is always visible; clicking it as a not-yet-connected MSP shows the existing "Connect Stripe" CTA.
5. Pricing page lets MSP enter $A, $B, $C with live example, persists to `branding_settings`.
6. Branding page no longer shows pricing inputs.
7. Builder/Sandbox computes price using the new 1-2 / 3 / 4+ formula.
8. `/dashboard/upgrade` is the new tier-purchase page; gate redirects there for MSPs without a license/purchase.
9. Account page can change password, links to /privacy and /terms, and can delete the account with confirmation (signs out + redirects to /).

