/**
 * Shared presentation-pricing function.
 *
 * Single source of truth for both the React UI (HudBuilderSandbox) and the
 * server-side checkout function (supabase/functions/create-connect-checkout).
 * The Deno port lives at supabase/functions/_shared/pricing.ts and MUST stay
 * in lockstep with this file.
 *
 * Two pricing modes:
 *   A) Flat rate: flat_price_per_model_cents × modelCount
 *   B) Tiered bundle:
 *        1 model  = base_price_cents (A)
 *        2 models = 2 × A
 *        3 models = tier3_price_cents (B), or 2A + additional_model_fee_cents if B is null
 *        4+       = B + (n − 3) × additional_model_fee_cents (C)
 */

export interface PricingInput {
  modelCount: number;
  use_flat_pricing: boolean;
  flat_price_per_model_cents: number | null;
  base_price_cents: number | null;
  tier3_price_cents: number | null;
  additional_model_fee_cents: number | null;
}

export interface PricingBreakdownLine {
  label: string;
  cents: number;
}

export interface PricingResult {
  totalCents: number;
  mode: "flat" | "tiered";
  breakdown: PricingBreakdownLine[];
  /** False when the MSP has not configured pricing for this mode. */
  configured: boolean;
  modelCount: number;
}

export function calculatePresentationPrice(input: PricingInput): PricingResult {
  const modelCount = Math.max(0, Math.floor(input.modelCount || 0));

  if (input.use_flat_pricing) {
    const per = input.flat_price_per_model_cents ?? 0;
    const configured = (input.flat_price_per_model_cents ?? 0) > 0;
    const total = per * modelCount;
    return {
      mode: "flat",
      modelCount,
      configured,
      totalCents: total,
      breakdown: [
        {
          label: `${modelCount || 1} model${modelCount === 1 ? "" : "s"} × $${(per / 100).toFixed(2)}`,
          cents: total,
        },
      ],
    };
  }

  // Tiered
  const A = input.base_price_cents ?? 0;
  const B_raw = input.tier3_price_cents;
  const C = input.additional_model_fee_cents ?? 0;
  const B = B_raw ?? A * 2 + C; // bundle fallback
  const configured = (input.base_price_cents ?? 0) > 0;

  let total = 0;
  const breakdown: PricingBreakdownLine[] = [];

  if (modelCount <= 2) {
    total = A * Math.max(1, modelCount);
    breakdown.push({
      label: `${modelCount || 1} model${modelCount === 1 ? "" : "s"} (Tier A)`,
      cents: total,
    });
  } else {
    total = B;
    breakdown.push({ label: `3 models (Tier B — bundle)`, cents: B });
    const extras = modelCount - 3;
    if (extras > 0) {
      const extraTotal = extras * C;
      total += extraTotal;
      breakdown.push({
        label: `+ ${extras} extra model${extras > 1 ? "s" : ""} × $${(C / 100).toFixed(2)}`,
        cents: extraTotal,
      });
    }
  }

  return {
    mode: "tiered",
    modelCount,
    configured,
    totalCents: total,
    breakdown,
  };
}
