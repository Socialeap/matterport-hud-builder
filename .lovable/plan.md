

## Plan: Instant Payouts via Stripe Embedded Components + 1.5% Application Fee

Three deliverables: an account-session endpoint, a Payouts dashboard page hosting Stripe's `payouts` embedded component, and a balance summary on the Branding page. Application fee is set on the platform Pricing Tool side (Stripe Dashboard) and configurable per-MSP via a new column.

---

### 1. Database (1 migration)

Add per-MSP fee override on `branding_settings`:

```sql
ALTER TABLE public.branding_settings
  ADD COLUMN instant_payout_fee_bps integer NOT NULL DEFAULT 150;
-- 150 basis points = 1.5%. Must be 0-1000 (0%–10%).
ALTER TABLE public.branding_settings
  ADD CONSTRAINT instant_payout_fee_bps_range CHECK (instant_payout_fee_bps BETWEEN 0 AND 1000);
```

This value is passed to Stripe's Platform Pricing Tool config later. For phase 1 we'll store it; the actual application fee is set platform-wide in Stripe Dashboard → Connect → Platform Pricing → Instant Payouts. We surface and store it so MSPs see what they're being charged.

**Note**: Stripe's embedded `payouts` component reads pricing from the platform-level Pricing Tool, not per-call. Per-MSP variable pricing requires the API-driven path. For MVP we display the platform default (1.5%) and MSPs cannot override it — column exists for future per-MSP tuning.

---

### 2. New edge function: `stripe-connect-account-session`

Creates an [AccountSession](https://docs.stripe.com/api/account_sessions/create) for embedded components with `payouts`, `balances`, and `instant_payouts_promotion` features enabled.

```ts
// supabase/functions/stripe-connect-account-session/index.ts
// - Auth: required (uses caller's branding_settings.stripe_connect_id)
// - Body: { environment: 'sandbox' | 'live' }
// - Returns: { client_secret: string }
//
// stripe.accountSessions.create({
//   account: branding.stripe_connect_id,
//   components: {
//     payouts: { enabled: true, features: { instant_payouts: true, standard_payouts: true, edit_payout_schedule: true } },
//     balances: { enabled: true, features: { instant_payouts: true } },
//     payouts_list: { enabled: true },
//   },
// })
```

Add to `supabase/config.toml`:
```toml
[functions.stripe-connect-account-session]
verify_jwt = false
```

(Function does its own auth via Authorization header, matching the pattern used by the other connect functions.)

---

### 3. New dashboard route: `/dashboard/payouts`

File: `src/routes/_authenticated.dashboard.payouts.tsx`

- Loads `branding_settings` for the current user; if `stripe_onboarding_complete = false`, shows an empty state with a CTA back to `/dashboard/branding` to finish Stripe Connect.
- Calls `stripe-connect-account-session` to get `client_secret`.
- Initializes `loadConnectAndInitialize` from `@stripe/connect-js` with our publishable key + the client_secret + brand color from `branding.accent_color`.
- Renders `<ConnectComponentsProvider>` wrapping:
  - `<ConnectBalances />` — shows available + instant_available
  - `<ConnectPayouts />` — full payouts UI with Instant Payout button
- Loading + error fallbacks; toast on initialization failure.

---

### 4. Branding page summary

Below the existing "Stripe Connected ✅" badge (around line 393 in `_authenticated.dashboard.branding.tsx`), when `stripe_onboarding_complete = true`, render a compact card with:
- The same `<ConnectBalances />` embedded component, scoped down (no payouts list).
- A `<Link to="/dashboard/payouts">` button: "Manage payouts →"
- A read-only line: "Instant Payout fee: 1.5% (set by platform)"

Reuses the same account-session call (single fetch, cached in component state).

---

### 5. Sidebar entry

Add to `src/components/dashboard/DashboardSidebar.tsx`:
- New nav item "Payouts" (icon: `Banknote` from lucide), pointing to `/dashboard/payouts`.
- Visible only when `tier` is `pro` AND `stripe_onboarding_complete` is true (gated, since Starter tier doesn't accept payments). Hidden otherwise.

---

### 6. Dependency

Install `@stripe/connect-js` (Stripe's loader for embedded Connect components — separate from `@stripe/stripe-js`).

---

### 7. Stripe Dashboard configuration (manual, one-time)

After deploy, you'll need to:
1. Stripe Dashboard → Settings → Connect → **Platform Pricing Tool → Instant Payouts** → set 1.5% application fee on USD payouts (matches `instant_payout_fee_bps = 150`).
2. Confirm "Allow debit cards" is enabled under Connect → External Accounts so MSPs without eligible bank accounts can still receive instant payouts via debit card.

I'll surface these as a one-time setup checklist after the build completes.

---

### Files touched

| File | Change |
|---|---|
| `supabase/migrations/<ts>_instant_payout_fee.sql` | New — adds `instant_payout_fee_bps` column |
| `supabase/functions/stripe-connect-account-session/index.ts` | New — account session endpoint |
| `supabase/config.toml` | Append `[functions.stripe-connect-account-session]` |
| `src/routes/_authenticated.dashboard.payouts.tsx` | New — full Payouts page |
| `src/routes/_authenticated.dashboard.branding.tsx` | Add balance summary + "Manage payouts" link |
| `src/components/dashboard/DashboardSidebar.tsx` | Add "Payouts" nav item (gated) |
| `package.json` | Add `@stripe/connect-js` |

### Ripple safety

- No change to existing checkout, lead capture, or webhook flows.
- Account session is per-request and short-lived; no caching, no DB write.
- Embedded components run client-side in an iframe — they do NOT receive your platform secret key, only the short-lived `client_secret`.
- Pro-tier gating prevents Starter MSPs from seeing payouts they can't use.

### Out of scope (call out as follow-ups)

- Per-MSP variable pricing (requires custom UI + API path, not embedded component).
- Webhook handling for `payout.paid` / `payout.failed` events to send MSP notification emails.
- Reporting/exports of historical payouts (the embedded `payouts` component already shows history; CSV export is a future enhancement).
- Eligibility-tools dashboard configuration (private preview from Stripe).

### Verification after deploy

1. As a Pro MSP with a connected Stripe account, click "Payouts" in the sidebar.
2. Page loads with balance card and payouts component.
3. If there's an instant-eligible balance (use Stripe sandbox to simulate a charge → wait for funds), the "Instant Payout" button appears.
4. Initiating an instant payout shows a confirmation modal, processes, and appears in the payouts history.
5. On `/dashboard/branding`, the balance summary mirrors what's shown on the Payouts page.

