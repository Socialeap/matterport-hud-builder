import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { checkRateLimit, ipFromRequest } from "../_shared/rate-limit.ts";

// Defined locally rather than imported from a non-existent
// `npm:@supabase/supabase-js@2/cors` subpath. Headers list mirrors what
// the supabase-js client sends from the browser when it invokes an
// Edge Function — every name here must appear in the preflight allow
// list or Chrome blocks the actual POST.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Matterport endpoints ──────────────────────────────────────────────
// Primary: the host the Matterport SPA itself uses for tag queries.
// Validated against PR #89's deleted extractMattertags experiments —
// accepts requests with `Origin: my.matterport.com` past the Cloudflare
// WAF (returns 401 without viewer session, NOT 403).
const PRIMARY_ENDPOINT = "https://api.matterport.com/api/models/graph";
// Alternate, same-origin from the SPA's perspective. May have a more
// permissive auth path; tried last-ditch if PRIMARY auth fails.
const ALT_ENDPOINT = "https://my.matterport.com/api/graphql";

// ── GraphQL query ─────────────────────────────────────────────────────
// PLACEHOLDER — verify against Chrome DevTools by reproducing the
// network call the Matterport SPA makes when it loads tags. If the
// exact operation name or field shape differs, drop the sniffed query
// here. Field names below mirror what PR #89's deleted server function
// expected; if Matterport renames anything, sanitizeMattertags() below
// silently degrades to an empty array rather than throwing.
const MATTERPORT_GRAPHQL_QUERY = `query GetMattertags($modelId: ID!) {
  model(id: $modelId) {
    id
    mattertags {
      id
      label
      description
      media
      anchorPosition { x y z }
    }
  }
}`;

const MODEL_ID_RE = /^[A-Za-z0-9]{11}$/;
const MAX_COUNT = 200;
const FETCH_TIMEOUT_MS = 12_000;

// Chrome 124 desktop UA — closer to a real browser than PR #89's bot UA.
// Matterport's WAF appears to gate on Origin/Referer, not TLS fingerprint
// or UA, but we use a plausible UA anyway to minimise heuristic flags.
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

interface CleanMattertag {
  id: string;
  label: string;
  description: string;
  media: string;
  anchorPosition: { x: number; y: number; z: number };
}

type FetchResult =
  | { kind: "ok"; tags: CleanMattertag[] }
  | { kind: "auth-failed" }
  | { kind: "timeout" }
  | { kind: "network" }
  | { kind: "schema" };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ success: false, error: "Method not allowed" }, 405);
  }

  // 1. Parse + validate input.
  let body: { matterportId?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }
  const matterportId = String(body.matterportId ?? "").trim();
  if (!MODEL_ID_RE.test(matterportId)) {
    return json({ success: false, error: "Invalid Matterport ID" }, 400);
  }

  // 2. Per-IP rate limit so a single abusive caller can't burn our
  //    outbound traffic budget hammering Matterport.
  const rl = checkRateLimit(ipFromRequest(req), { perMinute: 10 });
  if (!rl.allowed) {
    return json(
      {
        success: false,
        error: "Too many requests. Please wait a moment before importing again.",
        retryAfterSeconds: rl.retryAfterSeconds,
      },
      429,
    );
  }

  // 3. Strategy A: simple header-spoof against PRIMARY_ENDPOINT.
  //    Origin + Referer alone may be enough if Matterport's auth is
  //    purely Origin-gated.
  let result = await tryGraphQL(PRIMARY_ENDPOINT, matterportId, null);

  // 4. Strategy B: GET show page → scrape session token → retry with
  //    captured auth. Only runs when A explicitly returned 401/403.
  if (result.kind === "auth-failed") {
    const auth = await scrapeViewerAuth(matterportId);
    if (auth) {
      result = await tryGraphQL(PRIMARY_ENDPOINT, matterportId, auth);
    }
  }

  // 5. Last-ditch: alternate endpoint with simple spoof (no scraped
  //    auth — the alt endpoint may rely on different mechanisms).
  if (result.kind !== "ok") {
    const altResult = await tryGraphQL(ALT_ENDPOINT, matterportId, null);
    if (altResult.kind === "ok") result = altResult;
  }

  if (result.kind === "ok") {
    return json({ success: true, mattertags: result.tags });
  }
  if (result.kind === "auth-failed") {
    return json({
      success: false,
      error:
        "Couldn't authenticate with Matterport. The model may be private or have anonymous viewing disabled.",
    });
  }
  return json({
    success: false,
    error:
      result.kind === "timeout"
        ? "Matterport took too long to respond. Please try again."
        : result.kind === "schema"
          ? "Matterport returned an unexpected response. The integration may need updating."
          : "Could not reach Matterport. Please try again.",
  });
});

// ── Helpers ──────────────────────────────────────────────────────────

async function tryGraphQL(
  endpoint: string,
  modelId: string,
  auth: { cookie?: string; bearer?: string } | null,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Origin": "https://my.matterport.com",
      "Referer": `https://my.matterport.com/show/?m=${modelId}`,
      "User-Agent": BROWSER_UA,
      "Accept-Language": "en-US,en;q=0.9",
    };
    if (auth?.cookie) headers["Cookie"] = auth.cookie;
    if (auth?.bearer) headers["Authorization"] = `Bearer ${auth.bearer}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: MATTERPORT_GRAPHQL_QUERY,
        variables: { modelId },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) return { kind: "auth-failed" };
    if (!res.ok) {
      console.error(
        `[fetch-mattertags] non-OK status from ${endpoint}: ${res.status}`,
      );
      return { kind: "network" };
    }

    let payload: unknown;
    try {
      payload = await res.json();
    } catch (err) {
      console.error("[fetch-mattertags] JSON parse failed:", err);
      return { kind: "schema" };
    }
    const tags = sanitizeMattertags(payload);
    return { kind: "ok", tags };
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      return { kind: "timeout" };
    }
    console.error("[fetch-mattertags] fetch failed:", err);
    return { kind: "network" };
  }
}

// Anonymous-viewer session emulator: hit the public show page like a
// browser would, then collect any auth material the SPA's initial load
// reveals (Set-Cookie + tokens embedded in `<script>` blobs). Returns
// null if neither produced anything usable — the caller's last-ditch
// path takes over.
async function scrapeViewerAuth(
  modelId: string,
): Promise<{ cookie?: string; bearer?: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://my.matterport.com/show/?m=${modelId}`, {
      method: "GET",
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!res.ok) return null;

    // Deno joins multiple Set-Cookie headers with a comma — split on
    // ",<name>=" pairs to recover individual cookies, drop the
    // attribute tail (path=, expires=, etc.) on each, then re-join with
    // "; " for a normal Cookie header.
    const setCookies = res.headers.get("set-cookie");
    const cookie = setCookies
      ? setCookies
          .split(/,(?=\s*[A-Za-z0-9_-]+=)/)
          .map((c) => c.split(";")[0].trim())
          .filter((c) => c.includes("="))
          .join("; ")
      : undefined;

    const html = await res.text();
    // Token patterns the Matterport SPA has historically embedded in
    // its initial HTML. Loose matches so small shape changes don't
    // break us. Order is best-known-first.
    const bearer =
      html.match(/"viewerToken"\s*:\s*"([^"\s]{20,1000})"/)?.[1] ||
      html.match(/"authToken"\s*:\s*"([^"\s]{20,1000})"/)?.[1] ||
      html.match(/"accessToken"\s*:\s*"([^"\s]{20,1000})"/)?.[1] ||
      html.match(/"jwt"\s*:\s*"([^"\s]{20,1000})"/)?.[1] ||
      html.match(/Authorization\s*=\s*Bearer\s+([A-Za-z0-9._\-]{20,1000})/)?.[1];

    if (!cookie && !bearer) return null;
    return { cookie, bearer };
  } catch (err) {
    clearTimeout(timer);
    console.error("[fetch-mattertags] scrape failed:", err);
    return null;
  }
}

function sanitizeMattertags(payload: unknown): CleanMattertag[] {
  const root = payload as { data?: { model?: { mattertags?: unknown } } } | null;
  const rawTags = root?.data?.model?.mattertags;
  if (!Array.isArray(rawTags)) return [];

  const cleaned: CleanMattertag[] = [];
  for (const entry of rawTags.slice(0, MAX_COUNT)) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = String(e.id ?? "").slice(0, 64).trim();
    if (!id) continue;
    const mediaRaw = String(e.media ?? "").trim();
    const media = /^https?:\/\//i.test(mediaRaw) ? mediaRaw.slice(0, 2048) : "";
    const ap = (e.anchorPosition ?? {}) as Record<string, unknown>;
    cleaned.push({
      id,
      label: String(e.label ?? "").slice(0, 200),
      description: String(e.description ?? "").slice(0, 4000),
      media,
      anchorPosition: {
        x: Number(ap.x) || 0,
        y: Number(ap.y) || 0,
        z: Number(ap.z) || 0,
      },
    });
  }
  cleaned.sort((a, b) => b.anchorPosition.y - a.anchorPosition.y);
  return cleaned;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
