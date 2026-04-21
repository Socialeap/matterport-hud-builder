// Deno port of src/lib/portal/pricing.ts.
// MUST stay in lockstep with the TS module so client display and server
// charge always agree. Pure function, no I/O.

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
  configured: boolean;
  modelCount: number;
}

export function calculatePresentationPrice(input: PricingInput): PricingResult {
  const modelCount = Math.max(0, Math.floor(input.modelCount || 0));

  if (input.use_flat_pricing) {
    const per = input.flat_price_per_model_cents ?? 0;
    const configured = (input.flat_price_per_model_cents ?? 0) > 0;
    return {
      mode: "flat",
      modelCount,
      configured,
      totalCents: per * modelCount,
    };
  }

  const A = input.base_price_cents ?? 0;
  const B_raw = input.tier3_price_cents;
  const C = input.additional_model_fee_cents ?? 0;
  const B = B_raw ?? A * 2 + C;
  const configured = (input.base_price_cents ?? 0) > 0;

  let total = 0;
  if (modelCount <= 2) {
    total = A * Math.max(1, modelCount);
  } else {
    total = B + Math.max(0, modelCount - 3) * C;
  }

  return { mode: "tiered", modelCount, configured, totalCents: total };
}
