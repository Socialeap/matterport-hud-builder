/**
 * Matterport asset manifest fetcher (server-only).
 *
 * Given a 11-char Matterport modelId, resolve a fresh signed CDN URL for a
 * specific assetId so the `/api/mp-image` proxy can 302-redirect to it.
 *
 * WHY THE OLD APPROACH FAILED
 * ───────────────────────────
 * The previous implementation fetched the Matterport viewer page
 * (`https://my.matterport.com/show/?m={modelId}`) and regex-scanned the
 * HTML for `cdn-2.matterport.com` URLs.  Matterport's viewer is a React
 * SPA — its *initial* HTML response contains no CDN asset URLs at all; they
 * are loaded asynchronously by client-side JavaScript.  The scan therefore
 * always returned an empty map, and the proxy always fell back to the 1×1
 * transparent-PNG placeholder.
 *
 * NEW STRATEGY (three-tier cascade)
 * ──────────────────────────────────
 * 1. Try Matterport's public model-summary JSON API.
 *    `GET https://my.matterport.com/api/v2/models/{modelId}/?format=json`
 *    This returns structured JSON that often includes thumbnail/image URLs.
 *
 * 2. Try the viewer page but look specifically inside embedded JSON script
 *    tags (`<script type="application/json">`, `__NEXT_DATA__`, etc.) rather
 *    than raw HTML text.  Structured JSON blocks frequently carry CDN URLs
 *    that the plain-text scan missed because they were JSON-escaped.
 *
 * 3. As a last resort fall back to the raw-HTML scan of the viewer page
 *    (original behaviour) in case Matterport ever serves pre-rendered URLs.
 *
 * Results are cached per modelId for 25 min so that the most-common case
 * (repeated img requests for the same model) hits the cache, not the
 * upstream network.
 *
 * NEVER import this from client code.
 */

const MANIFEST_TTL_MS = 25 * 60 * 1000; // 25 min

interface CachedManifest {
  byAssetId: Map<string, string>; // assetId → signed CDN URL
  fetchedAt: number;
}

const manifestCache = new Map<string, CachedManifest>();

/** Strict 11-char alphanumeric Matterport ID. */
const MP_ID_RE = /^[A-Za-z0-9]{11}$/;

export function isValidMatterportId(id: string): boolean {
  return MP_ID_RE.test(id);
}

/** Shared browser-like request headers. */
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Accept: "application/json, text/html, */*",
} as const;

/**
 * Scan any string for `cdn-2.matterport.com` URLs and index them by any
 * 11-char alphanumeric path segment that isn't the modelId itself.
 * First-write-wins so the highest-quality URL (typically listed first) wins.
 */
function indexCdnUrls(
  source: string,
  modelId: string,
  out: Map<string, string>
): void {
  // JSON-escaped ampersands (\u0026) and slashes (\/) are common in embedded JSON.
  const normalised = source
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/\\"/g, '"');

  const urlRe = /https:\/\/cdn-2\.matterport\.com\/[^\s"'\\<>{}[\]]+/g;
  for (const match of normalised.matchAll(urlRe)) {
    const url = match[0];
    const segments = url.match(/[A-Za-z0-9]{11}/g) ?? [];
    for (const seg of segments) {
      if (seg === modelId) continue;
      if (!out.has(seg)) out.set(seg, url);
    }
  }
}

/**
 * Tier 1 — Matterport public model JSON API.
 *
 * Returns structured JSON for the model; walk every string value looking for
 * CDN URLs.  This is more reliable than HTML scraping because the JSON keys
 * can guide us to image/thumbnail data even when the SPA HTML is empty.
 */
async function tryModelApi(
  modelId: string,
  out: Map<string, string>
): Promise<void> {
  try {
    const res = await fetch(
      `https://my.matterport.com/api/v2/models/${modelId}/?format=json`,
      { headers: BROWSER_HEADERS, cache: "no-store" }
    );
    if (!res.ok) return;
    const text = await res.text();
    indexCdnUrls(text, modelId, out);
  } catch {
    // Non-fatal — fall through to tier 2
  }
}

/**
 * Tier 2 — Extract JSON from embedded script tags in the viewer HTML.
 *
 * Matterport's viewer page (Next.js) embeds initial page state as JSON inside
 * `<script id="__NEXT_DATA__">` and/or `<script type="application/json">`
 * tags.  These often contain thumbnail/image CDN URLs even when the raw HTML
 * body does not.
 */
async function tryViewerJsonBlocks(
  modelId: string,
  out: Map<string, string>
): Promise<string | null> {
  try {
    const res = await fetch(
      `https://my.matterport.com/show/?m=${modelId}`,
      { headers: BROWSER_HEADERS, cache: "no-store" }
    );
    if (!res.ok) return null;
    const html = await res.text();

    // Extract all <script> tag bodies — both application/json and any type.
    // The raw HTML scan (tier 3) also re-uses this HTML, so return it.
    const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
    for (const sm of html.matchAll(scriptRe)) {
      const body = sm[1];
      if (!body || !body.includes("cdn-2.matterport.com")) continue;
      indexCdnUrls(body, modelId, out);
    }

    return html; // hand back to tier 3 fallback
  } catch {
    return null;
  }
}

/**
 * Tier 3 — Raw HTML scan (original behaviour, kept as last resort).
 */
function tryRawHtmlScan(
  html: string,
  modelId: string,
  out: Map<string, string>
): void {
  indexCdnUrls(html, modelId, out);
}

/** Full three-tier manifest fetch for a modelId. */
async function fetchManifest(modelId: string): Promise<Map<string, string>> {
  const byAssetId = new Map<string, string>();

  // Run tier 1 (model API) and tier 2 (viewer HTML + script-block scan)
  // concurrently to minimise latency.
  const [, viewerHtml] = await Promise.all([
    tryModelApi(modelId, byAssetId),
    tryViewerJsonBlocks(modelId, byAssetId),
  ]);

  // Tier 3: if the viewer HTML was fetched and tier 1+2 found nothing, do the
  // raw scan as a last-resort (low signal-to-noise but occasionally useful).
  if (viewerHtml && byAssetId.size === 0) {
    tryRawHtmlScan(viewerHtml, modelId, byAssetId);
  }

  return byAssetId;
}

/**
 * Get a fresh signed URL for {modelId, assetId}. Cached ~25 min per model.
 * Returns null if no manifest source could resolve the assetId.
 */
export async function getSignedAssetUrl(
  modelId: string,
  assetId: string
): Promise<string | null> {
  if (!isValidMatterportId(modelId) || !isValidMatterportId(assetId)) {
    return null;
  }

  const now = Date.now();
  const cached = manifestCache.get(modelId);
  if (cached && now - cached.fetchedAt < MANIFEST_TTL_MS) {
    return cached.byAssetId.get(assetId) ?? null;
  }

  try {
    const byAssetId = await fetchManifest(modelId);
    manifestCache.set(modelId, { byAssetId, fetchedAt: now });
    return byAssetId.get(assetId) ?? null;
  } catch (err) {
    console.error(`[mp-manifest] failed for model ${modelId}:`, err);
    // Stale-cache fallback avoids hard 500s during transient network errors.
    if (cached) return cached.byAssetId.get(assetId) ?? null;
    return null;
  }
}
