import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  type StripeEnv,
  createStripeClient,
  isStripeCredentialError,
  stripeCredentialResponse,
} from "../_shared/stripe.ts";
import { calculatePresentationPrice } from "../_shared/pricing.ts";

// ============================================================
// Frontiers3D Phase 3.1 — Platform-fee checkout wiring.
//
// Extends the existing per-presentation Connect checkout WITHOUT
// changing how providers set their own retail price or how Stripe
// Connect itself is configured. Two paths, both client-pays:
//
//   Path P (provider_retail > 0): existing Connect direct charge on
//     the provider's connected account, now with the mandatory
//     Frontiers3D platform fee added as a line item and collected via
//     application_fee_amount. Client pays retail + fee; provider nets
//     retail; platform nets fee.
//
//   Path F (provider_retail = 0, provider waived their fee): a
//     PLATFORM-OWNED checkout (no connected account) for the platform
//     fee only. Client pays the fee; platform is merchant of record;
//     provider receives $0 and incurs no Stripe cost.
//
// Owner/provider self-access remains fully exempt (no checkout, no
// fee, no ledger row).
//
// Fee = _resolve_platform_fee_cents(acquisition_source, model_count),
// where model_count is derived SERVER-SIDE from the saved_models
// contents (never trusted from the request body).
// ============================================================

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const ALLOWED_SOURCES = new Set(["map_oracle", "agent_form", "directory_request", "scs_direct"]);

/**
 * Server-authoritative billable model count. Counts entries in the
 * saved presentation that have a non-empty matterportId — the exact
 * predicate the builder uses to compute its own modelCount
 * (`models.filter((m) => m.matterportId.trim()).length`). The request
 * body's modelCount is NEVER trusted for billing because the platform
 * fee scales by count.
 */
function countBillableModels(properties: unknown): number {
  if (!Array.isArray(properties)) return 0;
  return properties.filter(
    (m) =>
      m &&
      typeof (m as { matterportId?: unknown }).matterportId === "string" &&
      ((m as { matterportId: string }).matterportId).trim().length > 0
  ).length;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { providerId, modelId, returnUrl, environment } = await req.json();
    const env: StripeEnv = environment === "live" ? "live" : "sandbox";

    if (!providerId || typeof providerId !== "string") {
      return new Response(JSON.stringify({ error: "Invalid providerId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!modelId || typeof modelId !== "string") {
      return new Response(JSON.stringify({ error: "Invalid modelId" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up MSP's branding/pricing and Stripe Connect ID — load all five
    // pricing columns so the shared pricing function has what it needs.
    const { data: branding, error: brandingError } = await supabaseAdmin
      .from("branding_settings")
      .select("stripe_connect_id, stripe_onboarding_complete, brand_name, use_flat_pricing, flat_price_per_model_cents, base_price_cents, tier3_price_cents, additional_model_fee_cents")
      .eq("provider_id", providerId)
      .single();

    if (brandingError || !branding) {
      return new Response(JSON.stringify({ error: "Provider not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Ownership guard ────────────────────────────────────────────────
    // Confirm the saved_models row belongs to this client AND this provider.
    // Also pull `properties` so we can derive the server-authoritative
    // model count (the billing input — never trusted from the request).
    const { data: ownedModel, error: ownedError } = await supabaseAdmin
      .from("saved_models")
      .select("id, client_id, provider_id, status, is_released, amount_cents, retail_waived, properties")
      .eq("id", modelId)
      .maybeSingle();

    if (ownedError || !ownedModel) {
      return new Response(JSON.stringify({ error: "Model not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (ownedModel.client_id !== user.id || ownedModel.provider_id !== providerId) {
      return new Response(JSON.stringify({ error: "Model does not belong to this client/provider" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Server-authoritative billable model count (drives BOTH the platform
    // fee and the provider retail price).
    const serverModelCount = countBillableModels(ownedModel.properties);

    // ── Owner self-build bypass ────────────────────────────────────────
    // The MSP using their own /builder is not a buyer — they are the
    // owner. This is operational self-access, fully exempt: no checkout,
    // no provider fee, no platform fee, no ledger row.
    if (ownedModel.provider_id === user.id) {
      console.log("[create-connect-checkout] owner self-build bypass", { modelId, userId: user.id });
      await supabaseAdmin
        .from("saved_models")
        .update({
          amount_cents: 0,
          model_count: serverModelCount,
          status: "paid",
          is_released: true,
        })
        .eq("id", modelId);

      return new Response(
        JSON.stringify({ free: true, ownerFree: true, modelId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Already-settled order guard ────────────────────────────────────
    // If this exact saved_model is already paid + released at $0, it has
    // been settled (e.g. a prior completed Path F fee checkout, or owner
    // self-access). Do not re-charge; just return free.
    //
    // As of Phase 3.2, a provider "Waive My Fee" comp no longer lands here:
    // it sets retail_waived=true WITHOUT releasing, so such orders flow to
    // Path F below and the client still pays the platform fee. This guard
    // now only short-circuits genuinely-settled orders (fee already paid).
    if (
      ownedModel.status === "paid" &&
      ownedModel.is_released === true &&
      ownedModel.amount_cents === 0
    ) {
      await supabaseAdmin
        .from("saved_models")
        .update({ model_count: serverModelCount })
        .eq("id", modelId);

      return new Response(
        JSON.stringify({ free: true, oneTimeFree: true, modelId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The platform fee requires at least one and at most five billable
    // models. Surface a clear error rather than silently mis-billing.
    if (serverModelCount < 1) {
      return new Response(
        JSON.stringify({ error: "This presentation has no billable models yet. Add a model before checkout." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (serverModelCount > 5) {
      return new Response(
        JSON.stringify({ error: "Presentations are limited to 5 models." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Resolve acquisition source (Marketplace vs Direct fee schedule) ──
    // Read the client↔provider binding. Until the beacon→client bridge
    // lands, links created via invitation default to 'scs_direct'.
    const { data: cpRow } = await supabaseAdmin
      .from("client_providers")
      .select("acquisition_source")
      .eq("client_id", user.id)
      .eq("provider_id", providerId)
      .maybeSingle();
    const acquisitionSource =
      cpRow?.acquisition_source && ALLOWED_SOURCES.has(cpRow.acquisition_source)
        ? cpRow.acquisition_source
        : "scs_direct";
    if (!cpRow) {
      console.log("[create-connect-checkout] no client_providers link; defaulting acquisition_source=scs_direct", { clientId: user.id, providerId });
    }

    // ── Resolve the mandatory platform fee (strict; no silent default) ──
    const { data: feeCentsRaw, error: feeError } = await supabaseAdmin.rpc(
      "_resolve_platform_fee_cents",
      { p_source: acquisitionSource, p_model_count: serverModelCount }
    );
    const feeCents = typeof feeCentsRaw === "number" ? feeCentsRaw : Number(feeCentsRaw);
    if (feeError || !Number.isFinite(feeCents) || feeCents < 0) {
      console.error("[create-connect-checkout] platform fee resolution failed", { acquisitionSource, serverModelCount, feeError });
      return new Response(
        JSON.stringify({ error: "Unable to resolve the platform fee for this presentation. Please contact support.", code: "platform_fee_unresolved" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Capture the exact active schedule row used, for the ledger audit
    // trail (fee_schedule_id is NOT NULL). One active row per
    // (source, model_count) is guaranteed by the Phase 3.0 unique index.
    const { data: schedRow, error: schedError } = await supabaseAdmin
      .from("platform_fee_schedule")
      .select("id")
      .eq("source", acquisitionSource)
      .eq("model_count", serverModelCount)
      .is("effective_until", null)
      .maybeSingle();
    if (schedError || !schedRow?.id) {
      console.error("[create-connect-checkout] active fee schedule row not found", { acquisitionSource, serverModelCount, schedError });
      return new Response(
        JSON.stringify({ error: "Platform fee schedule is misconfigured. Please contact support.", code: "platform_fee_unresolved" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const feeScheduleId = schedRow.id as string;

    const origin = req.headers.get("origin") ?? "";
    const resolvedReturnUrl = returnUrl || `${origin}/p/return?session_id={CHECKOUT_SESSION_ID}`;
    const sharedMetadata = {
      modelId,
      providerId,
      clientId: user.id,
      modelCount: String(serverModelCount),
      feeCents: String(feeCents),
      acquisitionSource,
      feeScheduleId,
    };

    // ── Retail-waived → Path F (platform-owned fee checkout) ────────────
    // The provider has waived their retail fee — either globally for this
    // client (resolve_studio_access.is_free) or for this specific order
    // (Phase 3.2: saved_models.retail_waived, set by the provider's
    // "Waive My Fee" action). Either way the mandatory platform fee is
    // still owed; the client pays it to the PLATFORM account (Frontiers3D
    // is merchant of record). No connected account is touched — the
    // provider receives $0 and pays no Stripe fee.
    const { data: accessRows } = await supabaseClient.rpc("resolve_studio_access", {
      _provider_id: providerId,
    });
    const access = Array.isArray(accessRows) ? accessRows[0] : null;
    const isFree = access?.is_free === true;
    const retailWaived = ownedModel.retail_waived === true;

    const stripe = createStripeClient(env);

    if (isFree || retailWaived) {
      let session;
      try {
        session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "Frontiers3D presentation access",
                  description: `${serverModelCount} model${serverModelCount > 1 ? "s" : ""}`,
                },
                unit_amount: feeCents,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          ui_mode: "embedded",
          return_url: resolvedReturnUrl,
          customer_email: user.email ?? undefined,
          metadata: { ...sharedMetadata, path: "platform_direct" },
        });
        // NOTE: no { stripeAccount } — this is a platform-account charge.
      } catch (stripeErr: unknown) {
        console.error("[create-connect-checkout] platform-direct session create failed:", stripeErr);
        if (isStripeCredentialError(stripeErr)) {
          return stripeCredentialResponse(env, corsHeaders);
        }
        throw stripeErr;
      }

      // Record the pending platform-fee obligation. Best-effort: the
      // webhook upserts on completion and can reconstruct from metadata
      // if this insert failed, so a logging failure must not block the
      // client's checkout.
      const { error: ledgerErr } = await supabaseAdmin.from("platform_fee_ledger").insert({
        saved_model_id: modelId,
        client_id: user.id,
        provider_id: providerId,
        acquisition_source: acquisitionSource,
        model_count: serverModelCount,
        platform_fee_cents: feeCents,
        fee_schedule_id: feeScheduleId,
        checkout_path: "platform_direct",
        stripe_checkout_session_id: session.id,
        status: "pending",
      });
      if (ledgerErr) console.error("[create-connect-checkout] pending ledger insert failed (platform_direct):", ledgerErr);

      // amount_cents reflects what the client paid the PROVIDER (0 here);
      // the platform fee lives in platform_fee_ledger, not saved_models.
      await supabaseAdmin
        .from("saved_models")
        .update({ amount_cents: 0, model_count: serverModelCount })
        .eq("id", modelId);

      // No stripeConnectAccountId → frontend opens a platform (non-connect)
      // embedded checkout. Release happens on webhook payment completion.
      // amountCents is the client's charge (the platform fee only).
      return new Response(
        JSON.stringify({ clientSecret: session.client_secret, platformDirect: true, amountCents: feeCents }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Paid client → Path P (Connect direct charge + application fee) ──
    if (!branding.stripe_connect_id || !branding.stripe_onboarding_complete) {
      return new Response(JSON.stringify({ error: "Provider has not connected Stripe" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Provider retail via the shared pricing function — server is the
    // source of truth. Uses the server-authoritative model count.
    const pricing = calculatePresentationPrice({
      modelCount: serverModelCount,
      use_flat_pricing: !!branding.use_flat_pricing,
      flat_price_per_model_cents: branding.flat_price_per_model_cents ?? null,
      base_price_cents: branding.base_price_cents ?? null,
      tier3_price_cents: branding.tier3_price_cents ?? null,
      additional_model_fee_cents: branding.additional_model_fee_cents ?? null,
    });

    if (!pricing.configured || pricing.totalCents < 1) {
      return new Response(JSON.stringify({ error: "Provider has not configured pricing" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const retailCents = pricing.totalCents;

    // Create checkout session on behalf of the connected account, charging
    // retail + platform fee and diverting the fee to the platform via
    // application_fee_amount.
    let session;
    try {
      session = await stripe.checkout.sessions.create(
        {
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: `${branding.brand_name || "3D Tour"} Presentation`,
                  description: `${serverModelCount} model${serverModelCount > 1 ? "s" : ""} included`,
                },
                unit_amount: retailCents,
              },
              quantity: 1,
            },
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "Frontiers3D platform fee",
                  description: `${serverModelCount} model${serverModelCount > 1 ? "s" : ""}`,
                },
                unit_amount: feeCents,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          ui_mode: "embedded",
          payment_intent_data: {
            application_fee_amount: feeCents,
          },
          return_url: resolvedReturnUrl,
          customer_email: user.email ?? undefined,
          metadata: { ...sharedMetadata, path: "provider_connected" },
        },
        {
          stripeAccount: branding.stripe_connect_id,
        }
      );
    } catch (stripeErr: unknown) {
      const stripeError = stripeErr as {
        code?: string;
        raw?: { code?: string };
        rawType?: string;
        type?: string;
        statusCode?: number;
        message?: string;
      };
      const code = stripeError.code || stripeError.raw?.code;
      const type = stripeError.type || stripeError.rawType;
      const status = stripeError.statusCode;
      console.error("Stripe checkout.sessions.create failed:", {
        env,
        connectId: branding.stripe_connect_id,
        code,
        type,
        status,
      });

      if (isStripeCredentialError(stripeErr)) {
        return stripeCredentialResponse(env, corsHeaders);
      }

      // Platform not activated for Stripe Connect (Platform Profile incomplete)
      if (
        code === "platform_account_required" ||
        type === "StripePermissionError" ||
        (typeof stripeError.message === "string" &&
          stripeError.message.includes("Only Stripe Connect platforms"))
      ) {
        return new Response(
          JSON.stringify({
            error:
              "Payments are temporarily unavailable for this Studio. The platform's Stripe Connect setup is incomplete. Please contact support.",
            code: "platform_not_activated",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Connected account exists in DB but not in this Stripe environment.
      if (code === "resource_missing" || code === "account_invalid") {
        return new Response(
          JSON.stringify({
            error:
              "This Studio's payout account is not accessible in the current payment environment. The Studio owner needs to reconnect their Stripe account.",
            code: "stripe_account_env_mismatch",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      throw stripeErr;
    }

    // Record the pending platform-fee obligation (best-effort; webhook
    // upserts on completion). amount_cents on saved_models stays the
    // provider RETAIL portion — the webhook keeps it retail-only by
    // subtracting the fee from amount_total.
    const { error: ledgerErr } = await supabaseAdmin.from("platform_fee_ledger").insert({
      saved_model_id: modelId,
      client_id: user.id,
      provider_id: providerId,
      acquisition_source: acquisitionSource,
      model_count: serverModelCount,
      platform_fee_cents: feeCents,
      fee_schedule_id: feeScheduleId,
      checkout_path: "provider_connected",
      stripe_checkout_session_id: session.id,
      status: "pending",
    });
    if (ledgerErr) console.error("[create-connect-checkout] pending ledger insert failed (provider_connected):", ledgerErr);

    await supabaseAdmin
      .from("saved_models")
      .update({ amount_cents: retailCents, model_count: serverModelCount })
      .eq("id", modelId);

    // amountCents is the client's total charge (provider retail + platform fee).
    return new Response(JSON.stringify({ clientSecret: session.client_secret, stripeConnectAccountId: branding.stripe_connect_id, amountCents: retailCents + feeCents }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Connect checkout error:", error);
    if (isStripeCredentialError(error)) {
      return stripeCredentialResponse("sandbox", corsHeaders);
    }
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
