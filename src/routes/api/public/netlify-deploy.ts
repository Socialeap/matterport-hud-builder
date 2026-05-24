import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  NETLIFY_SLUG_REGEX,
  buildFallbackNetlifySlugs,
  isRecoverableNetlifyNameConflict,
} from "@/lib/portal/netlify-name";

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

interface SiteResolution {
  site: NetlifySite;
  usedFallbackName: boolean;
  reusedExistingSite: boolean;
}

interface CreateSiteOutcome {
  site: NetlifySite | null;
  conflict: boolean;
  status: number;
  text: string;
}

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

        // ---- 1. Resolve the Netlify site to deploy to ----
        // Publishing must be idempotent. A previous failed attempt can create
        // and reserve `desiredSlug` without a successful deploy, so always try
        // to reuse an owned site before creating a fresh one.
        let siteResolution: SiteResolution;
        try {
          siteResolution = await resolveSiteForPublish(accessToken, userId, desiredSlug);
        } catch (err) {
          console.error("[netlify-deploy] site create error", err);
          return json(
            { error: err instanceof Error ? err.message : "Network error creating the Netlify site." },
            502,
          );
        }
        const { site, usedFallbackName, reusedExistingSite } = siteResolution;

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

        const finalName =
          nonEmpty(deploy?.name) ||
          nonEmpty(site.name) ||
          siteNameFromUrl(nonEmpty(deploy?.ssl_url) || nonEmpty(deploy?.url) || nonEmpty(site.ssl_url) || nonEmpty(site.url));
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
          fellBackToAutoName: usedFallbackName,
          reusedExistingSite,
        });
      },
    },
  },
});

async function resolveSiteForPublish(
  accessToken: string,
  userId: string,
  desiredSlug: string,
): Promise<SiteResolution> {
  const existing = await getOwnedSiteByName(accessToken, desiredSlug);
  if (existing) {
    return { site: existing, usedFallbackName: false, reusedExistingSite: true };
  }

  const primary = await createNamedSite(accessToken, userId, desiredSlug);
  if (primary.site) {
    return { site: primary.site, usedFallbackName: false, reusedExistingSite: false };
  }
  if (!primary.conflict) {
    throw new Error(`Netlify site creation failed (${primary.status}). ${primary.text}`);
  }

  const ownedAfterConflict = await getOwnedSiteByName(accessToken, desiredSlug);
  if (ownedAfterConflict) {
    return { site: ownedAfterConflict, usedFallbackName: false, reusedExistingSite: true };
  }

  for (const fallbackSlug of buildFallbackNetlifySlugs(desiredSlug)) {
    const fallback = await createNamedSite(accessToken, userId, fallbackSlug);
    if (fallback.site) {
      return { site: fallback.site, usedFallbackName: true, reusedExistingSite: false };
    }
    if (!fallback.conflict) {
      console.warn("[netlify-deploy] fallback site create failed", fallbackSlug, fallback.status, fallback.text);
    }
  }

  const autoSite = await createAutoNamedSite(accessToken, userId);
  return { site: autoSite, usedFallbackName: true, reusedExistingSite: false };
}

async function getOwnedSiteByName(accessToken: string, name: string): Promise<NetlifySite | null> {
  const direct = await fetch(`${NETLIFY_API_BASE}/sites/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (direct.ok) return (await direct.json()) as NetlifySite;
  if (direct.status !== 404) {
    console.warn("[netlify-deploy] direct site lookup failed", direct.status, await safeText(direct));
  }

  const list = await fetch(`${NETLIFY_API_BASE}/sites?filter=all&per_page=100`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!list.ok) {
    console.warn("[netlify-deploy] site list lookup failed", list.status, await safeText(list));
    return null;
  }
  const sites = (await list.json()) as NetlifySite[];
  return sites.find((site) => site.name === name) ?? null;
}

async function createNamedSite(
  accessToken: string,
  userId: string,
  name: string,
): Promise<CreateSiteOutcome> {
  const res = await fetch(`${NETLIFY_API_BASE}/sites`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name, created_via: "3DPS Studio", session_id: userId }),
  });
  if (res.ok) {
    return { site: (await res.json()) as NetlifySite, conflict: false, status: res.status, text: "" };
  }
  const text = await safeText(res);
  return {
    site: null,
    conflict: isRecoverableNetlifyNameConflict(res.status, text),
    status: res.status,
    text,
  };
}

async function createAutoNamedSite(accessToken: string, userId: string): Promise<NetlifySite> {
  const res = await fetch(`${NETLIFY_API_BASE}/sites`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ created_via: "3DPS Studio", session_id: userId }),
  });
  if (!res.ok) {
    throw new Error(`Netlify site creation failed (${res.status}). ${await safeText(res)}`);
  }
  return (await res.json()) as NetlifySite;
}

async function pollDeployReady(
  deployId: string,
  accessToken: string,
  timeoutMs = 90_000,
): Promise<NetlifyDeploy> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `${NETLIFY_API_BASE}/deploys/${deployId}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.ok) {
      const d = (await res.json()) as NetlifyDeploy;
      if (d.state === "ready") return d;
      if (d.state === "error") {
        throw new Error(d.error_message || "Netlify deploy failed.");
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("Netlify deploy timed out before becoming ready.");
}

async function validatedZipBlob(blob: Blob): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length < 22) throw new Error("Presentation package is empty.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
    throw new Error("Presentation package must be a zip file.");
  }
  const textHead = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 200_000)));
  if (!textHead.includes("index.html")) {
    throw new Error("Presentation package is missing root index.html.");
  }
  const copy = new Uint8Array(bytes);
  return new Blob([copy], { type: "application/zip" });
}

function isLikelyNameConflict(status: number, text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    (status === 400 || status === 409 || status === 422) &&
    normalized.includes("name") &&
    (normalized.includes("taken") || normalized.includes("already") || normalized.includes("exist"))
  );
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed && trimmed !== "undefined" && trimmed !== "null" ? trimmed : null;
}

function pickLiveUrl(
  deploy: NetlifyDeploy | null,
  site: NetlifySite,
  finalName: string | null,
): string | null {
  const fromDeploy = nonEmpty(deploy?.ssl_url) || nonEmpty(deploy?.url);
  const fromSite = nonEmpty(site.ssl_url) || nonEmpty(site.url);
  if (fromDeploy) return ensureHttps(fromDeploy);
  if (fromSite) return ensureHttps(fromSite);
  return finalName ? `https://${finalName}.netlify.app` : null;
}

function siteNameFromUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const host = new URL(value).hostname;
    return host.endsWith(".netlify.app") ? host.replace(/\.netlify\.app$/, "") : null;
  } catch {
    return null;
  }
}

function ensureHttps(url: string): string {
  return url.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
}

async function waitForLiveIndex(liveUrl: string, timeoutMs = 45_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(liveUrl, { method: "GET" });
      if (res.ok) return;
    } catch {
      // Netlify propagation can briefly fail immediately after deploy ready.
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
