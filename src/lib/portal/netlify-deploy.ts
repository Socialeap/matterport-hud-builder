/**
 * Client-side helpers to deploy a presentation .zip to the user's own
 * Netlify account using their OAuth access token. We deliberately call
 * the Netlify REST API straight from the browser to avoid round-tripping
 * the (potentially large) zip through our server.
 *
 * Slug rules follow Netlify's site-name constraints:
 *   - lowercase letters, digits, hyphens
 *   - 1..63 chars
 *   - cannot start or end with a hyphen
 */
export const NETLIFY_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function slugifyForNetlify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function isValidNetlifySlug(slug: string): boolean {
  return NETLIFY_SLUG_REGEX.test(slug);
}

type ProgressFn = (label: string) => void;

interface DeployResult {
  liveUrl: string;
  adminUrl: string;
  siteName: string;
  /** True when the slug was already taken globally; we kept Netlify's auto name. */
  fellBackToAutoName: boolean;
}

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
  state: "uploaded" | "uploading" | "preparing" | "processing" | "ready" | "error" | string;
  error_message?: string;
  ssl_url?: string;
  url?: string;
}

/**
 * Create a brand-new Netlify site by uploading the zip, optionally rename
 * it to the requested slug, and poll until the deploy is live.
 */
export async function deployZipToNetlify(params: {
  blob: Blob;
  desiredSlug: string;
  accessToken: string;
  onProgress?: ProgressFn;
}): Promise<DeployResult> {
  const { blob, desiredSlug, accessToken, onProgress } = params;
  const progress = onProgress ?? (() => {});

  progress("Uploading to Netlify…");

  // Step 1: POST /sites with zip → creates site + first deploy in one shot.
  const createRes = await fetch("https://api.netlify.com/api/v1/sites", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/zip",
    },
    body: blob,
  });

  if (!createRes.ok) {
    const text = await safeText(createRes);
    throw new Error(`Netlify upload failed (${createRes.status}). ${text}`);
  }

  const site = (await createRes.json()) as NetlifySite;

  // Step 2: poll deploy until ready.
  progress("Finalizing deploy…");
  const deployId = site.deploy_id;
  if (deployId) {
    await pollDeployReady(site.id, deployId, accessToken);
  }

  // Step 3: rename to desired slug. If taken, keep the auto-generated name.
  let finalName = site.name;
  let fellBackToAutoName = false;

  if (desiredSlug && desiredSlug !== site.name) {
    progress("Setting your custom URL…");
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
        "[netlify] rename failed, keeping auto name",
        renameRes.status,
        await safeText(renameRes),
      );
    }
  }

  const liveUrl = `https://${finalName}.netlify.app`;
  const adminUrl = site.admin_url || `https://app.netlify.com/sites/${finalName}`;

  return { liveUrl, adminUrl, siteName: finalName, fellBackToAutoName };
}

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
  // Don't hard-fail — Netlify often serves the site already even if our
  // polling window expires; let the user open the URL and see.
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
