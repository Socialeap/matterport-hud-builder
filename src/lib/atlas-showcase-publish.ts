/**
 * Atlas showcase publishing (server-only).
 *
 * Source of truth = the dedicated GitHub repo Socialeap/frontiers3d-atlas-showcases.
 * A single Netlify site is connected to that repo (CD): merging a PR deploys the
 * site, which serves one folder per curated presentation at
 * `https://<site>/<slug>/`. This module:
 *   1. commits a presentation folder (`<slug>/index.html` + `atlas-manifest.json`)
 *      to a fresh branch and opens a PR (via the GitHub API), and
 *   2. resolves the deployed URL from the Netlify site (via the Netlify API).
 *
 * Secrets (server-only env — never sent to the client):
 *   - ATLAS_SHOWCASES_GITHUB_TOKEN  (contents + pull-request write on the repo)
 *   - NETLIFY_ATLAS_DEPLOY_TOKEN    (Netlify API token)
 *   - NETLIFY_ATLAS_SITE_ID         (the one connected site's id)
 * If a token is absent the relevant call throws a clear "not configured" error;
 * nothing is hardcoded. Only the fixed api.github.com / api.netlify.com hosts are
 * fetched (no arbitrary/user URLs → no SSRF). Reached only via dynamic import in
 * server-fn handlers, so it stays out of the client bundle.
 */
import { buildShowcaseFiles, slugify, type CuratedPackageInput } from "./atlas-curation-server";

const GITHUB_API = "https://api.github.com";
const NETLIFY_API = "https://api.netlify.com/api/v1";
const SHOWCASES_REPO = "Socialeap/frontiers3d-atlas-showcases";
const FETCH_TIMEOUT_MS = 12000;

function env(name: string): string | null {
  const v = (process.env[name] ?? "").trim();
  return v.length > 0 ? v : null;
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── GitHub ───────────────────────────────────────────────────────────────────

async function gh<T = unknown>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await timedFetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "frontiers3d-atlas-curation",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string };
      detail = body?.message ? ` — ${body.message}` : "";
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`GitHub ${init.method ?? "GET"} ${path} failed (${res.status})${detail}`);
  }
  return (await res.json()) as T;
}

export interface PublishResult {
  prUrl: string;
  branch: string;
  slug: string;
}

/**
 * Commit the curated folder to a fresh branch and open a PR in the showcases repo.
 * Uses the git data API (blobs via tree `content`) so multiple files land in one
 * commit. Idempotent re-publishes update the same `<slug>/` folder.
 */
export async function publishShowcasePr(args: {
  input: CuratedPackageInput;
  slug?: string;
}): Promise<PublishResult> {
  const token = env("ATLAS_SHOWCASES_GITHUB_TOKEN");
  if (!token) {
    throw new Error(
      "Showcase publishing is not configured — set ATLAS_SHOWCASES_GITHUB_TOKEN (GitHub write token for the showcases repo).",
    );
  }
  const slug = (args.slug && args.slug.trim()) || slugify(args.input.title);
  const files = buildShowcaseFiles(args.input);

  // 1. Resolve the default branch + its tip commit.
  const repo = await gh<{ default_branch?: string }>(token, `/repos/${SHOWCASES_REPO}`);
  const base = repo.default_branch || "main";
  const ref = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${SHOWCASES_REPO}/git/ref/heads/${encodeURIComponent(base)}`,
  );
  const baseSha = ref.object.sha;

  // 2. Build a tree off the base with the folder's files.
  const tree = Object.entries(files).map(([name, content]) => ({
    path: `${slug}/${name}`,
    mode: "100644" as const,
    type: "blob" as const,
    content,
  }));
  const treeRes = await gh<{ sha: string }>(token, `/repos/${SHOWCASES_REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseSha, tree }),
  });

  // 3. Commit, branch, PR.
  const commit = await gh<{ sha: string }>(token, `/repos/${SHOWCASES_REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Curated showcase: ${slug}`,
      tree: treeRes.sha,
      parents: [baseSha],
    }),
  });
  const branch = `curate/${slug}-${Date.now().toString(36)}`;
  await gh(token, `/repos/${SHOWCASES_REPO}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
  });
  const pr = await gh<{ html_url: string }>(token, `/repos/${SHOWCASES_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: `Curated showcase: ${args.input.title} (${slug})`,
      head: branch,
      base,
      body:
        "Generated by the Frontiers3D Atlas Curation Assistant.\n\n" +
        `Folder: \`${slug}/\` — serves at \`/${slug}/\` once merged + deployed.\n` +
        "The Atlas listing remains inactive until an admin activates it.",
    }),
  });

  return { prUrl: pr.html_url, branch, slug };
}

// ── Netlify ──────────────────────────────────────────────────────────────────

/**
 * Resolve the live URL for a slug from the one connected Netlify site:
 * `https://<site-domain>/<slug>/`. Requires the Netlify token + site id.
 */
export async function resolveShowcaseUrl(slug: string): Promise<string> {
  const token = env("NETLIFY_ATLAS_DEPLOY_TOKEN");
  const siteId = env("NETLIFY_ATLAS_SITE_ID");
  if (!token || !siteId) {
    throw new Error(
      "Netlify URL resolution is not configured — set NETLIFY_ATLAS_DEPLOY_TOKEN + NETLIFY_ATLAS_SITE_ID, or paste the deployed URL manually.",
    );
  }
  const res = await timedFetch(`${NETLIFY_API}/sites/${encodeURIComponent(siteId)}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "frontiers3d-atlas-curation" },
  });
  if (!res.ok) {
    throw new Error(`Netlify site lookup failed (${res.status}). Check NETLIFY_ATLAS_SITE_ID / token.`);
  }
  const site = (await res.json()) as { ssl_url?: string; url?: string };
  const baseUrl = (site.ssl_url || site.url || "").replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://")) {
    throw new Error("Netlify site has no resolvable https URL.");
  }
  return `${baseUrl}/${slug}/`;
}
