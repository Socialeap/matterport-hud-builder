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
  site_id?: string;
  ssl_url?: string;
  url?: string;
  admin_url?: string;
  state?: string;
}

interface NetlifyBuild {
  id: string;
  deploy_id?: string;
  done?: boolean;
  error?: string;
}

interface NetlifyDeploy {
  id: string;
  state: string;
  name?: string;
  url?: string;
  ssl_url?: string;
  admin_url?: string;
  error_message?: string;
}

const NETLIFY_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const NETLIFY_API_BASE = "https://api.netlify.com/api/v1";

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
        if (!NETLIFY_SLUG_REGEX.test(desiredSlug)) {
          return json(
            { error: "Choose a valid Netlify URL using lowercase letters, numbers, and hyphens." },
            400,
          );
        }

        let zipBlob: Blob;
        try {
          zipBlob = await validatedZipBlob(zipEntry);
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : "Invalid zip file." },
            400,
          );
        }

        // ---- 1. Create the Netlify site ----
        // Netlify's API does NOT deploy bytes via POST /sites. That endpoint
        // only creates an empty site. The zip must be uploaded afterwards to
        // /sites/:id/builds as multipart/form-data. Returning a live URL before
        // that build is ready produces the exact empty-site 404 the user saw.
        let site: NetlifySite;
        let fellBackToAutoName = false;
        try {
          const createRes = await fetch(
            `${NETLIFY_API_BASE}/sites`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                name: desiredSlug,
                created_via: "3DPS Studio",
                session_id: userId,
              }),
            },
          );
          if (!createRes.ok) {
            const text = await safeText(createRes);
            if (isLikelyNameConflict(createRes.status, text)) {
              fellBackToAutoName = true;
              site = await createAutoNamedSite(accessToken, userId);
            } else {
              console.error(
                "[netlify-deploy] site create failed",
                createRes.status,
                text,
              );
              return json(
                { error: `Netlify site creation failed (${createRes.status}). ${text}` },
                502,
              );
            }
          } else {
            site = (await createRes.json()) as NetlifySite;
          }
        } catch (err) {
          console.error("[netlify-deploy] site create error", err);
          return json({ error: "Network error creating the Netlify site." }, 502);
        }

        const siteId = site.id || site.site_id;
        if (!siteId) {
          console.error("[netlify-deploy] Netlify create response missing site id", site);
          return json({ error: "Netlify created a site but did not return a site ID." }, 502);
        }

        // ---- 2. Upload zip as a production build and wait for ready ----
        let deploy: NetlifyDeploy | null = null;
        try {
          const buildForm = new FormData();
          buildForm.append("title", `3DPS presentation publish: ${desiredSlug}`);
          buildForm.append("zip", zipBlob, "presentation.zip");
          const buildRes = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}/builds`, {
            method: "POST",
            headers: { Authorization: `Bearer ${accessToken}` },
            body: buildForm,
          });
          if (!buildRes.ok) {
            const text = await safeText(buildRes);
            console.error(
              "[netlify-deploy] build upload failed",
              buildRes.status,
              text,
            );
            return json(
              { error: `Netlify deploy upload failed (${buildRes.status}). ${text}` },
              502,
            );
          }

          const build = (await buildRes.json()) as NetlifyBuild;
          if (build.error) {
            return json({ error: `Netlify deploy failed: ${build.error}` }, 502);
          }
          if (!build.deploy_id) {
            console.error("[netlify-deploy] build response missing deploy_id", build);
            return json({ error: "Netlify accepted the upload but did not return a deploy ID." }, 502);
          }
          deploy = await pollDeployReady(build.deploy_id, accessToken);
        } catch (err) {
          console.error("[netlify-deploy] build/deploy error", err);
          return json(
            { error: err instanceof Error ? err.message : "Network error deploying to Netlify." },
            502,
          );
        }

        const finalName = nonEmpty(deploy?.name) || nonEmpty(site.name);
        const liveUrl = pickLiveUrl(deploy, site, finalName);
        const adminUrl =
          nonEmpty(deploy?.admin_url) ||
          nonEmpty(site.admin_url) ||
          (finalName ? `https://app.netlify.com/sites/${finalName}` : "");

        if (!finalName || !liveUrl || liveUrl.includes("undefined")) {
          console.error("[netlify-deploy] missing final URL fields", { site, deploy, finalName, liveUrl });
          return json({ error: "Netlify deployed the upload but did not return a usable live URL." }, 502);
        }

        await waitForLiveIndex(liveUrl).catch((err) => {
          console.warn("[netlify-deploy] live URL readiness warning", err);
        });

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
