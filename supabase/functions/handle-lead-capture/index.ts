import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const { studio_id, visitor_email, property_name } = await req.json();

    // Validate input
    if (!studio_id || typeof studio_id !== "string") {
      return new Response(JSON.stringify({ error: "Missing studio_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!visitor_email || typeof visitor_email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(visitor_email)) {
      return new Response(JSON.stringify({ error: "Invalid visitor_email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Look up license by studio_id
    const { data: license, error: licError } = await supabase
      .from("licenses")
      .select("user_id, tier, license_status, license_expiry")
      .eq("studio_id", studio_id)
      .single();

    if (licError || !license) {
      console.error("License not found for studio_id:", studio_id);
      return new Response(JSON.stringify({ error: "Invalid studio" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Verify Pro tier and active license
    if (license.tier !== "pro") {
      return new Response(JSON.stringify({ error: "Lead capture requires Pro tier" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (license.license_status !== "active") {
      return new Response(JSON.stringify({ error: "License is not active" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check expiry
    if (license.license_expiry && new Date(license.license_expiry) < new Date()) {
      return new Response(JSON.stringify({ error: "License has expired" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get provider email from profiles
    const { data: profile, error: profError } = await supabase
      .from("profiles")
      .select("display_name, user_id")
      .eq("user_id", license.user_id)
      .single();

    if (profError || !profile) {
      console.error("Profile not found for user:", license.user_id);
      return new Response(JSON.stringify({ error: "Provider not found" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get user email from auth (via service role)
    const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(license.user_id);

    if (userError || !user?.email) {
      console.error("Could not fetch provider email:", userError);
      return new Response(JSON.stringify({ error: "Provider email not found" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enqueue lead-capture-alert email via the transactional email system
    const emailPayload = {
      template_name: "lead-capture-alert",
      recipient_email: user.email,
      data: {
        agentName: profile.display_name || "Agent",
        visitorEmail: visitor_email,
        propertyName: property_name || "Unknown Property",
        capturedAt: new Date().toISOString(),
      },
    };

    // Try to enqueue via pgmq
    const { error: enqueueError } = await supabase.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: emailPayload,
    });

    if (enqueueError) {
      console.error("Failed to enqueue lead email:", enqueueError);
      // Still return success to the HTML — the lead was captured, email delivery is best-effort
    }

    console.log(`Lead captured: studio=${studio_id}, visitor=${visitor_email}, provider=${user.email}`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Internal error";
    console.error("handle-lead-capture error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
