/**
 * Matterport asset manifest fetcher (server-only).
 *
 * Given a 11-char Matterport modelId, fetch the public viewer page
 * (`https://my.matterport.com/show/?m={modelId}`) and extract a map of
 * `{ assetId → freshSignedCdnUrl }` from the embedded JSON bundle.
 *
 * This is the linchpin of our image proxy: Matterport doesn't expose a
 * public "give me a signed URL" endpoint, but the viewer page itself
 * holds short-lived signed CDN URLs for every published asset on the
 * model. We re-parse on demand and cache the result for ~25 minutes
 * (tokens generally last ~1h, leaving a safety buffer).
 *
 * NEVER import this from client code.
 */
const MANIFEST_TTL_MS = 25 * 60 * 1000; // 25 min — tokens last ~1h

interface CachedManifest {
  byAssetId: Map<string, string>;  // assetId → signed URL
  fetchedAt: number;
}

const manifestCache = new Map<string, CachedManifest>();

/** Strict 11-char alphanumeric Matterport ID. */
const MP_ID_RE = /^[A-Za-z0-9]{11}$/;

export function isValidMatterportId(id: string): boolean {
  return MP_ID_RE.test(id);
}

/**
 * Fetch and parse the model's public viewer page, extracting all signed
 * cdn-2 URLs and indexing them by 11-char assetId where possible.
 */
async function fetchManifest(modelId: string): Promise<Map<string, string>> {
  const showUrl = `https://my.matterport.com/show/?m=${modelId}`;
  const res = await fetch(showUrl, {
    headers: {
      // Pretend to be a normal browser — Matterport sometimes serves
      // a stripped page to non-browser UAs.
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/121.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    // Avoid runtime caching at the fetch layer — we manage our own cache.
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Matterport viewer fetch failed: HTTP ${res.status}`);
  }

  const html = await res.text();
  const byAssetId = new Map<string, string>();

  // Find every signed cdn-2 URL in the page. We accept any path under
  // cdn-2.matterport.com; security check on the redirect side enforces host.
  // Regex captures URLs up to the first whitespace/quote/escape boundary.
  const urlRe = /https:\/\/cdn-2\.matterport\.com\/[^\s"'\\<>]+/g;
  const seen = new Set<string>();

  for (const match of html.matchAll(urlRe)) {
    let url = match[0];
    // Strip trailing JSON-escape artifacts (e.g. \u0026 → &, or trailing \).
    url = url.replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    if (seen.has(url)) continue;
    seen.add(url);

    // Try to find an 11-char assetId in the URL path. Common patterns:
    //   /apifs/models/{modelId}/images/{assetId}/...
    //   /models/{modelId}/assets/.../{assetId}-...
    //   .../{assetId}/Photo_NN.jpg
    // We index ALL 11-char path segments that aren't the modelId itself.
    const segments = url.match(/[A-Za-z0-9]{11}/g) ?? [];
    for (const seg of segments) {
      if (seg === modelId) continue;
      // First-write-wins: prefer earliest-found URL (typically the
      // largest/full-size version listed in the page state).
      if (!byAssetId.has(seg)) {
        byAssetId.set(seg, url);
      }
    }
  }

  return byAssetId;
}

/**
 * Get a fresh signed URL for {modelId, assetId}. Cached for ~25 min per model.
 * Returns null if the manifest doesn't contain that assetId.
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
    // If we have a stale cache, fall back to it rather than 500.
    if (cached) return cached.byAssetId.get(assetId) ?? null;
    return null;
  }
}
