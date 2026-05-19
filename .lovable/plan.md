
## Problem

The coupon `AWw4lrRx` is product-restricted in Stripe to specific Product IDs. Current `create-checkout` resolves prices via `lookup_keys: ["starter_annual" | "pro_annual"]` and trusts whatever product Stripe returns. If the lookup-key resolution ever returns a price attached to a different product (e.g. a duplicate created during an earlier sync, or a price whose lookup_key was reassigned), the setup fee line item — even after the last fix — inherits that "wrong" product and the coupon rejects the order.

The user wants the checkout to bind to **exact** Stripe IDs so there is zero ambiguity.

| Internal key      | Stripe Product ID         | Stripe Price ID                   |
| ----------------- | ------------------------- | --------------------------------- |
| `starter_annual`  | `prod_ULJU4Nl5h77Jte`     | `price_1TMcs0CQXdxBxU8GqT6j5mUb`  |
| `pro_annual`      | `prod_ULJUtLfqo0icwT`     | `price_1TMcrzCQXdxBxU8GuhuqJidW`  |

## Approach

Single-file change in `supabase/functions/create-checkout/index.ts`. Replace the `prices.list({ lookup_keys })` flow with an explicit lookup table, then `stripe.prices.retrieve(<price_id>)` to fetch currency / type. Both the subscription line item AND the setup-fee line item will reference these IDs verbatim.

### Why this approach (vs alternatives)

1. **Hardcoded map + `prices.retrieve` (chosen)** — Deterministic. Setup-fee line item uses `product: PRO_PRODUCT_ID` (literal), guaranteed to match the coupon's `applies_to.products`. Survives any future lookup_key reassignment in Stripe.
2. ~~Keep `lookup_keys` and assert the returned product matches a whitelist~~ — Adds a runtime guard but still relies on Stripe state being correct; fails closed but doesn't fix the underlying brittleness.
3. ~~Move IDs to env vars~~ — Adds a secret-management step with no real benefit; these are not secrets and live Stripe IDs differ from sandbox IDs anyway (see Environment note).
4. ~~Read IDs from DB~~ — Overkill for two SKUs; introduces a query + caching surface for data that changes ~never.

### Ripple analysis — what else touches these IDs?

Traced every call path:

- **`get-stripe-price` edge function** — separate function used by client-side helpers (`getStripePriceId`). Not on the checkout path. **No change needed**; it can keep lookup_key resolution.
- **`payments-webhook`** — keys off `subscription.metadata.priceId` (the internal string `"pro_annual"` / `"starter_annual"`). We preserve that metadata exactly. **No change needed.**
- **`StripeEmbeddedCheckout` / `useStripeCheckout` / upgrade page** — pass internal `priceId` strings only. **No change needed.**
- **`subscription_data.trial_period_days: 365`** — preserved.
- **`allow_promotion_codes: true`** — preserved.
- **Setup fee `price_data`** — switches from `product: stripePrice.product` to literal `product: PRO_PRODUCT_ID | STARTER_PRODUCT_ID`.
- **Validation regex** on incoming `priceId` (`/^[a-zA-Z0-9_-]+$/`) — still passes for `pro_annual` / `starter_annual`. Add an explicit allowlist check (must be one of the two known keys) for defense-in-depth.

### Environment note (sandbox vs live)

Stripe Product/Price IDs are **per-environment** — live IDs (`prod_…`, `price_…` above) do not exist in sandbox. The map will be keyed by environment so sandbox testing still works against existing sandbox prices via lookup_keys, while live uses the hardcoded IDs.

```text
priceId (internal) ──▶ STRIPE_IDS[env][priceId] ──▶ { productId, priceId }
                            │
                            ├── live    → hardcoded prod_*/price_* (from user)
                            └── sandbox → resolved via lookup_keys (unchanged behavior)
```

This avoids breaking sandbox checkout in the preview while making live deterministic.

## Implementation steps

1. Edit `supabase/functions/create-checkout/index.ts`:
   - Add `STRIPE_IDS` constant mapping `{ live: { starter_annual: {...}, pro_annual: {...} } }`.
   - Add allowlist check: reject any `priceId` not in `["starter_annual", "pro_annual"]`.
   - Branch on `env`:
     - **live**: `stripe.prices.retrieve(STRIPE_IDS.live[priceId].priceId)` to get currency/type, then build line items using the literal `priceId` and `productId`.
     - **sandbox**: keep current `lookup_keys` flow (so preview still works without sandbox prod/price IDs).
   - Setup-fee `price_data.product`: literal product ID from the map (live) or `stripePrice.product` (sandbox).
   - Preserve: `allow_promotion_codes`, `trial_period_days: 365`, `subscription_data.metadata`, `ui_mode: "embedded"`, `return_url`, customer email passthrough.
2. Redeploy `create-checkout` via `supabase--deploy_edge_functions`.
3. Verify by invoking the function with `environment: "live"` and `priceId: "pro_annual"` and confirm:
   - Returned `clientSecret` is present.
   - Stripe Dashboard shows the resulting session with line items attached to `prod_ULJUtLfqo0icwT`.
   - Promo code field accepts `AWw4lrRx` without the "doesn't apply" error.

## Risks & mitigations

- **Risk**: Live IDs typo'd → coupon still rejects. **Mitigation**: copy IDs verbatim from this plan; verify in Stripe Dashboard post-deploy.
- **Risk**: Coupon's `applies_to.products` in Stripe doesn't actually include BOTH `prod_ULJU4Nl5h77Jte` and `prod_ULJUtLfqo0icwT`. **Mitigation**: user should confirm both products are listed under the coupon's "Applies to" in the Stripe Dashboard. Code change alone cannot fix a misconfigured coupon.
- **Risk**: Sandbox checkout breaks. **Mitigation**: sandbox branch unchanged.

## Files touched

- `supabase/functions/create-checkout/index.ts` (only file)

No DB migrations, no client changes, no new secrets, no webhook changes.
