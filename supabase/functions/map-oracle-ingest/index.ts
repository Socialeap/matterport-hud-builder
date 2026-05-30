import { createClient } from "npm:@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ============================================================
// Frontiers3D — Map Oracle Ingest (Track B scraper layer)
//
// Operator-only, COST-BOUNDED Google Places ingestion into the
// Phase-1 (PR-B1) tables. ONE controlled query per invocation:
//   * Text Search   — query = "<category> in <city>"        (source='google_places_text')
//   * Nearby Search  — location=lat,lng + radius + keyword   (source='google_places_nearby')
//   * optional Place Details per result (capped)             (source='google_places_details')
//
// It writes raw JSONB into `raw_scrape_snapshots` and a run row
// into `scrape_runs`. It does NOT normalize — the existing PR-B1
// cron worker `process_unprocessed_snapshots(...)` turns snapshots
// into `properties`. This function never touches Track A, billing,
// Stripe, agent_beacons, doorway, promote, or any Track B2/B3/B4
// object.
//
// SAFETY (no uncontrolled spend loop):
//   * Admin-only (has_role(uid,'admin')).
//   * Exactly one city/category/radius per call — NO multi-city loop.
//   * Hard caps: MAX_PLACES, MAX_PAGES, MAX_RADIUS_M, MAX_DETAILS.
//   * Bounded retries (no busy-wait), per-snapshot errors logged and
//     skipped rather than failing the whole run.
//   * dryRun: validate + echo the plan WITHOUT calling Google or writing.
//   * Missing GOOGLE_PLACES_API_KEY → clear 400 (safe before the
//     secret is provisioned; never crashes, never spends).
// ============================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── Hard safety caps (cannot be exceeded by request params) ─────────
const MAX_PLACES = 60;        // Google text/nearby returns ≤3 pages × 20
const MAX_PAGES = 3;          // page-token pagination ceiling
const MAX_RADIUS_M = 50_000;  // Google's own nearby-search radius ceiling
const SCRAPER_VERSION = "map-oracle-ingest/v1";
const PLACES_BASE = "https://maps.googleapis.com/maps/api/place";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const clampInt = (v: unknown, min: number, max: number, dflt: number): number => {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.trunc(n)));
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bounded fetch with at most one retry on transient failure (network
 * error / 429 / 5xx). NO busy loop — a single short backoff, then give
 * up. Returns the parsed JSON or throws.
 */
async function fetchJson(url: string, label: string): Promise<any> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 429 || res.status >= 500) {
        if (attempt === 1) { await sleep(600); continue; }
        throw new Error(`${label}: HTTP ${res.status}`);
      }
      return await res.json();
    } catch (err) {
      if (attempt === 1) { await sleep(600); continue; }
      throw new Error(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  // ── Authenticate the caller and require the 'admin' role ──────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json(401, { error: "Unauthorized" });

  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json(401, { error: "Unauthorized" });

  const { data: isAdmin, error: roleErr } = await userClient.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  if (roleErr || isAdmin !== true) {
    return json(403, { error: "Forbidden — Map Oracle ingest is operator (admin) only." });
  }

  // ── Parse + clamp the controlled query (ONE area per call) ────────
  let body: any;
  try { body = await req.json(); } catch { return json(400, { error: "Invalid JSON body" }); }

  const city: string | undefined = typeof body.city === "string" ? body.city.trim() : undefined;
  const category: string | undefined = typeof body.category === "string" ? body.category.trim() : undefined;
  const lat = typeof body.lat === "number" ? body.lat : undefined;
  const lng = typeof body.lng === "number" ? body.lng : undefined;
  const radiusMeters = clampInt(body.radiusMeters, 1, MAX_RADIUS_M, 5_000);
  const limit = clampInt(body.limit, 1, MAX_PLACES, 20);              // total places to ingest
  const fetchDetails = body.fetchDetails === true;
  const maxDetails = clampInt(body.maxDetails, 0, limit, fetchDetails ? limit : 0);
  const dryRun = body.dryRun === true;
  const environment = typeof body.environment === "string" ? body.environment : "sandbox";

  if (!category) return json(400, { error: "Missing 'category' (e.g. 'cafe', 'real estate')" });

  // Reject obvious multi-area abuse: this endpoint does ONE area per call.
  if (Array.isArray(body.city) || Array.isArray(body.category)) {
    return json(400, { error: "One city/category per call. Multi-city scraping is intentionally not supported here." });
  }

  const useNearby = typeof lat === "number" && typeof lng === "number";
  if (!useNearby && !city) {
    return json(400, { error: "Provide either { lat, lng } (Nearby Search) or { city } (Text Search)." });
  }

  const queryParams = {
    mode: useNearby ? "nearby" : "text",
    city: city ?? null,
    lat: lat ?? null,
    lng: lng ?? null,
    category,
    radius_m: useNearby ? radiusMeters : null,
    limit,
    fetch_details: fetchDetails,
    max_details: maxDetails,
    environment,
    caps: { MAX_PLACES, MAX_PAGES, MAX_RADIUS_M },
  };

  // ── dryRun: validate + echo the plan; no Google call, no writes ───
  if (dryRun) {
    return json(200, {
      dryRun: true,
      plan: queryParams,
      estimatedApiCalls: {
        search: Math.min(MAX_PAGES, Math.ceil(limit / 20)),
        details: maxDetails,
        max: Math.min(MAX_PAGES, Math.ceil(limit / 20)) + maxDetails,
      },
      note: "No Google API call made, no rows written. Set dryRun=false to run.",
    });
  }

  // ── Require the API key only when actually running ────────────────
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!apiKey) {
    return json(400, {
      error: "Map Oracle ingest is not configured: GOOGLE_PLACES_API_KEY secret is not set.",
      code: "scraper_not_configured",
    });
  }

  // ── Open the run row ──────────────────────────────────────────────
  const initiatedBy = `manual:${user.email ?? user.id}`;
  const { data: run, error: runErr } = await supabaseAdmin
    .from("scrape_runs")
    .insert({ initiated_by: initiatedBy, scraper_version: SCRAPER_VERSION, query_params: queryParams, status: "running" })
    .select("id")
    .single();
  if (runErr || !run) return json(500, { error: "Failed to open scrape_runs row", detail: runErr?.message });
  const runId = run.id as string;

  let apiCalls = 0;
  let snapshotsWritten = 0;
  let detailsWritten = 0;
  const errors: string[] = [];

  try {
    // ── Search (bounded pagination) ─────────────────────────────────
    const searchSource = useNearby ? "google_places_nearby" : "google_places_text";
    const places: any[] = [];
    let pageToken: string | undefined;

    for (let page = 0; page < MAX_PAGES && places.length < limit; page++) {
      let url: string;
      if (pageToken) {
        // Google requires a short delay before a page token is valid.
        await sleep(2_000);
        url = `${PLACES_BASE}/${useNearby ? "nearbysearch" : "textsearch"}/json?pagetoken=${encodeURIComponent(pageToken)}&key=${apiKey}`;
      } else if (useNearby) {
        url = `${PLACES_BASE}/nearbysearch/json?location=${lat},${lng}&radius=${radiusMeters}&keyword=${encodeURIComponent(category)}&key=${apiKey}`;
      } else {
        url = `${PLACES_BASE}/textsearch/json?query=${encodeURIComponent(`${category} in ${city}`)}&key=${apiKey}`;
      }

      apiCalls++;
      const data = await fetchJson(url, `search page ${page + 1}`);
      const status: string = data.status ?? "UNKNOWN";
      if (status === "ZERO_RESULTS") break;
      if (status !== "OK") {
        // INVALID_REQUEST on a not-yet-ready page token, OVER_QUERY_LIMIT, etc.
        errors.push(`search page ${page + 1}: ${status}${data.error_message ? ` (${data.error_message})` : ""}`);
        // Do NOT retry-spin: stop paginating on a non-OK status.
        break;
      }
      for (const r of (data.results ?? [])) {
        if (places.length >= limit) break;
        places.push(r);
      }
      pageToken = typeof data.next_page_token === "string" ? data.next_page_token : undefined;
      if (!pageToken) break;
    }

    // ── Write the search snapshots ──────────────────────────────────
    for (const place of places) {
      const placeId = place.place_id;
      if (!placeId) { errors.push("search result without place_id — skipped"); continue; }
      const { error } = await supabaseAdmin.from("raw_scrape_snapshots").insert({
        scrape_run_id: runId,
        source: searchSource,
        source_place_id: placeId,
        query_context: { city: city ?? null, category, radius_m: useNearby ? radiusMeters : null },
        raw_payload: place,
      });
      if (error) errors.push(`snapshot ${placeId}: ${error.message}`);
      else snapshotsWritten++;
    }

    // ── Optional Place Details (capped, bounded) ────────────────────
    if (fetchDetails && maxDetails > 0) {
      const detailFields = "place_id,name,formatted_address,address_components,geometry,types,rating,user_ratings_total,business_status,formatted_phone_number,international_phone_number,website,opening_hours,editorial_summary";
      let done = 0;
      for (const place of places) {
        if (done >= maxDetails) break;
        const placeId = place.place_id;
        if (!placeId) continue;
        try {
          apiCalls++;
          const url = `${PLACES_BASE}/details/json?place_id=${encodeURIComponent(placeId)}&fields=${detailFields}&key=${apiKey}`;
          const data = await fetchJson(url, `details ${placeId}`);
          if (data.status !== "OK" || !data.result) {
            errors.push(`details ${placeId}: ${data.status ?? "no result"}`);
            done++;
            continue;
          }
          const { error } = await supabaseAdmin.from("raw_scrape_snapshots").insert({
            scrape_run_id: runId,
            source: "google_places_details",
            source_place_id: placeId,
            query_context: { city: city ?? null, category, enriched_from: searchSource },
            raw_payload: data.result,
          });
          if (error) errors.push(`details snapshot ${placeId}: ${error.message}`);
          else { detailsWritten++; snapshotsWritten++; }
        } catch (err) {
          errors.push(`details ${placeId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        done++;
      }
    }

    // ── Close the run ───────────────────────────────────────────────
    await supabaseAdmin
      .from("scrape_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        total_snapshots: snapshotsWritten,
        error: errors.length ? errors.slice(0, 25).join(" | ") : null,
      })
      .eq("id", runId);

    return json(200, {
      runId,
      status: "completed",
      placesFound: places.length,
      snapshotsWritten,
      detailsWritten,
      apiCalls,
      errors: errors.slice(0, 25),
      next: "The PR-B1 cron `frontiers3d-transform-snapshots` (process_unprocessed_snapshots) will normalize these snapshots into `properties`.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("scrape_runs")
      .update({ status: "failed", completed_at: new Date().toISOString(), total_snapshots: snapshotsWritten, error: [msg, ...errors].slice(0, 25).join(" | ") })
      .eq("id", runId);
    return json(500, { runId, status: "failed", error: msg, snapshotsWritten, apiCalls });
  }
});
