/**
 * Internal-only endpoint that geocodes an agent_beacon by id.
 *
 * Called fire-and-forget from supabase/functions/capture-beacon
 * after the row is inserted, so the form-submit response stays
 * fast and a slow Census call never holds the agent's request
 * open. Authentication is a shared secret in the
 * `x-internal-secret` header — capture-beacon and this route both
 * read it from `INTERNAL_GEOCODE_SECRET` env.
 *
 * On geocode failure (Census down, zero matches, malformed
 * response) we leave lat/lng NULL. The SQL matcher's ZIP and
 * trigram tiers cover the gap, so this is non-fatal.
 */
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { geocodeAddress } from "@/server/geocode.server";
import type { Database } from "@/integrations/supabase/types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-internal-secret",
} as const;

interface BeaconPayload {
  beaconId?: unknown;
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

export const Route = createFileRoute("/api/geocode-beacon")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        const secret = process.env.INTERNAL_GEOCODE_SECRET;
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

        if (!secret || !supabaseUrl || !supabaseServiceKey) {
          return json(500, { error: "Server configuration error" });
        }

        // Constant-time-ish header check. We don't have crypto.timingSafeEqual
        // in the Workers runtime here, but the secret is a long random string
        // and the comparison happens once per request, so a length-prefixed
        // equality check is fine for this threat model.
        const provided = request.headers.get("x-internal-secret") ?? "";
        if (provided.length !== secret.length || provided !== secret) {
          return json(401, { error: "Unauthorized" });
        }

        let payload: BeaconPayload;
        try {
          payload = await request.json();
        } catch {
          return json(400, { error: "Invalid JSON body" });
        }

        const beaconId =
          typeof payload.beaconId === "string" ? payload.beaconId.trim() : "";
        if (!/^[0-9a-f-]{36}$/i.test(beaconId)) {
          return json(400, { error: "Invalid beaconId" });
        }

        const supabase = createClient<Database>(supabaseUrl, supabaseServiceKey, {
          auth: {
            storage: undefined,
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        const { data: beaconRaw, error: fetchError } = await supabase
          .from("agent_beacons")
          .select("id, city, region, zip")
          .eq("id", beaconId)
          .maybeSingle();

        // The lat/lng/geocoded_at columns are introduced by the
        // 20260503180000_geospatial_matching migration but aren't in
        // the auto-generated Database types yet. Read them via a
        // separate untyped fetch to keep the typed select above.
        const { data: geoRaw } = await supabase
          .from("agent_beacons")
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .select("lat, lng" as any)
          .eq("id", beaconId)
          .maybeSingle<{ lat: number | null; lng: number | null }>();

        if (fetchError) {
          return json(500, { error: "Lookup failed" });
        }
        if (!beaconRaw) {
          return json(404, { error: "Beacon not found" });
        }
        if (!beaconRaw.city || !beaconRaw.region) {
          return json(200, { skipped: "missing_locality" });
        }
        if (geoRaw && geoRaw.lat !== null && geoRaw.lng !== null) {
          // Already geocoded — re-running is wasted work and costs
          // the Census API, so short-circuit. Re-geocoding on
          // city/zip changes can be added if PR2/PR3 needs it.
          return json(200, { skipped: "already_geocoded" });
        }

        const result = await geocodeAddress({
          city: beaconRaw.city,
          region: beaconRaw.region,
          zip: beaconRaw.zip,
        });

        if (!result) {
          // Stamp geocoded_at so we don't retry forever, but leave
          // lat/lng NULL so the matcher's fallback tiers fire.
          await supabase
            .from("agent_beacons")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update({ geocoded_at: new Date().toISOString() } as any)
            .eq("id", beaconId);
          return json(200, { matched: false });
        }

        const { error: updateError } = await supabase
          .from("agent_beacons")
          .update({
            lat: result.lat,
            lng: result.lng,
            geocoded_at: new Date().toISOString(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .eq("id", beaconId);

        if (updateError) {
          return json(500, { error: "Update failed" });
        }

        return json(200, { matched: true });
      },
    },
  },
});
