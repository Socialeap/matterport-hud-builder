

## Critical Addition: Server-Side Price Calculation Must Match Client Display

You're right — pricing is the missing piece. After investigation, the bug is bigger than just UI rewiring: **the edge function's price calculation does not match the pricing model the client sees**. If we wire the new "Pay & Download" button without fixing this, Stripe will charge the wrong amount.

### The pricing model (what MSPs actually configure)

`branding_settings` supports **two mutually exclusive modes**:

**Mode A — Flat rate** (`use_flat_pricing = true`)
- `flat_price_per_model_cents` × `modelCount`
- e.g. $50/model → 4 models = $200

**Mode B — Tiered bundle** (`use_flat_pricing = false`, the default)
- `base_price_cents` (A), `tier3_price_cents` (B, optional bundle), `additional_model_fee_cents` (C)
- 1 model = A
- 2 models = 2 × A
- 3 models = B (bundle price; falls back to `2A + C` if B is null)
- 4+ models = B + (n − 3) × C

This is implemented correctly in `HudBuilderSandbox.tsx` (lines 304–327) and rendered in the price-breakdown card. It's also rendered correctly on the public `/p/{slug}` pricing section.

### The bug

`supabase/functions/create-connect-checkout/index.ts` uses a **completely different formula**:

```ts
totalCents = modelCount <= threshold
  ? basePriceCents
  : basePriceCents + ((modelCount - threshold) * additionalFeeCents);
```

It ignores `use_flat_pricing`, `flat_price_per_model_cents`, and `tier3_price_cents` entirely. For a flat-rate MSP at $50/model with 3 models, the UI shows $150 but Stripe charges $0 + … (actually `basePriceCents` which may be null → the function returns "Provider has not configured pricing" and blocks the sale).

For a tiered MSP, the UI may show the bundle price ($B) but Stripe charges `A + (n-1) × C`. Different number, and the MSP gets paid differently than the client was quoted. This is a trust/legal issue, not just a bug.

### Updated plan — pricing is part of the fix

**1. Extract a shared pricing function** — `src/lib/portal/pricing.ts`

Single source of truth, importable from both the React component and (as a copy-paste port to Deno) the edge function. Pure function, no side effects:

```ts
export interface PricingInput {
  modelCount: number;
  use_flat_pricing: boolean;
  flat_price_per_model_cents: number | null;
  base_price_cents: number | null;
  tier3_price_cents: number | null;
  additional_model_fee_cents: number | null;
}
export interface PricingResult {
  totalCents: number;
  mode: "flat" | "tiered";
  breakdown: { label: string; cents: number }[];
  configured: boolean;
}
export function calculatePresentationPrice(input: PricingInput): PricingResult;
```

The function implements both modes exactly as the existing UI does, returns a structured breakdown so the price card can render without inline math, and signals `configured: false` when neither pricing mode is set up.

**2. Refactor `HudBuilderSandbox.tsx`** to call `calculatePresentationPrice()` instead of inlining the math. Delete the duplicated `priceA / priceB / priceC / tier3Total / totalCents` block. Keep the existing breakdown card UI but feed it from `result.breakdown`.

**3. Port the same logic into the edge function** — `supabase/functions/_shared/pricing.ts` (Deno copy), then have `create-connect-checkout/index.ts` call it. The edge function already loads `branding_settings`; just include the missing columns (`use_flat_pricing`, `flat_price_per_model_cents`, `tier3_price_cents`) in the SELECT and pass them in.

**4. Server is the source of truth.** The Stripe `unit_amount` is whatever `calculatePresentationPrice()` returns server-side. The client passes `modelCount` (already does); the server never trusts a client-supplied `totalCents`. Free-client bypass logic is unchanged.

**5. Display sync guard.** Before opening Stripe, the client re-runs `calculatePresentationPrice()` against the just-counted `modelCount` and shows the breakdown. If somehow the server returns a different `amount_cents` after `savePresentationRequest` updates the row, the post-payment "Payment Confirmed" card will show the actual charged amount. (No mismatch should occur once #3 is in place.)

### Combined with the "Download Presentation" UX rewire

Everything from the previous plan still applies:

- Replace the misleading "Satisfied with your preview? — I Want This" fallback card with a single **Download Presentation** card.
- Drop the `reviewApproved` checkbox gate.
- Branch on `isFreeClient` (from `getClientFreeStatus`):
  - **Free** → button reads "Download Presentation" (no price), goes straight to the generator after the free-bypass round-trip.
  - **Pay** → button reads "Pay $X.XX & Download" using the **shared pricing function's total**, opens embedded Stripe checkout, auto-runs the generator on payment success.
  - **Anonymous** → opens `PortalSignupModal` (with the corrected "Sign in to download…" copy), then re-runs the flow.
- Extract the existing generator logic into `runDownload(modelId)` so both branches share it.
- "No pricing configured" fallback becomes a muted notice ("Contact {brand} to receive your presentation"), unless the client is `is_free` — in which case the Download button still works.

### Files to be edited

- `src/lib/portal/pricing.ts` — new, shared pricing function.
- `supabase/functions/_shared/pricing.ts` — new, Deno port of the same logic.
- `supabase/functions/create-connect-checkout/index.ts` — load all five pricing columns; replace inline math with the shared function; keep server as the source of truth.
- `src/components/portal/HudBuilderSandbox.tsx` — call `calculatePresentationPrice()`, rewire the bottom card per the UX plan, add `isFreeClient` lookup, extract `runDownload()`.
- `src/components/portal/PortalSignupModal.tsx` — copy fix only ("Sign in to download…").

### What this does NOT change

- No DB migration. All pricing columns already exist on `branding_settings`.
- No changes to `payments-webhook`, the Connect onboarding flow, or the public `/p/{slug}` pricing section.
- No changes to the generated `.html` end-product.

