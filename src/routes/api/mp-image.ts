/**
 * Stateless 302 redirect proxy for Matterport CDN assets.
 *
 *   GET /api/mp-image?m={modelId}&id={assetId}
 *
 * Strategy:
 *   1. Validate modelId + assetId (strict 11-char alphanumeric)
 *   2. Fetch (or cache-hit) the model's public viewer manifest
 *      to get a fresh signed cdn-2 URL for this assetId
 *   3. 302 redirect to the signed URL — browser fetches bytes directly
 *      from Matterport's CDN, no bandwidth cost to us
 *
 * Why this works:
 *   - <img> requests follow redirects natively, no CORS/CSP issues
 *   - Tokens stay fresh because we re-mint per request (cached 25 min)
 *   - Standalone HTML files just embed `<img src="https://3dps.../api/mp-image?...">`
 *     and never touch tokens or auth
 *
 * Security:
 *   - Strict input validation
 *   - Whitelist redirect host to cdn-2.matterport.com only
 *   - Simple in-memory rate limit per IP (60 req/min)
 *   - Returns 1×1 transparent PNG on lookup failure (graceful, not broken)
 */
import { createFileRoute } from "@tanstack/react-router";
import { getSignedAssetUrl, isValidMatterportId } from "@/lib/matterport-manifest";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

// 1×1 transparent PNG (67 bytes) — served when an asset can't be resolved
// so visitor pages don't show broken-image icons.
const FALLBACK_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
  ),
  (c) => c.charCodeAt(0)
);

// In-memory rate limiter: 60 req/min/IP. Resets on Worker restart.
const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 60 * 1000;
const ipBuckets = new Map<string, { count: number; windowStart: number }>();

function rateLimitOk(ip: string): boolean {
  const now = Date.now();
  const bucket = ipBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    ipBuckets.set(ip, { count: 1, windowStart: now });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT;
}

function fallbackImage(): Response {
  return new Response(FALLBACK_PNG, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=60",
      ...CORS_HEADERS,
    },
  });
}

export const Route = createFileRoute("/api/mp-image")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const modelId = url.searchParams.get("m") ?? "";
        const assetId = url.searchParams.get("id") ?? "";

        // Strict input validation
        if (!isValidMatterportId(modelId) || !isValidMatterportId(assetId)) {
          return new Response("Invalid id", {
            status: 400,
            headers: { "Content-Type": "text/plain", ...CORS_HEADERS },
          });
        }

        // Rate limit
        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        if (!rateLimitOk(ip)) {
          return new Response("Too many requests", {
            status: 429,
            headers: { "Content-Type": "text/plain", ...CORS_HEADERS },
          });
        }

        // Resolve signed URL (cached per model for ~25 min)
        let signedUrl: string | null;
        try {
          signedUrl = await getSignedAssetUrl(modelId, assetId);
        } catch (err) {
          console.error("[mp-image] resolve failed:", err);
          return fallbackImage();
        }

        if (!signedUrl) {
          // Asset truly not found in the manifest — graceful placeholder.
          return fallbackImage();
        }

        // Defense-in-depth: only ever redirect to the Matterport CDN.
        try {
          const target = new URL(signedUrl);
          if (target.hostname !== "cdn-2.matterport.com") {
            console.warn("[mp-image] blocked non-CDN redirect:", target.hostname);
            return fallbackImage();
          }
        } catch {
          return fallbackImage();
        }

        return new Response(null, {
          status: 302,
          headers: {
            Location: signedUrl,
            // Short browser cache so a fresh signed URL is fetched periodically.
            "Cache-Control": "private, max-age=300",
            ...CORS_HEADERS,
          },
        });
      },
    },
  },
});
