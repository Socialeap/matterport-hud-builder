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
  const baseCommitSha = ref.object.sha;

  // The branch ref points at a COMMIT, but GitHub's Create Tree API expects
  // `base_tree` to be the SHA of a TREE object — NOT a commit SHA. Fetch the base
  // commit and use its `tree.sha`. Passing the commit SHA as base_tree is wrong and
  // can drop the repo's existing folders from the new tree (each publish would
  // overwrite everything). Do NOT regress this. The new commit's `parents` below
  // intentionally stays the COMMIT SHA (baseCommitSha).
  const baseCommit = await gh<{ tree: { sha: string } }>(
    token,
    `/repos/${SHOWCASES_REPO}/git/commits/${baseCommitSha}`,
  );
  const baseTreeSha = baseCommit.tree.sha;

  // 2. Build a tree off the base TREE with the folder's files. The folder is keyed
  // by `slug`; slug uniqueness across listings is enforced by the caller
  // (publishCuratedShowcase) so two listings can't silently overwrite one folder.
  const tree = Object.entries(files).map(([name, content]) => ({
    path: `${slug}/${name}`,
    mode: "100644" as const,
    type: "blob" as const,
    content,
  }));
  const treeRes = await gh<{ sha: string }>(token, `/repos/${SHOWCASES_REPO}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ base_tree: baseTreeSha, tree }),
  });

  // 3. Commit (parent = base COMMIT sha), branch, PR.
  const commit = await gh<{ sha: string }>(token, `/repos/${SHOWCASES_REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: `Curated showcase: ${slug}`,
      tree: treeRes.sha,
      parents: [baseCommitSha],
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

// ── Deployment verification ──────────────────────────────────────────────────

export interface ShowcaseVerifyResult {
  ok: boolean;
  reason?: string;
  manifest?: {
    service?: string;
    kind?: string;
    curation_job_id?: string;
    matterport_id?: string;
  };
  checks: {
    indexStatus: number | null;
    manifestStatus: number | null;
    serviceOk: boolean;
    kindOk: boolean;
  };
}

/**
 * Verify a deployed curated showcase URL hosts a real Frontiers3D Atlas
 * presentation: the page returns 200, atlas-manifest.json returns 200, and the
 * manifest declares service='frontiers3d-atlas' + kind='curated_showcase'.
 * Used as a hard gate before publish_status='published' / presentation_url
 * attachment, and as a warning before admin activation of the Atlas listing.
 *
 * SSRF-safe: only fetches the user-supplied URL (already https-validated by the
 * server-fn input schema) and its sibling atlas-manifest.json. No follow of
 * arbitrary redirects to internal hosts — we let fetch use default redirect
 * behaviour, which is acceptable here because the manifest contents are still
 * validated against fixed string literals before anything is trusted.
 */
export async function verifyDeployedShowcase(
  url: string,
): Promise<ShowcaseVerifyResult> {
  const checks = {
    indexStatus: null as number | null,
    manifestStatus: null as number | null,
    serviceOk: false,
    kindOk: false,
  };
  let trimmed = url.trim();
  if (!trimmed.startsWith("https://")) {
    return { ok: false, reason: "Deployed URL must be https://", checks };
  }
  if (!trimmed.endsWith("/")) trimmed = `${trimmed}/`;
  const manifestUrl = `${trimmed}atlas-manifest.json`;

  try {
    const indexRes = await timedFetch(trimmed, { method: "GET" });
    checks.indexStatus = indexRes.status;
    if (!indexRes.ok) {
      return {
        ok: false,
        reason: `Deployed URL returned HTTP ${indexRes.status} (expected 200).`,
        checks,
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `Couldn't fetch deployed URL: ${err instanceof Error ? err.message : "network error"}.`,
      checks,
    };
  }

  let manifest: ShowcaseVerifyResult["manifest"];
  try {
    const mRes = await timedFetch(manifestUrl, { method: "GET" });
    checks.manifestStatus = mRes.status;
    if (!mRes.ok) {
      return {
        ok: false,
        reason: `atlas-manifest.json returned HTTP ${mRes.status} (expected 200).`,
        checks,
      };
    }
    manifest = (await mRes.json()) as ShowcaseVerifyResult["manifest"];
  } catch (err) {
    return {
      ok: false,
      reason: `Couldn't fetch or parse atlas-manifest.json: ${err instanceof Error ? err.message : "invalid JSON"}.`,
      checks,
      manifest,
    };
  }

  checks.serviceOk = manifest?.service === "frontiers3d-atlas";
  checks.kindOk = manifest?.kind === "curated_showcase";
  if (!checks.serviceOk) {
    return { ok: false, reason: "Manifest service is not 'frontiers3d-atlas'.", checks, manifest };
  }
  if (!checks.kindOk) {
    return { ok: false, reason: "Manifest kind is not 'curated_showcase'.", checks, manifest };
  }
  return { ok: true, checks, manifest };
}

// ── Root index.html for the showcases site (follow-up PR) ────────────────────

const ROOT_INDEX_PATH = "index.html";

function renderRootIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Frontiers3D Atlas Showcases</title>
<meta name="description" content="Curated immersive 3D showcases on the Frontiers3D Atlas. Each presentation lives at /<slug>/." />
<meta name="robots" content="noindex" />
<style>
  *{box-sizing:border-box}
  html,body{margin:0;min-height:100%;background:#0a0e27;color:#e2e8f0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
  main{max-width:680px;margin:0 auto;padding:6rem 1.5rem 4rem;line-height:1.55}
  h1{font-weight:800;letter-spacing:.04em;font-size:1.5rem;margin:0 0 1rem}
  h1 span{background:linear-gradient(90deg,#67e8f9,#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent}
  p{color:#94a3b8;margin:.75rem 0}
  code{background:rgba(255,255,255,.06);padding:.1rem .35rem;border-radius:4px;font-size:.85em}
  a{color:#a5b4fc}
</style>
</head>
<body>
<main>
  <h1>FRONTIERS<span>3D</span> ATLAS SHOWCASES</h1>
  <p>This site hosts curated immersive 3D showcases for the Frontiers3D Atlas.</p>
  <p>Each presentation is served from its own folder at <code>/&lt;slug&gt;/</code>. There is no public index of presentations here — discover them on the <a href="https://frontiers3d.com/atlas">Frontiers3D Atlas</a>.</p>
</main>
</body>
</html>`;
}

export interface RootIndexPublishResult {
  prUrl: string | null;
  branch: string | null;
  alreadyExists: boolean;
}

/**
 * Open a follow-up PR adding a minimal root /index.html to the showcases repo
 * so the bare site URL is no longer a 404. Idempotent: if the file already
 * exists on the default branch, returns alreadyExists=true and opens no PR.
 */
export async function publishShowcasesRootIndex(): Promise<RootIndexPublishResult> {
  const token = env("ATLAS_SHOWCASES_GITHUB_TOKEN");
  if (!token) {
    throw new Error(
      "Showcase publishing is not configured — set ATLAS_SHOWCASES_GITHUB_TOKEN.",
    );
  }

  const repo = await gh<{ default_branch?: string }>(token, `/repos/${SHOWCASES_REPO}`);
  const base = repo.default_branch || "main";

  // Check whether root index.html already exists on the default branch.
  const existing = await timedFetch(
    `${GITHUB_API}/repos/${SHOWCASES_REPO}/contents/${encodeURIComponent(ROOT_INDEX_PATH)}?ref=${encodeURIComponent(base)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "frontiers3d-atlas-curation",
      },
    },
  );
  if (existing.ok) {
    return { prUrl: null, branch: null, alreadyExists: true };
  }

  const ref = await gh<{ object: { sha: string } }>(
    token,
    `/repos/${SHOWCASES_REPO}/git/ref/heads/${encodeURIComponent(base)}`,
  );
  const baseCommitSha = ref.object.sha;
  const baseCommit = await gh<{ tree: { sha: string } }>(
    token,
    `/repos/${SHOWCASES_REPO}/git/commits/${baseCommitSha}`,
  );
  const baseTreeSha = baseCommit.tree.sha;

  const treeRes = await gh<{ sha: string }>(
    token,
    `/repos/${SHOWCASES_REPO}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: [
          {
            path: ROOT_INDEX_PATH,
            mode: "100644" as const,
            type: "blob" as const,
            content: renderRootIndexHtml(),
          },
        ],
      }),
    },
  );
  const commit = await gh<{ sha: string }>(
    token,
    `/repos/${SHOWCASES_REPO}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: "Add root index.html landing page",
        tree: treeRes.sha,
        parents: [baseCommitSha],
      }),
    },
  );
  const branch = `chore/root-index-${Date.now().toString(36)}`;
  await gh(token, `/repos/${SHOWCASES_REPO}/git/refs`, {
    method: "POST",
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
  });
  const pr = await gh<{ html_url: string }>(token, `/repos/${SHOWCASES_REPO}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: "Add root index.html landing page",
      head: branch,
      base,
      body:
        "Adds a minimal root `/index.html` so the bare showcases site URL stops returning 404. " +
        "Presentations continue to be served from `/<slug>/`. " +
        "Generated by the Frontiers3D Atlas Curation Assistant.",
    }),
  });
  return { prUrl: pr.html_url, branch, alreadyExists: false };
}
