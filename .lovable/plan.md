# Why the coupon is rejected

The 3DPS Free-Test coupon (`AWw4lrRx`) is configured in Stripe as **product-restricted** — it's attached to the Starter and Pro products. Stripe only accepts a promo code if at least one line item in the cart belongs to one of the coupon's allowed products.

Tracing `supabase/functions/create-checkout/index.ts`, a Pro checkout produces **two** line items:

1. **Subscription line** — `price: stripePrice.id` for `pro_annual` → belongs to the Pro product ✓ (coupon would apply)
2. **Setup fee line** — built inline with `price_data.product_data: { name: "Pro Studio Setup & Franchise Fee" }` → Stripe creates a **brand-new, unrelated product** on the fly for every checkout ✗

Combined with the 365-day trial (`trial_period_days: 365`), the recurring line is **$0 due now**. The only amount actually charged today is the setup fee — and that line item is attached to an ad-hoc product the coupon doesn't cover. Stripe therefore returns:

> "This code is valid, but doesn't apply to items in your order."

This is independent of `allow_promotion_codes` — that flag only controls whether the input box appears.

# Fix

Attach the setup fee line item to the **same Stripe product** as the subscription (the Pro / Starter product the coupon is already linked to), instead of creating a throwaway product. Stripe allows multiple prices (recurring + one-time) on the same product, and the coupon's `applies_to.products` check will then match.

### Code change (single file)

`supabase/functions/create-checkout/index.ts`, inside the `if (isRecurring)` branch where the setup fee is appended:

```ts
if (setupFeeCents > 0) {
  lineItems.push({
    price_data: {
      currency: stripePrice.currency || 'usd',
      product: stripePrice.product as string,   // ← reuse Pro/Starter product
      unit_amount: setupFeeCents,
    },
    quantity: 1,
  });
}
```

Replacing `product_data: { name: ... }` with `product: stripePrice.product` ties the setup fee to the same product the subscription price belongs to. The customer-facing name shown on the line item becomes the product's name in Stripe (e.g. "Pro Studio") — if you want the setup-fee subtitle, that can be set via `price_data.product_data.name` only when creating a new product, so we lose the "Setup & Franchise Fee" wording on the receipt line. Acceptable trade-off; the description can be conveyed via the product description in Stripe.

### Stripe Dashboard — verification

Open the `3DPS Free-Test` coupon in both sandbox and live:
- Confirm `Applies to → Specific products` includes the **Starter** and **Pro** products.
- Confirm there is a **Promotion code** (redeemable string, e.g. `FREETEST`) linked to the coupon — `allow_promotion_codes` only reveals the input; the Coupon itself isn't redeemable without a Promotion Code.

### Why not the alternatives

- **Remove product restriction on the coupon (apply to all)** — works but weakens the guardrail; coupon would discount any future product including Stripe Connect marketplace payments.
- **Make the coupon free-shipping/percentage-off on the subscription only** — useless here because the subscription is $0 during the 365-day trial; nothing to discount.
- **Create a dedicated "Setup Fee" product and attach the coupon to it** — works, but doubles dashboard maintenance (every tier change requires editing two products) and re-introduces the same bug the next time a new tier is added.

Reusing `stripePrice.product` is the smallest, safest change and self-heals: any product the subscription price belongs to is automatically the product the setup fee belongs to.

# Verification steps after deploy

1. Redeploy `create-checkout`.
2. In **sandbox**, open Pro checkout, enter the Promotion Code → expect 100% discount on the $299 setup fee, $0 due now, trial active.
3. Repeat for Starter ($149).
4. Repeat both in **live** once confirmed.
5. Check Stripe Dashboard → Payments: the resulting $0 PaymentIntent shows the coupon applied.

# Files touched

- `supabase/functions/create-checkout/index.ts` — 2-line change in the setup-fee `lineItems.push`.

No DB migrations, no client changes, no new env vars, no webhook changes.