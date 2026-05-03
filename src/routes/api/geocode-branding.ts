/**
 * Geocodes the calling provider's branding_settings row.
 *
 * Called from /dashboard/branding after a save when primary_city
 * or region has changed. Authenticated via the user's Bearer
 * token; the user can only geocode their own row (RLS-equivalent
 * check via auth.uid()).
 *
 * On geocode failure we stamp `geocoded_at` and leave lat/lng
 * unchanged so the matcher's ZIP and trigram tiers continue
 * working.
 */
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { geocodeAddress } from "@/server/geocode.server";
import type { Database } from "@/integrations/supabase/types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
} as const;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

export const Route = createFileRoute("/api/geocode-branding")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),

      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const supabasePublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!supabaseUrl || !supabaseServiceKey || !supabasePublishable) {
          return json(500, { error: "Server configuration error" });
        }

        const authHeader = request.headers.get("authorization") ?? "";
        if (!authHeader.startsWith("Bearer ")) {
          return json(401, { error: "Unauthorized" });
        }
        const token = authHeader.slice("Bearer ".length).trim();
        if (!token) {
          return json(401, { error: "Unauthorized" });
        }

        // Verify the bearer token via the publishable-key client
        // (anon-equivalent). We don't use the resulting client for
        // writes — the service-role client below performs the row
        // update so we don't have to expose lat/lng to RLS.
        const userClient = createClient<Database>(
          supabaseUrl,
          supabasePublishable,
          {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: {
              storage: undefined,
              persistSession: false,
              autoRefreshToken: false,
            },
          },
        );
        const { data: claimsData, error: claimsError } =
          await userClient.auth.getClaims(token);
        if (claimsError || !claimsData?.claims?.sub) {
          return json(401, { error: "Unauthorized" });
        }
        const userId = claimsData.claims.sub;

        const admin = createClient<Database>(supabaseUrl, supabaseServiceKey, {
          auth: {
            storage: undefined,
            persistSession: false,
            autoRefreshToken: false,
          },
        });

        const { data: branding, error: fetchError } = await admin
          .from("branding_settings")
          .select("provider_id, primary_city, region, latitude, longitude")
          .eq("provider_id", userId)
          .maybeSingle();

        if (fetchError) {
          return json(500, { error: "Lookup failed" });
        }
        if (!branding) {
          return json(404, { error: "No branding row" });
        }
        if (!branding.primary_city || !branding.region) {
          return json(200, { skipped: "missing_locality" });
        }

        const result = await geocodeAddress({
          city: branding.primary_city,
          region: branding.region,
        });

        if (!result) {
          await admin
            .from("branding_settings")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update({ geocoded_at: new Date().toISOString() } as any)
            .eq("provider_id", userId);
          return json(200, { matched: false });
        }

        const { error: updateError } = await admin
          .from("branding_settings")
          .update({
            latitude: result.lat,
            longitude: result.lng,
            geocoded_at: new Date().toISOString(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .eq("provider_id", userId);

        if (updateError) {
          return json(500, { error: "Update failed" });
        }

        return json(200, { matched: true, lat: result.lat, lng: result.lng });
      },
    },
  },
});
