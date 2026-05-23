/**
 * Stateless 302 redirect proxy for Matterport Mattertag file attachments.
 *
 *   GET /api/mp-attachment?m={modelId}&t={mattertagId}&id={attachmentId}
 *
 * Why this exists:
 *   Matterport's GraphQL returns `FileAttachment.downloadUrl` as a
 *   short-lived signed CDN URL (cdn-2.matterport.com/attachments/<id>/..?t=...)
 *   that expires within ~24h. Storing it directly in our DB produces
 *   HTTP 410 Gone errors a day later. Instead, the fetch-mattertags
 *   import stores a stable proxy URL pointing here, and this route
 *   re-queries the GraphQL endpoint on each request to obtain a freshly
 *   signed downloadUrl, then 302-redirects to it.
 *
 *   The pair (modelId, mattertagId, attachmentId) is the durable
 *   identifier — Matterport's FileAttachment.id matches the URL path
 *   slug and is stable across re-signs.
 *
 * Security:
 *   - Strict 11-char alphanumeric input validation for modelId/mattertagId
 *     (prevents path traversal, SSRF) and 16-64 char alphanumeric for
 *     attachmentId (matches Matterport's slug format)
 *   - Simple in-memory rate limit per IP (60 req/min)
 *   - Returns 1×1 transparent PNG only on invalid input / rate-limit /
 *     upstream failures so cards never show a broken-image icon
 */
import { createFileRoute } from "@tanstack/react-router";

const MP_ID_RE = /^[A-Za-z0-9]{11}$/;
const ATTACHMENT_ID_RE = /^[A-Za-z0-9]{16,64}$/;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
} as const;

// Same hardcoded SDK app key as the fetch-mattertags edge function —
// the anonymous-viewer key embedded in every public Matterport showcase.
const MATTERPORT_APP_KEY = "h2f9mazn377g554gxkkay5aqd";
const MATTERPORT_ENDPOINT = "https://my.matterport.com/api/mp/models/graph";
const FETCH_TIMEOUT_MS = 8_000;

const GRAPHQL_QUERY = `query GetAttachments($modelId: ID!) {
  model(id: $modelId) {
    mattertags(includeDisabled: false) {
      id
      fileAttachments { id downloadUrl }
    }
  }
}`;

// 1×1 transparent PNG fallback so cards never break.
const FALLBACK_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  ),
  (c) => c.charCodeAt(0),
);

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

async function resolveFreshUrl(
  modelId: string,
  mattertagId: string,
  attachmentId: string,
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MATTERPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-matterport-application-key": MATTERPORT_APP_KEY,
        Origin: "https://my.matterport.com",
        Referer: `https://my.matterport.com/show/?m=${modelId}`,
      },
      body: JSON.stringify({
        query: GRAPHQL_QUERY,
        variables: { modelId },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      data?: {
        model?: {
          mattertags?: Array<{
            id?: string;
            fileAttachments?: Array<{ id?: string; downloadUrl?: string }>;
          }>;
        };
      };
    };
    const tags = payload?.data?.model?.mattertags;
    if (!Array.isArray(tags)) return null;
    const tag = tags.find((t) => t?.id === mattertagId);
    if (!tag || !Array.isArray(tag.fileAttachments)) return null;
    const att = tag.fileAttachments.find((a) => a?.id === attachmentId);
    const url = String(att?.downloadUrl ?? "");
    return /^https?:\/\//i.test(url) ? url : null;
  } catch (err) {
    clearTimeout(timer);
    console.error("[mp-attachment] GraphQL fetch failed:", err);
    return null;
  }
}

export const Route = createFileRoute("/api/mp-attachment")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: CORS_HEADERS }),

      GET: async ({ request }) => {
        const url = new URL(request.url);
        const modelId = url.searchParams.get("m") ?? "";
        const mattertagId = url.searchParams.get("t") ?? "";
        const attachmentId = url.searchParams.get("id") ?? "";

        if (
          !MP_ID_RE.test(modelId) ||
          !MP_ID_RE.test(mattertagId) ||
          !ATTACHMENT_ID_RE.test(attachmentId)
        ) {
          return fallbackImage();
        }

        const ip =
          request.headers.get("cf-connecting-ip") ??
          request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
          "unknown";
        if (!rateLimitOk(ip)) {
          return fallbackImage();
        }

        const fresh = await resolveFreshUrl(modelId, mattertagId, attachmentId);
        if (!fresh) return fallbackImage();

        return new Response(null, {
          status: 302,
          headers: {
            Location: fresh,
            // Cache the 302 for 5 minutes — well under the ~24h token
            // expiry, but enough that scrolling the drawer doesn't
            // re-hit GraphQL every render.
            "Cache-Control": "public, max-age=300",
            ...CORS_HEADERS,
          },
        });
      },
    },
  },
});
