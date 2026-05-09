import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { checkRateLimit, ipFromRequest } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const US_REGION_RE = /^[A-Z]{2}$/;
const normalizeCity = (s: string) => s.trim().replace(/\s+/g, " ");

const ALLOWED_SPECIALTIES = new Set<string>([
  "scan-matterport-pro3",
  "scan-drone-aerial",
  "scan-twilight-photography",
  "scan-walkthrough-video-clips",
  "scan-floor-plans",
  "scan-dimensional-measurements",
  "scan-same-day-turnaround",
  "vault-sound-library",
  "vault-portal-filters",
  "vault-interactive-widgets",
  "vault-custom-icons",
  "vault-property-mapper",
  "ai-lead-generation",
]);

interface Payload {
  email?: unknown;
  name?: unknown;
  brokerage?: unknown;
  city?: unknown;
  region?: unknown;
  zip?: unknown;
  consent_given?: unknown;
  consent_text?: unknown;
  essential_services?: unknown;
  preferable_services?: unknown;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function sanitizeServices(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  for (const v of input) {
    if (typeof v === "string" && ALLOWED_SPECIALTIES.has(v)) seen.add(v);
  }
  return Array.from(seen).sort();
}

serve(async (req) => {
 try {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

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

  let payload: Payload;
  try { payload = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!EMAIL_RE.test(email)) return json(400, { error: "Invalid email" });

  const cityRaw = typeof payload.city === "string" ? normalizeCity(payload.city) : "";
  if (cityRaw.length < 2 || cityRaw.length > 80) return json(400, { error: "Invalid city" });

  const name = typeof payload.name === "string" && payload.name.trim().length > 0
    ? payload.name.trim().slice(0, 120) : null;
  const brokerage = typeof payload.brokerage === "string" && payload.brokerage.trim().length > 0
    ? payload.brokerage.trim().slice(0, 120) : null;

  const regionRaw = typeof payload.region === "string" ? payload.region.trim().toUpperCase() : "";
  const region = regionRaw && US_REGION_RE.test(regionRaw) ? regionRaw : null;

  const zipRaw = typeof payload.zip === "string" ? payload.zip.trim() : "";
  const zip = zipRaw && ZIP_RE.test(zipRaw) ? zipRaw : null;

  const consentGiven = payload.consent_given === true;
  const consentText = typeof payload.consent_text === "string" ? payload.consent_text.trim() : "";
  if (!consentGiven || consentText.length < 10 || consentText.length > 1000) {
    return json(400, { error: "Consent is required" });
  }

  const essential = sanitizeServices(payload.essential_services);
  const preferable = sanitizeServices(payload.preferable_services);

  if (essential.length === 0 && preferable.length === 0) {
    return json(400, { error: "Select at least one Essential or Preferable service" });
  }

  const overlap = essential.filter((s) => preferable.includes(s));
  if (overlap.length > 0) {
    return json(400, { error: "A service cannot be both Essential and Preferable" });
  }

  const { data: suppressed } = await supabase
    .from("suppressed_emails").select("email").eq("email", email).maybeSingle();
  if (suppressed) return json(200, { success: true });

  const userAgent = req.headers.get("user-agent")?.slice(0, 500) ?? null;
  const nowIso = new Date().toISOString();
  // Optimistic 24h window. Refined to 24h/12h/null right after insert via
  // compute_priority_window_for_beacon (Handbook §2 dynamic Priority Lane).
  const proVisibilityUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();

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
      consent_at: nowIso,
      source_ip: ip === "unknown" ? null : ip,
      user_agent: userAgent,
      status: "waiting",
      essential_services: essential,
      preferable_services: preferable,
      pro_visibility_until: proVisibilityUntil,
      expires_at: expiresAt,
    })
    .select("id, match_token")
    .maybeSingle();

  if (insertError) {
    if ((insertError as { code?: string }).code === "23505") {
      const { data: updated, error: updateError } = await supabase
        .from("agent_beacons")
        .update({
          name,
          brokerage,
          region,
          zip,
          consent_given: true,
          consent_text: consentText,
          consent_at: nowIso,
          source_ip: ip === "unknown" ? null : ip,
          user_agent: userAgent,
          essential_services: essential,
          preferable_services: preferable,
          pro_visibility_until: proVisibilityUntil,
          expires_at: expiresAt,
        })
        .eq("email", email)
        .ilike("city", cityRaw)
        .eq("status", "waiting")
        .select("id, match_token")
        .maybeSingle();

      if (updateError || !updated) {
        console.error("capture-service-match update failed:", updateError);
        return json(200, { success: true });
      }

      void triggerMatcher();
      void refinePriorityWindow(updated.id);
      void sendVisitorReadyEmail({
        beaconId: updated.id,
        matchToken: updated.match_token,
        email,
        name,
        city: cityRaw,
        essential,
        preferable,
        req,
      });
      return json(200, { success: true, match_token: updated.match_token });
    }

    console.error("capture-service-match insert failed:", insertError);
    return json(500, { error: "Could not save service match request" });
  }

  void triggerMatcher();
  if (inserted?.id) void triggerGeocode(inserted.id);
  if (inserted?.id) void refinePriorityWindow(inserted.id);
  if (inserted?.id && inserted?.match_token) {
    void sendVisitorReadyEmail({
      beaconId: inserted.id,
      matchToken: inserted.match_token,
      email,
      name,
      city: cityRaw,
      essential,
      preferable,
      req,
    });
  }

  return json(200, { success: true, match_token: inserted?.match_token });
 } catch (err) {
  // Top-level safety net (see capture-beacon for rationale).
  console.error("capture-service-match unhandled error:", err);
  return new Response(
    JSON.stringify({
      error: err instanceof Error ? err.message : "Internal error",
    }),
    {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
 }
});

async function sendVisitorReadyEmail(args: {
  beaconId: string;
  matchToken: string;
  email: string;
  name: string | null;
  city: string;
  essential: string[];
  preferable: string[];
  req: Request;
}) {
  try {
    const origin = Deno.env.get("DASHBOARD_BASE_URL")
      || args.req.headers.get("origin")
      || "https://matterport-hud-builder.lovable.app";
    const matchUrl = `${origin.replace(/\/+$/, "")}/agents/match/${args.matchToken}`;

    const { error: enqueueErr } = await supabase.rpc("enqueue_email", {
      queue_name: "transactional_emails",
      payload: {
        template_name: "service-match-ready",
        recipient_email: args.email,
        data: {
          agentName: args.name ?? undefined,
          city: args.city,
          essentialServices: args.essential,
          preferableServices: args.preferable,
          matchUrl,
        },
      },
    });

    if (enqueueErr) {
      console.error("capture-service-match: enqueue_email failed:", enqueueErr);
      return;
    }

    await supabase
      .from("agent_beacons")
      .update({ service_match_notified_at: new Date().toISOString() })
      .eq("id", args.beaconId);
  } catch (err) {
    console.error("capture-service-match: sendVisitorReadyEmail crashed:", err);
  }
}

function triggerMatcher(): Promise<void> {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/match-beacons`;
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""}`,
    },
    body: "{}",
  }).then(() => undefined).catch((err) => {
    console.error("capture-service-match: matcher invocation failed:", err);
  });
}

function triggerGeocode(beaconId: string): Promise<void> {
  const dashboardBase = Deno.env.get("DASHBOARD_BASE_URL");
  const secret = Deno.env.get("INTERNAL_GEOCODE_SECRET");
  if (!dashboardBase || !secret) return Promise.resolve();
  const url = `${dashboardBase.replace(/\/+$/, "")}/api/geocode-beacon`;
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": secret },
    body: JSON.stringify({ beaconId }),
  }).then(() => undefined).catch((err) => {
    console.error("capture-service-match: geocode invocation failed:", err);
  });
}

// Refine `pro_visibility_until` to the dynamic window length:
//   ≥3 eligible Pros → 24h, 1-2 → 12h, 0 → null (immediate, no Pro-only).
// Best-effort. The optimistic 24h value set at insert is a safe upper bound;
// this only ever shortens it.
async function refinePriorityWindow(beaconId: string): Promise<void> {
  try {
    const { data, error } = await supabase
      .rpc("compute_priority_window_for_beacon", { p_beacon_id: beaconId });
    if (error) {
      console.warn("capture-service-match: refine window failed:", error);
      return;
    }
    const dynamicUntil: string | null = (data as string | null) ?? null;
    await supabase
      .from("agent_beacons")
      .update({ pro_visibility_until: dynamicUntil })
      .eq("id", beaconId);
  } catch (err) {
    console.warn("capture-service-match: refine window threw:", err);
  }
}
