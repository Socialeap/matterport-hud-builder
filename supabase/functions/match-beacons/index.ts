import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { checkRateLimit, ipFromRequest } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const SITE_URL =
  Deno.env.get("DASHBOARD_BASE_URL") ?? "https://3dps.transcendencemedia.com";

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

interface ClaimedMatch {
  beacon_id: string;
  beacon_email: string;
  beacon_name: string | null;
  beacon_city: string;
  beacon_region: string | null;
  provider_id: string;
  provider_email: string | null;
  provider_brand_name: string;
  provider_slug: string | null;
  provider_tier: "starter" | "pro";
  provider_custom_domain: string | null;
  exclusive_until: string | null;
}

function buildStudioUrl(match: ClaimedMatch): string | null {
  if (!match.provider_slug) return null;
  if (
    match.provider_tier === "pro" &&
    match.provider_custom_domain &&
    match.provider_custom_domain.trim().length > 0
  ) {
    const trimmed = match.provider_custom_domain.trim().replace(/\/+$/, "");
    const base = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return `${base}/p/${match.provider_slug}`;
  }
  return `${SITE_URL}/p/${match.provider_slug}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // Soft IP cap. The matcher is idempotent and cheap, but exposing it
  // publicly means we still want a guard against pathological clients.
  // 30/min is generous: legitimate triggers (capture-beacon, branding
  // saves) won't come close.
  const ip = ipFromRequest(req);
  const rl = checkRateLimit(ip, { perMinute: 30 });
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: "Rate limited" }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(rl.retryAfterSeconds),
        },
      },
    );
  }

  // The matcher is global by design — multiple Pros may serve the same
  // city, and each beacon picks the best match. Callers don't pass a
  // provider_id; the RPC scans all unmatched waiting beacons.
  const { data: claimed, error: claimError } = await supabase
    .rpc("claim_pending_beacon_matches", { p_limit: 25 })
    .returns<ClaimedMatch[]>();

  if (claimError) {
    console.error("match-beacons: claim_pending_beacon_matches failed:", claimError);
    return json(500, { error: "matcher_failed" });
  }

  const matches = claimed ?? [];

  let enqueuedAgent = 0;
  let enqueuedProvider = 0;
  let suppressed = 0;
  let failed = 0;

  for (const match of matches) {
    const studioUrl = buildStudioUrl(match);
    const cityLabel = match.beacon_region
      ? `${match.beacon_city}, ${match.beacon_region}`
      : match.beacon_city;

    // ------------------------------------------------------
    // Agent-side: existing "MSP is now active in your area"
    // notification. Suppression check is per-recipient.
    // ------------------------------------------------------
    const { data: agentSuppressed } = await supabase
      .from("suppressed_emails")
      .select("email")
      .eq("email", match.beacon_email)
      .maybeSingle();

    if (agentSuppressed) {
      suppressed += 1;
    } else {
      const { error: agentEnqueueError } = await supabase.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          template_name: "beacon-match-found",
          recipient_email: match.beacon_email,
          data: {
            agentName: match.beacon_name ?? "there",
            city: cityLabel,
            mspBrandName: match.provider_brand_name,
            studioUrl,
          },
        },
      });

      if (agentEnqueueError) {
        console.error("match-beacons: agent enqueue failed:", agentEnqueueError);
        failed += 1;
      } else {
        enqueuedAgent += 1;
      }
    }

    // ------------------------------------------------------
    // Pro-side: new "you have an exclusive lead, 72h clock"
    // notification. Skip silently if the RPC didn't return an
    // email (provider row exists but no auth.users.email — should
    // not happen in practice but defended against).
    // ------------------------------------------------------
    if (!match.provider_email) {
      continue;
    }

    const { data: providerSuppressed } = await supabase
      .from("suppressed_emails")
      .select("email")
      .eq("email", match.provider_email)
      .maybeSingle();
    if (providerSuppressed) {
      // Don't count toward the agent suppressed counter — these
      // are different recipients.
      continue;
    }

    const { error: providerEnqueueError } = await supabase.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        template_name: "marketplace-lead-assigned",
        recipient_email: match.provider_email,
        data: {
          providerName: match.provider_brand_name,
          agentName: match.beacon_name,
          city: cityLabel,
          expiresAtIso: match.exclusive_until,
          dashboardUrl: `${SITE_URL}/dashboard/marketplace`,
          studioUrl,
        },
      },
    });

    if (providerEnqueueError) {
      console.error("match-beacons: provider enqueue failed:", providerEnqueueError);
      failed += 1;
    } else {
      enqueuedProvider += 1;
    }
  }

  return json(200, {
    success: true,
    claimed: matches.length,
    enqueued_agent: enqueuedAgent,
    enqueued_provider: enqueuedProvider,
    suppressed,
    failed,
  });
});
