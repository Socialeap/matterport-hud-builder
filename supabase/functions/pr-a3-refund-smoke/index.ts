// ONE-SHOT PR-A3 refund smoke test (sandbox only).
// Seeds real sandbox Stripe PaymentIntents + matching platform_fee_ledger
// rows, fires refunds, then re-reads the ledger so we can confirm the
// payments-webhook charge.refunded branch behaves per spec.
//
// DELETE THIS FUNCTION AFTER PR-A3 ACTIVATION IS SIGNED OFF.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createStripeClient } from "../_shared/stripe.ts";

const GATE = "pr-a3-smoke-2026-05-30";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-smoke-gate",
};

interface CaseResult {
  name: string;
  payment_intent: string | null;
  charge: string | null;
  refund: string | null;
  ledger_before?: any;
  ledger_after?: any;
  notes?: string;
  error?: string;
}

async function makePI(stripe: ReturnType<typeof createStripeClient>, amountCents: number) {
  // Confirms inline with the canonical test token, no redirect-based PMs.
  return await stripe.paymentIntents.create({
    amount: amountCents,
    currency: "usd",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    description: "PR-A3 refund smoke test",
    metadata: { smoke_test: "pr_a3", purpose: "refund_branch_verification" },
  });
}

async function seedLedger(opts: {
  paymentIntentId: string;
  checkoutPath: "platform_direct" | "provider_connected";
  feeCents: number;
  caseName: string;
  feeScheduleId: string;
}) {
  const { error, data } = await supabase
    .from("platform_fee_ledger")
    .insert({
      acquisition_source: "directory_request",
      model_count: 3,
      platform_fee_cents: opts.feeCents,
      fee_schedule_id: opts.feeScheduleId,
      checkout_path: opts.checkoutPath,
      stripe_payment_intent_id: opts.paymentIntentId,
      status: "collected",
      collected_at: new Date().toISOString(),
      notes: `smoke_test:${opts.caseName}`,
    })
    .select("id, status, checkout_path, notes")
    .single();
  if (error) throw new Error(`ledger seed failed: ${error.message}`);
  return data;
}

async function readLedger(paymentIntentId: string) {
  const { data, error } = await supabase
    .from("platform_fee_ledger")
    .select("id, status, checkout_path, notes, refunded_at")
    .eq("stripe_payment_intent_id", paymentIntentId);
  if (error) throw new Error(`ledger read failed: ${error.message}`);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }
  if (req.headers.get("x-smoke-gate") !== GATE) {
    return new Response("Forbidden", { status: 403, headers: corsHeaders });
  }

  const out: { cases: CaseResult[]; pending_review_rows: any[]; error?: string } = {
    cases: [],
    pending_review_rows: [],
  };

  try {
    const stripe = createStripeClient("sandbox");

    // Pick any active-ish fee_schedule (NOT NULL fk).
    const { data: sched, error: schedErr } = await supabase
      .from("platform_fee_schedule")
      .select("id, fee_cents")
      .is("effective_until", null)
      .limit(1)
      .maybeSingle();
    if (schedErr || !sched) throw new Error(`no active fee schedule: ${schedErr?.message}`);
    const feeScheduleId = sched.id as string;

    const cases: Array<{
      name: string;
      checkoutPath?: "platform_direct" | "provider_connected";
      refund: "full" | "partial" | "none";
      amount: number; // PI amount cents
      seed: boolean;
    }> = [
      { name: "case1_platform_direct_full",   checkoutPath: "platform_direct",    refund: "full",    amount: 3000, seed: true  },
      { name: "case2_provider_connected_full",checkoutPath: "provider_connected", refund: "full",    amount: 3000, seed: true  },
      { name: "case3_platform_direct_partial",checkoutPath: "platform_direct",    refund: "partial", amount: 4000, seed: true  },
      { name: "case4_non_fee_charge",                                              refund: "full",    amount: 2500, seed: false },
    ];

    // 1) Create PIs + ledger rows
    for (const c of cases) {
      const result: CaseResult = { name: c.name, payment_intent: null, charge: null, refund: null };
      try {
        const pi = await makePI(stripe, c.amount);
        result.payment_intent = pi.id;
        result.charge = (pi.latest_charge as string | null) ?? null;
        if (c.seed && c.checkoutPath) {
          result.ledger_before = await seedLedger({
            paymentIntentId: pi.id,
            checkoutPath: c.checkoutPath,
            feeCents: c.amount,
            caseName: c.name,
            feeScheduleId,
          });
        } else {
          result.notes = "no ledger row seeded (non-fee charge)";
        }
      } catch (e) {
        result.error = e instanceof Error ? e.message : String(e);
      }
      out.cases.push(result);
    }

    // 2) Fire refunds
    for (const [i, c] of cases.entries()) {
      const result = out.cases[i];
      if (!result.payment_intent || result.error) continue;
      try {
        const refundParams: Record<string, unknown> = { payment_intent: result.payment_intent };
        if (c.refund === "partial") refundParams.amount = Math.floor(c.amount / 2);
        const refund = await stripe.refunds.create(refundParams as any);
        result.refund = refund.id;
      } catch (e) {
        result.error = (result.error ? result.error + " | " : "") + `refund: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    // 3) Wait for webhook delivery (charge.refunded), then re-read ledger
    await new Promise((r) => setTimeout(r, 8000));
    for (const result of out.cases) {
      if (!result.payment_intent) continue;
      result.ledger_after = await readLedger(result.payment_intent);
    }

    // 4) Any pending-review rows in the ledger right now?
    const { data: pendingRows } = await supabase
      .from("platform_fee_ledger")
      .select("id, status, checkout_path, notes, stripe_payment_intent_id, occurred_at")
      .ilike("notes", "%_pending_review%");
    out.pending_review_rows = pendingRows ?? [];

    return new Response(JSON.stringify(out, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify(out, null, 2), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
