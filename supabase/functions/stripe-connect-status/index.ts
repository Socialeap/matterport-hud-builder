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

    // Get the connect account ID
    const { data: branding } = await supabaseAdmin
      .from("branding_settings")
      .select("stripe_connect_id")
      .eq("provider_id", user.id)
      .maybeSingle();

    if (!branding?.stripe_connect_id) {
      return new Response(JSON.stringify({ onboarding_complete: false }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const env: StripeEnv = "sandbox";
    const stripe = createStripeClient(env);

    // Check account status
    const account = await stripe.accounts.retrieve(branding.stripe_connect_id);
    const isComplete = account.charges_enabled && account.details_submitted;

    // Update the DB if onboarding is complete
    if (isComplete) {
      await supabaseAdmin
        .from("branding_settings")
        .update({ stripe_onboarding_complete: true })
        .eq("provider_id", user.id);
    }

    return new Response(JSON.stringify({ onboarding_complete: isComplete }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Connect status error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
