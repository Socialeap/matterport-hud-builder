import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/**
 * Server-side proxy for Netlify deploy. The browser uploads the
 * presentation zip here (same-origin, no CORS) and we forward it to
 * api.netlify.com with the user's stored OAuth token.
 *
 * Why this exists: api.netlify.com intermittently returns duplicate
 * `Access-Control-Allow-Origin: *, *` headers on cross-origin uploads,
 * which Chrome rejects. Proxying server-side sidesteps CORS entirely.
 */

interface NetlifySite {
  id: string;
  name: string;
  ssl_url?: string;
  url?: string;
  admin_url?: string;
  deploy_id?: string;
  state?: string;
}

interface NetlifyDeploy {
  id: string;
  state: string;
  error_message?: string;
}

export const Route = createFileRoute("/api/public/netlify-deploy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // ---- Auth: verify bearer token, resolve user_id ----
        const authHeader = request.headers.get("authorization") || "";
        const token = authHeader.startsWith("Bearer ")
          ? authHeader.slice("Bearer ".length).trim()
          : "";
        if (!token) {
          return json({ error: "Unauthorized" }, 401);
        }
        const { data: userData, error: userError } =
          await supabaseAdmin.auth.getUser(token);
        if (userError || !userData?.user) {
          return json({ error: "Unauthorized" }, 401);
        }
        const userId = userData.user.id;

        // ---- Look up the user's Netlify access token ----
        const { data: conn, error: connError } = await supabaseAdmin
          .from("netlify_connections")
          .select("access_token")
          .eq("user_id", userId)
          .maybeSingle();
        if (connError || !conn?.access_token) {
          return json(
            { error: "No Netlify connection. Please connect first." },
            400,
          );
        }
        const accessToken = conn.access_token as string;

        // ---- Parse multipart body (zip + desiredSlug) ----
        let form: FormData;
        try {
          form = await request.formData();
        } catch (err) {
          console.error("[netlify-deploy] formData parse failed", err);
          return json({ error: "Invalid upload body." }, 400);
        }
        const zipEntry = form.get("zip");
        const desiredSlugRaw = form.get("desiredSlug");
        if (!(zipEntry instanceof Blob)) {
          return json({ error: "Missing zip file." }, 400);
        }
        const desiredSlug =
          typeof desiredSlugRaw === "string" ? desiredSlugRaw.trim() : "";

        // ---- 1. Create site by uploading zip ----
        let site: NetlifySite;
        try {
          const createRes = await fetch(
            "https://api.netlify.com/api/v1/sites",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/zip",
              },
              body: zipEntry,
            },
          );
          if (!createRes.ok) {
            const text = await safeText(createRes);
            console.error(
              "[netlify-deploy] site create failed",
              createRes.status,
              text,
            );
            return json(
              { error: `Netlify upload failed (${createRes.status}). ${text}` },
              502,
            );
          }
          site = (await createRes.json()) as NetlifySite;
        } catch (err) {
          console.error("[netlify-deploy] site create error", err);
          return json({ error: "Network error contacting Netlify." }, 502);
        }

        // ---- 2. Poll deploy until ready (90s ceiling) ----
        if (site.deploy_id) {
          await pollDeployReady(site.id, site.deploy_id, accessToken).catch(
            (err) => {
              console.warn("[netlify-deploy] poll warning", err);
            },
          );
        }

        // ---- 3. Rename to desired slug (fall back to auto name) ----
        let finalName = site.name;
        let fellBackToAutoName = false;
        if (desiredSlug && desiredSlug !== site.name) {
          try {
            const renameRes = await fetch(
              `https://api.netlify.com/api/v1/sites/${site.id}`,
              {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ name: desiredSlug }),
              },
            );
            if (renameRes.ok) {
              const renamed = (await renameRes.json()) as NetlifySite;
              finalName = renamed.name;
            } else {
              fellBackToAutoName = true;
              console.warn(
                "[netlify-deploy] rename failed, keeping auto name",
                renameRes.status,
                await safeText(renameRes),
              );
            }
          } catch (err) {
            fellBackToAutoName = true;
            console.warn("[netlify-deploy] rename error", err);
          }
        }

        const liveUrl = `https://${finalName}.netlify.app`;
        const adminUrl =
          site.admin_url || `https://app.netlify.com/sites/${finalName}`;

        return json({
          liveUrl,
          adminUrl,
          siteName: finalName,
          fellBackToAutoName,
        });
      },
    },
  },
});

async function pollDeployReady(
  siteId: string,
  deployId: string,
  accessToken: string,
  timeoutMs = 90_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `https://api.netlify.com/api/v1/sites/${siteId}/deploys/${deployId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.ok) {
      const d = (await res.json()) as NetlifyDeploy;
      if (d.state === "ready") return;
      if (d.state === "error") {
        throw new Error(d.error_message || "Netlify deploy failed.");
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
