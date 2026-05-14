## Goal
Raise **Pro Studio** annual upkeep license from **$49 → $79**. Starter Studio stays at $49.

## Scope of changes

### 1. Stripe price (source of truth for billing)
The recurring price `pro_annual` currently bills $49/year (resolved server-side in `create-checkout` via `lookup_keys: ['pro_annual']`). Create a new Stripe price under the same lookup key `pro_annual` at **$79/year recurring**. Stripe automatically transfers the lookup key from the old price to the new one, so no code change is needed in `create-checkout/index.ts` — it will continue to resolve `pro_annual` and now charge $79.

- Tool: `payments--create_price`
  - `id: "pro_annual"`, `product_id: "pro_studio"` (existing), `amount: 7900`, `currency: "usd"`, `recurring_interval: "year"`, `quantity_min: 1`, `quantity_max: 1`
- Starter (`starter_annual` @ $4900/yr) is **not touched**.
- The one-time **$299 setup fee** for Pro (in `SETUP_FEES` map) is **not touched** — it's a separate line item.

### 2. UI copy — Pro tier only
- `src/routes/_authenticated.dashboard.upgrade.tsx` line 41: `annualPrice: "$49"` → `"$79"` (Pro tier object only).
- `src/routes/index.tsx` line 897: Pro card `$49` → `$79`.
- `src/routes/index.tsx` line 831: header subtitle currently reads "then $49/year upkeep license". Change to **"then $49–$79/year upkeep license (first year free)"** so it covers both tiers honestly.

### 3. Comment-only sync (no behavior)
- `supabase/functions/create-checkout/index.ts` line 73 comment "$49/yr upkeep starts Year 2" — update to "$49 Starter / $79 Pro upkeep starts Year 2" for future-reader clarity.

## Explicitly NOT changed
- `pro_annual` lookup key — preserved (Stripe re-points it to the new price).
- Starter pricing ($149 setup, $49/year).
- Pro setup fee ($299).
- `trial_period_days: 365` (first year free).
- Webhook / subscription lifecycle / DB schema — pricing change is transparent to all of these.
- `src/routes/terms.tsx` — generic "annual upkeep license" wording remains accurate.

## Verification checklist
1. Confirm `payments--create_price` succeeds and the new price is the active resolution for `lookup_keys: ['pro_annual']`.
2. Pricing page (`/dashboard/upgrade`) and landing page (`/#pricing`) show **$79/year** on the Pro card and **$49/year** on the Starter card.
3. Open Pro checkout in test mode → Stripe summary shows: $299 setup (one-time) + $79/year subscription with 365-day trial.
4. Open Starter checkout → still shows $149 + $49/year.
5. No TypeScript / build errors; no other references to `$49` in the Pro context remain (`rg "\$49"` audit).

## Risks & mitigations
- **Existing Pro subscribers**: Stripe does not retroactively re-price active subscriptions. Existing subscribers continue at their original $49 rate until manually migrated; only **new** Pro checkouts will be charged $79. This is standard Stripe behavior — flagged for awareness, no code action required unless you want a forced migration.
- **Lookup-key transfer**: Documented Stripe behavior — the new price inherits `pro_annual` and the old price is deactivated for new sessions but remains attached to live subscriptions.
