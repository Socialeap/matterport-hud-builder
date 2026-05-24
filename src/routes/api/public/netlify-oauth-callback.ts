import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const CANONICAL_NETLIFY_REDIRECT_URI =
  "https://matterport-hud-builder.lovable.app/api/public/netlify-oauth-callback";

function readNetlifySecret(name: "NETLIFY_OAUTH_CLIENT_ID" | "NETLIFY_OAUTH_CLIENT_SECRET"): string | null {
  const value = process.env[name]?.trim();
  if (!value || /\s/.test(value)) return null;
  return value;
}

/**
 * Netlify OAuth callback. Netlify redirects here with ?code=&state=.
 * We look up `state` in netlify_oauth_states (mapped to a user_id when
 * the user clicked Connect), exchange the code for an access token via
 * Netlify's token endpoint, persist the token to netlify_connections,
 * then return a tiny HTML page that postMessages back to the opener
 * window and closes.
 */
export const Route = createFileRoute("/api/public/netlify-oauth-callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const errorParam = url.searchParams.get("error");

        if (errorParam) {
          return renderResultHtml({
            ok: false,
            message: `Netlify sign-in was cancelled (${errorParam}).`,
          });
        }
        if (!code || !state) {
          return renderResultHtml({
            ok: false,
            message: "Missing authorization response from Netlify.",
          });
        }

        // Look up state → user
        const { data: stateRow, error: stateError } = await supabaseAdmin
          .from("netlify_oauth_states")
          .select("user_id, created_at")
          .eq("state", state)
          .maybeSingle();

        if (stateError || !stateRow) {
          return renderResultHtml({
            ok: false,
            message: "Your sign-in session expired. Please try again.",
          });
        }

        // One-shot: delete state immediately to prevent replay.
        await supabaseAdmin
          .from("netlify_oauth_states")
          .delete()
          .eq("state", state);

        const clientId = readNetlifySecret("NETLIFY_OAUTH_CLIENT_ID");
        const clientSecret = readNetlifySecret("NETLIFY_OAUTH_CLIENT_SECRET");
        if (!clientId || !clientSecret) {
          return renderResultHtml({
            ok: false,
            message: "Netlify integration is not configured correctly on the server.",
          });
        }

        const redirectUri = CANONICAL_NETLIFY_REDIRECT_URI;

        // Exchange code for token. Netlify accepts form-encoded body.
        let tokenJson:
          | { access_token?: string; token_type?: string; error?: string; error_description?: string }
          | null = null;
        try {
          const tokenRes = await fetch("https://api.netlify.com/oauth/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Accept: "application/json",
            },
            body: new URLSearchParams({
              grant_type: "authorization_code",
              code,
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
            }).toString(),
          });
          tokenJson = await tokenRes.json();
          if (!tokenRes.ok || !tokenJson?.access_token) {
            console.error("[netlify-oauth] token exchange failed", tokenJson);
            return renderResultHtml({
              ok: false,
              message:
                tokenJson?.error_description ||
                tokenJson?.error ||
                "Netlify token exchange failed.",
            });
          }
        } catch (err) {
          console.error("[netlify-oauth] token exchange error", err);
          return renderResultHtml({
            ok: false,
            message: "Network error contacting Netlify.",
          });
        }

        const accessToken = tokenJson.access_token!;

        // Fetch the Netlify user info so we can display "Connected as ...".
        let netlifyUserId: string | null = null;
        let netlifyEmail: string | null = null;
        let netlifyFullName: string | null = null;
        try {
          const userRes = await fetch("https://api.netlify.com/api/v1/user", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (userRes.ok) {
            const u = (await userRes.json()) as {
              id?: string;
              email?: string;
              full_name?: string;
            };
            netlifyUserId = u.id ?? null;
            netlifyEmail = u.email ?? null;
            netlifyFullName = u.full_name ?? null;
          }
        } catch (err) {
          console.warn("[netlify-oauth] user fetch failed", err);
        }

        const { error: upsertError } = await supabaseAdmin
          .from("netlify_connections")
          .upsert(
            {
              user_id: stateRow.user_id,
              access_token: accessToken,
              netlify_user_id: netlifyUserId,
              netlify_user_email: netlifyEmail,
              netlify_user_full_name: netlifyFullName,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          );

        if (upsertError) {
          console.error("[netlify-oauth] upsert failed", upsertError);
          return renderResultHtml({
            ok: false,
            message: "Could not save your Netlify connection.",
          });
        }

        return renderResultHtml({
          ok: true,
          message: `Connected as ${netlifyEmail || "your Netlify account"}.`,
          email: netlifyEmail,
        });
      },
    },
  },
});

function renderResultHtml(payload: {
  ok: boolean;
  message: string;
  email?: string | null;
}): Response {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const body = `<!doctype html>
<html><head><meta charset="utf-8"><title>${payload.ok ? "Connected" : "Sign-in failed"}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;background:#0b0d12;color:#e5e7eb;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}.card{max-width:420px}h1{font-size:18px;margin:0 0 8px}p{font-size:14px;color:#9ca3af;margin:0 0 16px}.ok{color:#34d399}.bad{color:#f87171}</style>
</head><body><div class="card"><h1 class="${payload.ok ? "ok" : "bad"}">${payload.ok ? "Netlify connected" : "Sign-in failed"}</h1><p>${escapeHtml(payload.message)}</p><p style="font-size:12px">You can close this window.</p></div>
<script>
(function(){
  var payload = ${json};
  try {
    if (window.opener) {
      window.opener.postMessage({ type: "netlify-oauth-result", payload: payload }, "*");
    }
  } catch (e) { console.warn(e); }
  setTimeout(function(){ try { window.close(); } catch(e){} }, 800);
})();
</script>
</body></html>`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
