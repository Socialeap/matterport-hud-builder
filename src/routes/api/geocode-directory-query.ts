/**
 * Public geocoder used by the MSP Directory search on /agents.
 *
 * The Directory search on the client needs to resolve a typed
 * "City, State" or ZIP into a lat/lng so the SQL function
 * `search_msp_directory` can test polygon containment and radius
 * coverage against each MSP's drawn service area. We can't call
 * Census directly from the browser (CORS, plus we want a single
 * place to apply rate limits), so this thin server route wraps
 * the existing `geocodeAddress()` helper.
 *
 * Trust model: same as the directory itself — anonymous, public,
 * read-only. We rate-limit by IP to discourage scraping.
 */
import { createFileRoute } from "@tanstack/react-router";
import { geocodeAddress } from "@/server/geocode.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

interface QueryPayload {
  city?: unknown;
  region?: unknown;
  zip?: unknown;
}

// Lightweight in-memory token bucket. Per-isolate, mirrors the
// pattern used by supabase/functions/_shared/rate-limit.ts but
// kept local so this route has zero coupling to Edge Functions.
const RATE_BUCKETS = new Map<string, { tokens: number; ts: number }>();
const RATE_CAPACITY = 30; // requests
const RATE_WINDOW_MS = 60_000; // per minute

function ipFromRequest(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  return first || request.headers.get("cf-connecting-ip") || "unknown";
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const refillPerMs = RATE_CAPACITY / RATE_WINDOW_MS;
  const b = RATE_BUCKETS.get(ip) ?? { tokens: RATE_CAPACITY, ts: now };
  const elapsed = Math.max(0, now - b.ts);
  b.tokens = Math.min(RATE_CAPACITY, b.tokens + elapsed * refillPerMs);
  b.ts = now;
  if (b.tokens < 1) {
    RATE_BUCKETS.set(ip, b);
    return false;
  }
  b.tokens -= 1;
  RATE_BUCKETS.set(ip, b);
  return true;
}

export const Route = createFileRoute("/api/geocode-directory-query")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        const ip = ipFromRequest(request);
        if (!checkRateLimit(ip)) {
          return json(429, { error: "Rate limited" });
        }

        let payload: QueryPayload;
        try {
          payload = (await request.json()) as QueryPayload;
        } catch {
          return json(400, { error: "Invalid JSON body" });
        }

        const city =
          typeof payload.city === "string" ? payload.city.trim() : "";
        const region =
          typeof payload.region === "string"
            ? payload.region.trim().toUpperCase()
            : "";
        const zip = typeof payload.zip === "string" ? payload.zip.trim() : "";

        // Census needs a state with a city. If no state was given we
        // can't reliably geocode "Bellmore" — return null and let the
        // SQL fallbacks (city trigram, ZIP array) handle it.
        const haveCity = city.length >= 2 && /^[A-Z]{2}$/.test(region);
        const haveZip = /^\d{5}(-\d{4})?$/.test(zip);
        if (!haveCity && !haveZip) {
          return json(200, { lat: null, lng: null });
        }

        const result = await geocodeAddress({
          city: haveCity ? city : "",
          region: haveCity ? region : "",
          zip: haveZip ? zip : null,
        });

        // ZIP-only geocoding via Census's oneline endpoint is unreliable
        // without a city. If the first attempt returned nothing and we
        // only had a ZIP, just return null — search_msp_directory will
        // fall back to ZIP-array matching.
        if (!result) {
          return json(200, { lat: null, lng: null });
        }

        return json(200, { lat: result.lat, lng: result.lng });
      },
    },
  },
});
