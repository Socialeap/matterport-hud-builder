import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { type StripeEnv, createStripeClient } from "../_shared/stripe.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    const body = await req.json().catch(() => ({}));
    const { returnUrl, environment } = body as { returnUrl?: string; environment?: StripeEnv };
    const env: StripeEnv = environment === "live" ? "live" : "sandbox";

    // Use the gateway-routed Stripe client
    const stripe = createStripeClient(env);

    // Check if user already has a connect account
    const { data: branding } = await supabaseAdmin
      .from("branding_settings")
      .select("stripe_connect_id")
      .eq("provider_id", user.id)
      .maybeSingle();

    let accountId = branding?.stripe_connect_id;

    if (!accountId) {
      // Create a new Express account — wrap in try/catch to surface platform-profile errors
      try {
        const account = await stripe.accounts.create({
          type: "express",
          email: user.email,
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: { provider_id: user.id },
        });
        accountId = account.id;
      } catch (stripeErr: any) {
        const msg = stripeErr instanceof Error ? stripeErr.message : String(stripeErr);
        const code = stripeErr?.code || stripeErr?.raw?.code;
        if (
          msg.includes("managing losses") ||
          msg.includes("platform-profile") ||
          msg.includes("Only Stripe Connect platforms") ||
          code === "platform_account_required"
        ) {
          return new Response(
            JSON.stringify({
              error:
                "Stripe Connect is not yet activated on the platform. The platform owner must complete the Stripe Platform Profile (Loss Liability acknowledgement, set to 'Platform is responsible for losses') before MSPs can connect. Please contact support.",
              code: "platform_not_activated",
            }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        throw stripeErr;
      }

      // Save the account ID
      await supabaseAdmin
        .from("branding_settings")
        .update({ stripe_connect_id: accountId })
        .eq("provider_id", user.id);
    }

    // Build the return URL with a marker so the frontend knows to check status
    const parsedReturn = new URL(returnUrl || `${req.headers.get("origin")}/dashboard/branding`);
    parsedReturn.searchParams.set("stripe_connect_return", "1");

    // Create an account link for onboarding
    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: parsedReturn.toString(),
      return_url: parsedReturn.toString(),
      type: "account_onboarding",
    });

    return new Response(JSON.stringify({ url: accountLink.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Connect onboard error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
