/**
 * Server endpoint for the public agent-feedback flow.
 *
 *   GET  /api/marketplace-feedback?token=...  → validate + render data
 *   POST /api/marketplace-feedback?token=...  → commit the flag (and
 *                                               apply the −0.5 score
 *                                               penalty)
 *
 * Why split GET and POST: email previewers (Outlook SafeLinks, Gmail
 * link-prefetch, anti-malware scanners) routinely fire GET on every
 * link in an email. If we applied the spam-flag penalty on GET, those
 * scanners would silently nuke a Pro's score. POST-on-confirm forces
 * a real human click on the confirmation button.
 */
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import type { Database } from "@/integrations/supabase/types";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });

const TOKEN_RE = /^[0-9a-f-]{36}$/i;

function getServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) return null;
  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export const Route = createFileRoute("/api/marketplace-feedback")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),

      GET: async ({ request }) => {
        const supabase = getServiceClient();
        if (!supabase) {
          return json(500, { error: "Server configuration error" });
        }

        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        if (!TOKEN_RE.test(token)) {
          return json(400, { error: "Invalid token" });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc(
          "lookup_outreach_by_token",
          { p_feedback_token: token },
        );

        if (error || !Array.isArray(data) || data.length === 0) {
          return json(404, { valid: false });
        }

        const row = data[0] as {
          brand_name: string | null;
          sent_at: string | null;
          already_flagged: boolean;
        };

        return json(200, {
          valid: true,
          brand: row.brand_name,
          sentAt: row.sent_at,
          alreadyFlagged: row.already_flagged,
        });
      },

      POST: async ({ request }) => {
        const supabase = getServiceClient();
        if (!supabase) {
          return json(500, { error: "Server configuration error" });
        }

        const url = new URL(request.url);
        let token = url.searchParams.get("token") ?? "";

        // Also accept the token in the JSON body so the client can
        // POST without putting it in a URL bar.
        if (!token) {
          try {
            const body = (await request.json()) as { token?: string };
            if (typeof body?.token === "string") token = body.token;
          } catch {
            // ignore — token from query is fine
          }
        }

        if (!TOKEN_RE.test(token)) {
          return json(400, { error: "Invalid token" });
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any).rpc(
          "apply_outreach_feedback",
          { p_feedback_token: token },
        );

        if (error) {
          return json(500, { error: "Could not record feedback" });
        }

        if (data !== true) {
          return json(404, { success: false, reason: "not_found" });
        }

        return json(200, { success: true });
      },
    },
  },
});
