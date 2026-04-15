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

    const { returnUrl } = await req.json();
    const env: StripeEnv = "sandbox";
    const stripe = createStripeClient(env);

    // Check if user already has a connect account
    const { data: branding } = await supabaseAdmin
      .from("branding_settings")
      .select("stripe_connect_id")
      .eq("provider_id", user.id)
      .maybeSingle();

    let accountId = branding?.stripe_connect_id;

    if (!accountId) {
      // Create a new Express account
      const account = await stripe.accounts.create({
        type: "express",
        email: user.email,
        metadata: { provider_id: user.id },
      });
      accountId = account.id;

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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
