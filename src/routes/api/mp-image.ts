/**
 * Stateless 302 redirect proxy for Matterport image assets.
 *
 *   GET /api/mp-image?m={modelId}&id={assetId}
 *
 * Strategy:
 *   Redirect directly to Matterport's stable, token-free resource permalink:
 *     https://my.matterport.com/resources/model/{modelId}/image/{assetId}
 *
 *   This is the same URL pattern Matterport uses for embeddable video clips
 *   (/resources/model/{modelId}/clip/{assetId}). No signed CDN token is needed;
 *   Matterport handles access server-side for public models.
 *
 * Why this replaces the old manifest-scraping approach:
 *   The previous implementation fetched the Matterport viewer page and tried
 *   to extract signed cdn-2.matterport.com URLs. The viewer is a React SPA —
 *   its initial HTML response contains no CDN URLs. The scraper always returned
 *   empty results, so the proxy always served the 1×1 fallback PNG.
 *
 * Security:
 *   - Strict 11-char alphanumeric input validation (prevents path traversal)
 *   - URL is constructed deterministically from validated inputs — not from
 *     untrusted external data — so SSRF is not a concern
 *   - Simple in-memory rate limit per IP (60 req/min)
 *   - Returns 1×1 transparent PNG only on invalid input / rate-limit
 */
import { createFileRoute } from "@tanstack/react-router";

const MP_ID_RE = /^[A-Za-z0-9]{11}$/;
function isValidMatterportId(id: string): boolean {
  return MP_ID_RE.test(id);
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

// 1×1 transparent PNG — served on bad input so pages don't show broken-image icons.
const FALLBACK_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
  ),
  (c) => c.charCodeAt(0)
);

// In-memory rate limiter: 60 req/min/IP.
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

        if (!isValidMatterportId(modelId) || !isValidMatterportId(assetId)) {
          return new Response("Invalid id", {
            status: 400,
            headers: { "Content-Type": "text/plain", ...CORS_HEADERS },
          });
        }

        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        if (!rateLimitOk(ip)) {
          return fallbackImage();
        }

        // Redirect to Matterport's stable resource permalink.
        // The resource URL is constructed from validated 11-char alphanumeric
        // inputs — path traversal is impossible.
        const resourceUrl = `https://my.matterport.com/resources/model/${modelId}/image/${assetId}`;

        return new Response(null, {
          status: 302,
          headers: {
            Location: resourceUrl,
            // Resource URLs are stable (no expiring tokens) — cache aggressively.
            "Cache-Control": "public, max-age=3600",
            ...CORS_HEADERS,
          },
        });
      },
    },
  },
});
