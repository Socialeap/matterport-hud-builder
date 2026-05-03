import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { checkRateLimit, ipFromRequest } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
// US states + DC + territories. Beacons must be US-only per agreed scope.
const US_REGION_RE = /^[A-Z]{2}$/;
// Trim/normalize free-text city to a stable comparable form, but keep
// the human-typed casing for display.
const normalizeCity = (s: string) => s.trim().replace(/\s+/g, " ");

interface BeaconPayload {
  email?: unknown;
  name?: unknown;
  brokerage?: unknown;
  city?: unknown;
  region?: unknown;
  zip?: unknown;
  consent_given?: unknown;
  consent_text?: unknown;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  // IP-based soft cap: 5/min per IP. Same default as the Ask AI surface.
  const ip = ipFromRequest(req);
  const rl = checkRateLimit(ip, { perMinute: 5 });
  if (!rl.allowed) {
    return new Response(
      JSON.stringify({ error: "Too many submissions. Please try again shortly." }),
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

  let payload: BeaconPayload;
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  // ---- Validation -----------------------------------------------------
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) {
    return json(400, { error: "Invalid email" });
  }

  const cityRaw = typeof payload.city === "string" ? normalizeCity(payload.city) : "";
  if (cityRaw.length < 2 || cityRaw.length > 80) {
    return json(400, { error: "Invalid city" });
  }

  const name =
    typeof payload.name === "string" && payload.name.trim().length > 0
      ? payload.name.trim().slice(0, 120)
      : null;

  const brokerage =
    typeof payload.brokerage === "string" && payload.brokerage.trim().length > 0
      ? payload.brokerage.trim().slice(0, 120)
      : null;

  const regionRaw =
    typeof payload.region === "string" ? payload.region.trim().toUpperCase() : "";
  const region = regionRaw && US_REGION_RE.test(regionRaw) ? regionRaw : null;

  const zipRaw = typeof payload.zip === "string" ? payload.zip.trim() : "";
  const zip = zipRaw && ZIP_RE.test(zipRaw) ? zipRaw : null;

  // Consent is mandatory and must be explicit. The exact text shown to
  // the agent is recorded for evidence (CAN-SPAM/legal record).
  const consentGiven = payload.consent_given === true;
  const consentText =
    typeof payload.consent_text === "string" ? payload.consent_text.trim() : "";
  if (!consentGiven || consentText.length < 10 || consentText.length > 1000) {
    return json(400, { error: "Consent is required" });
  }

  // ---- Suppression check ---------------------------------------------
  // If the email is on the global suppression list (prior unsubscribe,
  // bounce, or complaint), refuse silently — i.e. respond 200 but do
  // NOT insert. This prevents us from reactivating an unsub by them
  // re-submitting the form.
  const { data: suppressed } = await supabase
    .from("suppressed_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (suppressed) {
    // Intentionally indistinguishable from the success path so callers
    // cannot probe the suppression list.
    return json(200, { success: true });
  }

  // ---- Upsert beacon --------------------------------------------------
  // The unique index is on (lower(email), lower(city)). On conflict we
  // refresh the consent record and reset the TTL — re-submission means
  // the agent is still interested.
  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;

  // Try insert first; if it fails on the unique key, do a targeted
  // update keyed on (lower(email), lower(city)).
  const { data: inserted, error: insertError } = await supabase
    .from("agent_beacons")
    .insert({
      email,
      name,
      brokerage,
      city: cityRaw,
      region,
      zip,
      country: "US",
      consent_given: true,
      consent_text: consentText,
      consent_at: new Date().toISOString(),
      source_ip: ip === "unknown" ? null : ip,
      user_agent: userAgent,
      status: "waiting",
      expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (insertError) {
    // 23505 = unique violation: same (email, city) already on file.
    // Refresh consent + TTL on the existing row.
    if ((insertError as { code?: string }).code === "23505") {
      const { error: updateError } = await supabase
        .from("agent_beacons")
        .update({
          name,
          brokerage,
          region,
          zip,
          consent_given: true,
          consent_text: consentText,
          consent_at: new Date().toISOString(),
          source_ip: ip === "unknown" ? null : ip,
          user_agent: userAgent,
          // If they had been marked expired/unsubscribed, leave that
          // alone — only "waiting" beacons should be reactivated by
          // re-submission, and unsubscribed was already short-circuited
          // by the suppression check above.
          expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
        })
        .eq("email", email)
        .ilike("city", cityRaw)
        .eq("status", "waiting");

      if (updateError) {
        console.error("capture-beacon update failed:", updateError);
        // Still return 200 — the data exists, the operator can investigate.
        return json(200, { success: true });
      }
      // Resubmission may also unblock matching if a new MSP went public
      // since the original submission. Fire and forget.
      void triggerMatcher();
      // Don't re-geocode on resubmission: lat/lng for this (email, city)
      // pair was either captured on the first submission or the prior
      // attempt was non-matching; either way Census costs us nothing
      // useful here.
      return json(200, { success: true });
    }

    console.error("capture-beacon insert failed:", insertError);
    return json(500, { error: "Could not save beacon" });
  }

  // Trigger the matcher so the new beacon gets emailed to a Pro Partner
  // in real time. We don't await — the matcher runs independently and
  // its failure must not affect the beacon-capture response.
  void triggerMatcher();

  // Fire-and-forget geocoding via the TanStack Start server route, so
  // the form-submit response stays fast (Census p99 ≈ 3s). Geocoding
  // failure is non-fatal — the SQL matcher's ZIP/trigram tiers cover
  // ungeocoded beacons.
  if (inserted?.id) {
    void triggerGeocode(inserted.id);
  }

  return json(200, { success: true });
});

/**
 * Fire-and-forget invocation of the match-beacons Edge Function.
 *
 * Why server-to-server rather than letting the matcher run on a
 * cron: latency. An agent who just submitted a beacon should get
 * the match email within seconds when an MSP already serves their
 * area, not after a cron tick.
 *
 * The matcher is global and idempotent, so calling it from many
 * trigger points is safe.
 */
function triggerMatcher(): Promise<void> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/match-beacons`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
    },
    body: "{}",
  })
    .then(() => undefined)
    .catch((err) => {
      // Log but never throw — matcher invocation is best-effort.
      console.error("capture-beacon: matcher invocation failed:", err);
    });
}

/**
 * Fire-and-forget POST to the TanStack Start geocoder endpoint. The
 * dashboard URL and shared secret are configured via env. If either
 * is missing (e.g. local dev without the dashboard running) we skip
 * silently — the matcher's ZIP/trigram tiers cover the gap.
 */
function triggerGeocode(beaconId: string): Promise<void> {
  const dashboardBase = Deno.env.get("DASHBOARD_BASE_URL");
  const secret = Deno.env.get("INTERNAL_GEOCODE_SECRET");
  if (!dashboardBase || !secret) {
    return Promise.resolve();
  }
  const url = `${dashboardBase.replace(/\/+$/, "")}/api/geocode-beacon`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-secret": secret,
    },
    body: JSON.stringify({ beaconId }),
  })
    .then(() => undefined)
    .catch((err) => {
      console.error("capture-beacon: geocode invocation failed:", err);
    });
}
