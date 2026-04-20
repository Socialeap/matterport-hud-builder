import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

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

    const { providerId, modelId, modelCount, returnUrl } = await req.json();

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

    // Look up MSP's branding/pricing and Stripe Connect ID
    const { data: branding, error: brandingError } = await supabaseAdmin
      .from("branding_settings")
      .select("stripe_connect_id, stripe_onboarding_complete, base_price_cents, model_threshold, additional_model_fee_cents, brand_name")
      .eq("provider_id", providerId)
      .single();

    if (brandingError || !branding) {
      return new Response(JSON.stringify({ error: "Provider not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!branding.stripe_connect_id || !branding.stripe_onboarding_complete) {
      return new Response(JSON.stringify({ error: "Provider has not connected Stripe" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (branding.base_price_cents == null) {
      return new Response(JSON.stringify({ error: "Provider has not configured pricing" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate total price server-side
    const basePriceCents = branding.base_price_cents;
    const threshold = branding.model_threshold ?? 1;
    const additionalFeeCents = branding.additional_model_fee_cents ?? 0;

    const totalCents = modelCount <= threshold
      ? basePriceCents
      : basePriceCents + ((modelCount - threshold) * additionalFeeCents);

    // ── Free-client bypass ──────────────────────────────────────────────
    // If this client was invited as a "Free" client, skip Stripe entirely
    // and immediately mark the saved_model paid + released so they can
    // generate/download their Presentation at no cost.
    const { data: link } = await supabaseAdmin
      .from("client_providers")
      .select("is_free")
      .eq("provider_id", providerId)
      .eq("client_id", user.id)
      .maybeSingle();

    if (link?.is_free === true) {
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

    const env: StripeEnv = "sandbox";
    const stripe = createStripeClient(env);

    // Create checkout session on behalf of the connected account
    const session = await stripe.checkout.sessions.create(
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
