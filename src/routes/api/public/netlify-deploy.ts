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
          console.error("[netlify-deploy] Netlify site response missing site id", site);
          return json({ error: "Netlify selected a site but did not return a site ID." }, 502);
        }

        // ---- 1b. If this site has an in-progress deploy, wait for it first ----
        // Prevents stacking duplicate deploys against Netlify's 3/minute limit.
        try {
          await waitForActiveDeployIdle(siteId, accessToken);
        } catch (err) {
          console.warn("[netlify-deploy] active deploy wait failed", err);
        }

        // ---- 2. Upload zip as a production deploy and wait for ready ----
        let deploy: NetlifyDeploy | null = null;
        try {
          const title = encodeURIComponent(`3DPS presentation publish: ${desiredSlug}`);
          const deployRes = await fetch(`${NETLIFY_API_BASE}/sites/${siteId}/deploys?production=true&title=${title}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/zip",
            },
            body: zipBlob,
          });
          if (!deployRes.ok) {
            const text = await safeText(deployRes);
            console.error(
              "[netlify-deploy] deploy upload failed",
              deployRes.status,
              text,
            );
            if (deployRes.status === 429) {
              const retryAfter = deployRes.headers.get("retry-after");
              return json(
                {
                  error:
                    "Netlify is rate-limiting deploys for this account (max ~3 per minute). " +
                    (retryAfter ? `Try again in ${retryAfter} seconds.` : "Wait a minute and try again."),
                  rateLimited: true,
                },
                429,
              );
            }
            return json(
              { error: `Netlify deploy upload failed (${deployRes.status}). ${text}` },
              502,
            );
          }

          const uploadedDeploy = (await deployRes.json()) as NetlifyDeploy;
          if (!uploadedDeploy.id) {
            console.error("[netlify-deploy] deploy response missing id", uploadedDeploy);
            return json({ error: "Netlify accepted the upload but did not return a deploy ID." }, 502);
          }
          deploy = uploadedDeploy.state === "ready"
            ? uploadedDeploy
            : await pollDeployReady(uploadedDeploy.id, accessToken);
        } catch (err) {
          console.error("[netlify-deploy] build/deploy error", err);
          return json(
            { error: err instanceof Error ? err.message : "Network error deploying to Netlify." },
            502,
          );
        }

        const finalName =
          nonEmpty(site.name) ||
          siteNameFromUrl(nonEmpty(site.ssl_url) || nonEmpty(site.url)) ||
          siteNameFromUrl(nonEmpty(deploy?.ssl_url) || nonEmpty(deploy?.url)) ||
          slugName(nonEmpty(deploy?.name));
        const liveUrl = pickLiveUrl(deploy, site, finalName);
        const adminUrl =
          nonEmpty(deploy?.admin_url) ||
          nonEmpty(site.admin_url) ||
          (finalName ? `https://app.netlify.com/sites/${finalName}` : "");

        if (!finalName || !liveUrl || liveUrl.includes("undefined")) {
          console.error("[netlify-deploy] missing final URL fields", { site, deploy, finalName, liveUrl });
          return json({ error: "Netlify deployed the upload but did not return a usable live URL." }, 502);
        }

        // ---- 3. STRICT live URL verification — block success on 429/non-200 ----
        const liveCheck = await verifyLiveUrl(liveUrl);
        if (!liveCheck.ok) {
          console.error("[netlify-deploy] live URL verification failed", {
            liveUrl,
            status: liveCheck.status,
            retryAfter: liveCheck.retryAfter,
          });
          if (liveCheck.status === 429) {
            return json(
              {
                error:
                  `Your presentation was uploaded to ${liveUrl}, but Netlify is currently rate-limiting that URL (HTTP 429). ` +
                  (liveCheck.retryAfter
                    ? `Wait ~${liveCheck.retryAfter} seconds and reload the URL.`
                    : "Wait a few minutes and reload the URL. Avoid republishing immediately — that will extend the rate limit."),
                rateLimited: true,
                liveUrl,
                adminUrl,
                siteName: finalName,
              },
              429,
            );
          }
          return json(
            {
              error:
                `Netlify finished the deploy but ${liveUrl} returned HTTP ${liveCheck.status || "?"}. ` +
                "The site may still be propagating — try reloading it in a minute. If it stays broken, open the Netlify admin URL to inspect the deploy log.",
              liveUrl,
              adminUrl,
              siteName: finalName,
            },
            502,
          );
        }

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

  for (let page = 1; page <= 10; page += 1) {
    const list = await fetch(`${NETLIFY_API_BASE}/sites?filter=all&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!list.ok) {
      console.warn("[netlify-deploy] site list lookup failed", list.status, await safeText(list));
      return null;
    }
    const sites = (await list.json()) as NetlifySite[];
    const match = sites.find((site) => site.name === name);
    if (match) return match;
    if (sites.length < 100) return null;
  }
  return null;
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
  if (bytes.length > 50 * 1024 * 1024) {
    throw new Error("Presentation package exceeds 50 MB. Remove large attachments and try again.");
  }

  // Real ZIP central-directory inspection via fflate so we can enforce
  // structure (root index.html, no Netlify config files, no traversal).
  const { unzipSync } = await import("fflate");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    throw new Error(`Presentation package is not a valid zip: ${err instanceof Error ? err.message : "decode failed"}.`);
  }
  const paths = Object.keys(entries);
  if (paths.length === 0) throw new Error("Presentation package is empty.");
  if (paths.length > 5000) {
    throw new Error("Presentation package contains too many files (>5000).");
  }
  if (!paths.includes("index.html")) {
    throw new Error("Presentation package is missing a root index.html. Files must be at the zip root, not inside a folder.");
  }
  const FORBIDDEN_ROOTS = new Set(["_headers", "_redirects", "netlify.toml"]);
  for (const p of paths) {
    if (p.includes("..") || p.startsWith("/") || p.includes("\\")) {
      throw new Error(`Presentation package contains an unsafe path: ${p}`);
    }
    if (FORBIDDEN_ROOTS.has(p)) {
      throw new Error(`Presentation package must not include Netlify config file: ${p}`);
    }
  }
  const copy = new Uint8Array(bytes);
  return new Blob([copy], { type: "application/zip" });
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
  const fromSite = nonEmpty(site.ssl_url) || nonEmpty(site.url);
  if (fromSite) return ensureHttps(fromSite);
  const fromDeploy = nonEmpty(deploy?.ssl_url) || nonEmpty(deploy?.url);
  if (fromDeploy) return ensureHttps(fromDeploy);
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

function slugName(value: string | null): string | null {
  return value && NETLIFY_SLUG_REGEX.test(value) ? value : null;
}

function ensureHttps(url: string): string {
  return url.replace(/^http:\/\//i, "https://").replace(/\/+$/, "");
}

/**
 * Strict live URL verification. Returns ok=true only on a real 2xx
 * response from the deployed Netlify site. Surfaces 429 (rate limit)
 * and other statuses to the caller so the UI can render a precise
 * error instead of claiming success on a broken URL.
 */
async function verifyLiveUrl(
  liveUrl: string,
  timeoutMs = 45_000,
): Promise<{ ok: boolean; status: number; retryAfter: string | null }> {
  const started = Date.now();
  let lastStatus = 0;
  let lastRetryAfter: string | null = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(liveUrl, { method: "GET", redirect: "follow" });
      lastStatus = res.status;
      lastRetryAfter = res.headers.get("retry-after");
      if (res.ok) return { ok: true, status: res.status, retryAfter: null };
      // Hard-fail fast on rate limit — retrying just makes it worse.
      if (res.status === 429) {
        return { ok: false, status: 429, retryAfter: lastRetryAfter };
      }
      // 5xx / 404 can occur briefly during Netlify edge propagation; keep polling.
    } catch {
      // Network blip during propagation — retry.
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { ok: false, status: lastStatus, retryAfter: lastRetryAfter };
}

/**
 * Wait briefly for any in-progress deploy on the site to finish before
 * we POST a new deploy. Prevents stacking duplicate deploys against
 * Netlify's ~3-per-minute limit when the user retries quickly.
 */
async function waitForActiveDeployIdle(
  siteId: string,
  accessToken: string,
  timeoutMs = 30_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await fetch(
      `${NETLIFY_API_BASE}/sites/${siteId}/deploys?per_page=1`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return;
    const list = (await res.json()) as NetlifyDeploy[];
    const latest = Array.isArray(list) && list.length > 0 ? list[0] : null;
    if (!latest) return;
    const state = String(latest.state || "").toLowerCase();
    const inFlight = new Set([
      "new",
      "pending_review",
      "accepted",
      "enqueued",
      "building",
      "uploading",
      "uploaded",
      "preparing",
      "prepared",
      "processing",
    ]);
    if (!inFlight.has(state)) return;
    await new Promise((r) => setTimeout(r, 2000));
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
