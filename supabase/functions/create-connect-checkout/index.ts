import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";
import { calculatePresentationPrice } from "../_shared/pricing.ts";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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

    const { providerId, modelId, modelCount, returnUrl, environment } = await req.json();
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
    if (!modelCount || typeof modelCount !== "number" || modelCount < 1) {
      return new Response(JSON.stringify({ error: "Invalid modelCount" }), {
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
    // Prevents arbitrary users creating checkouts for unrelated models.
    const { data: ownedModel, error: ownedError } = await supabaseAdmin
      .from("saved_models")
      .select("id, client_id, provider_id")
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

    // ── Free-client bypass ──────────────────────────────────────────────
    // Resolve free status via the authoritative server-side resolver.
    // This auto-heals from accepted invitations and is the single source
    // of truth for free vs paid.
    const { data: accessRows } = await supabaseClient.rpc("resolve_studio_access", {
      _provider_id: providerId,
    });
    const access = Array.isArray(accessRows) ? accessRows[0] : null;
    const isFree = access?.is_free === true;

    if (isFree) {
      await supabaseAdmin
        .from("saved_models")
        .update({
          amount_cents: 0,
          model_count: modelCount,
          status: "paid",
          is_released: true,
        })
        .eq("id", modelId);

      return new Response(
        JSON.stringify({ free: true, modelId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!branding.stripe_connect_id || !branding.stripe_onboarding_complete) {
      return new Response(JSON.stringify({ error: "Provider has not connected Stripe" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate price using the shared pricing function — server is the
    // source of truth. Client-supplied totals are never trusted.
    const pricing = calculatePresentationPrice({
      modelCount,
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

    const totalCents = pricing.totalCents;

    const stripe = createStripeClient(env);

    // Create checkout session on behalf of the connected account
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
                  description: `${modelCount} model${modelCount > 1 ? "s" : ""} included`,
                },
                unit_amount: totalCents,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          ui_mode: "embedded",
          return_url: returnUrl || `${req.headers.get("origin")}/p/return?session_id={CHECKOUT_SESSION_ID}`,
          customer_email: user.email ?? undefined,
          metadata: {
            modelId,
            providerId,
            clientId: user.id,
            modelCount: String(modelCount),
          },
        },
        {
          stripeAccount: branding.stripe_connect_id,
        }
      );
    } catch (stripeErr: any) {
      const code = stripeErr?.code || stripeErr?.raw?.code;
      const type = stripeErr?.type || stripeErr?.rawType;
      const status = stripeErr?.statusCode;
      console.error("Stripe checkout.sessions.create failed:", {
        env,
        connectId: branding.stripe_connect_id,
        code,
        type,
        status,
      });

      // Platform not activated for Stripe Connect (Platform Profile incomplete)
      if (
        code === "platform_account_required" ||
        type === "StripePermissionError" ||
        (typeof stripeErr?.message === "string" &&
          stripeErr.message.includes("Only Stripe Connect platforms"))
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

    // Update saved_models with the amount and model count
    await supabaseAdmin
      .from("saved_models")
      .update({ amount_cents: totalCents, model_count: modelCount })
      .eq("id", modelId);

    return new Response(JSON.stringify({ clientSecret: session.client_secret, stripeConnectAccountId: branding.stripe_connect_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Connect checkout error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
