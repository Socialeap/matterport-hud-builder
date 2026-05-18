# Enable Promo Code Field at Checkout

## Goal
Allow MSPs to enter the **3DPS Free-Test** promo code (coupon `AWw4lrRx`) directly in the Stripe Embedded Checkout form when subscribing to Starter or Pro.

## One-time action in Stripe Dashboard (user)
The ID `AWw4lrRx` is a **Coupon**, not a Promotion Code. For customers to type a code at checkout, a **Promotion Code** must exist that wraps that coupon.

In the Stripe Dashboard → Products → Coupons → open `3DPS Free-Test` (`AWw4lrRx`) → **Create promotion code** → set the redeemable code string (e.g. `FREETEST`) → Save. Repeat in both sandbox and live as needed.

(If you've already created the promotion code, no action is needed — just share the code string with MSPs.)

## Code change — single file
**`supabase/functions/create-checkout/index.ts`**

Add `allow_promotion_codes: true` to the subscription session params so the Stripe Embedded Checkout renders an "Add promotion code" field. One-time payment fallback gets the same flag for consistency.

```ts
sessionParams.allow_promotion_codes = true;
```

Placed right after `sessionParams` is initialized (applies to both Starter and Pro since they go through the same handler).

## Notes / constraints
- `allow_promotion_codes` and explicit `discounts: [...]` are mutually exclusive — we only use the former.
- Trial mechanics (`trial_period_days: 365`) and the one-time setup fee line item are unaffected; promotion codes apply only to eligible line items per the coupon's Stripe config.
- No DB changes, no new env vars, no client changes — `StripeEmbeddedCheckout.tsx` already renders whatever the session enables.
- Webhook handlers in `payments-webhook/index.ts` need no changes; discount is recorded on the Stripe side.

## Verification
1. Redeploy the `create-checkout` edge function.
2. Open Starter or Pro checkout in preview (sandbox).
3. Confirm an "Add promotion code" link appears in the embedded form.
4. Enter the promotion code → discount line appears → complete with test card `4242 4242 4242 4242`.
5. Repeat in live once the promotion code exists on the live coupon.
