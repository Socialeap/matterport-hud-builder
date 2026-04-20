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
    const { environment } = body as { environment?: StripeEnv };
    const env: StripeEnv = environment === "live" ? "live" : "sandbox";

    // Fetch the connected account ID
    const { data: branding } = await supabaseAdmin
      .from("branding_settings")
      .select("stripe_connect_id, stripe_onboarding_complete")
      .eq("provider_id", user.id)
      .maybeSingle();

    if (!branding?.stripe_connect_id) {
      return new Response(
        JSON.stringify({ error: "No Stripe account connected. Complete Stripe Connect onboarding first." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripe = createStripeClient(env);

    let accountSession;
    try {
      accountSession = await stripe.accountSessions.create({
        account: branding.stripe_connect_id,
        components: {
          payouts: {
            enabled: true,
            features: {
              instant_payouts: true,
              standard_payouts: true,
              edit_payout_schedule: true,
            },
          },
          balances: {
            enabled: true,
            features: {
              instant_payouts: true,
              standard_payouts: true,
              edit_payout_schedule: true,
            },
          },
          payouts_list: { enabled: true },
        },
      });
    } catch (stripeErr: any) {
      // If the stored account no longer exists in this Stripe environment,
      // clear it so the user can re-onboard.
      if (stripeErr?.code === "resource_missing" || stripeErr?.raw?.code === "resource_missing") {
        await supabaseAdmin
          .from("branding_settings")
          .update({ stripe_connect_id: null, stripe_onboarding_complete: false })
          .eq("provider_id", user.id);
        return new Response(
          JSON.stringify({
            error: "Your Stripe account is no longer accessible (it may have been created in a different environment or removed). Please reconnect Stripe.",
            code: "stripe_account_missing",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw stripeErr;
    }

    return new Response(
      JSON.stringify({ client_secret: accountSession.client_secret }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Account session error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
