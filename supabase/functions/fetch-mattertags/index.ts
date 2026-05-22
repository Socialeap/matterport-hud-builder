import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { checkRateLimit, ipFromRequest } from "../_shared/rate-limit.ts";

// CORS — defined locally because `npm:@supabase/supabase-js@2/cors` is
// not a real subpath. Headers list mirrors what supabase-js sends from
// the browser when it invokes an Edge Function; every name here must
// appear in the preflight allow list or Chrome blocks the actual POST.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ── Matterport endpoint + auth ────────────────────────────────────────
// Confirmed empirically by reverse-engineering the Matterport showcase
// JS bundle (`static.matterport.com/showcase/.../js/showcase.js`):
//
//   - Endpoint: my.matterport.com/api/mp/models/graph  (note `/api/mp/`)
//   - Auth: single `x-matterport-application-key` header
//
// The `MATTERPORT_APP_KEY` below is the SDK application key embedded
// in every public Matterport showcase page — the anonymous-viewer key
// Matterport's own SPA uses to serve millions of public tours. Not a
// paid SDK key. If Matterport ever rotates it, `scrapeApplicationKey`
// below self-heals by parsing it back out of the live show HTML.
const MATTERPORT_ENDPOINT =
  "https://my.matterport.com/api/mp/models/graph";
const MATTERPORT_APP_KEY = "h2f9mazn377g554gxkkay5aqd";

// ── GraphQL query ─────────────────────────────────────────────────────
// Minimal operation — only the fields persisted to MattertagData
// (src/components/portal/types.ts). The Matterport schema returns
// additional fields (color, enabled, stemEnabled, mediaType, etc.); we
// intentionally ignore them. `includeDisabled: false` matches what the
// SPA sends for default public viewing.
const MATTERPORT_GRAPHQL_QUERY = `query GetMattertags($modelId: ID!, $includeDisabled: Boolean!) {
  model(id: $modelId) {
    id
    mattertags(includeDisabled: $includeDisabled) {
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

// Chrome 124 desktop UA — plausible-browser fingerprint. Defensive only;
// Matterport's app-key path doesn't seem to care about UA.
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
  | { kind: "not-found" }
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
  //    outbound budget hammering Matterport.
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

  // 3. Primary: POST with the hardcoded application key.
  let result = await tryGraphQL(matterportId, MATTERPORT_APP_KEY);

  // 4. Self-heal: if Matterport ever rotates the SDK key, our hardcoded
  //    value will start returning 401/403. Re-scrape the current key
  //    from a live show page and retry once.
  if (result.kind === "auth-failed") {
    const freshKey = await scrapeApplicationKey(matterportId);
    if (freshKey && freshKey !== MATTERPORT_APP_KEY) {
      console.warn(
        "[fetch-mattertags] hardcoded app key rejected; retrying with scraped key",
      );
      result = await tryGraphQL(matterportId, freshKey);
    }
  }

  if (result.kind === "ok") {
    return json({ success: true, mattertags: result.tags });
  }
  if (result.kind === "auth-failed") {
    return json({
      success: false,
      error:
        "Matterport rejected the request. The model may be private or have anonymous viewing disabled.",
    });
  }
  if (result.kind === "not-found") {
    return json({
      success: false,
      error: "No Matterport model found with that ID.",
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
  modelId: string,
  appKey: string,
): Promise<FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(MATTERPORT_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "x-matterport-application-key": appKey,
        // Defensive: origin/referer/UA match what the real SPA sends.
        // Matterport's app-key auth doesn't appear to require them,
        // but sending them keeps us indistinguishable from a browser
        // if any anti-abuse layer is checking.
        "Origin": "https://my.matterport.com",
        "Referer": `https://my.matterport.com/show/?m=${modelId}`,
        "User-Agent": BROWSER_UA,
        "Accept-Language": "en-US,en;q=0.9",
      },
      body: JSON.stringify({
        query: MATTERPORT_GRAPHQL_QUERY,
        variables: { modelId, includeDisabled: false },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 401 || res.status === 403) return { kind: "auth-failed" };
    if (res.status === 404) return { kind: "not-found" };
    if (!res.ok) {
      console.error(
        `[fetch-mattertags] non-OK status from Matterport: ${res.status}`,
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

    // GraphQL surfaces 200 + errors[] for app-layer failures (private
    // model, no permission, etc.). Translate common cases to typed
    // results so the caller can produce useful copy.
    const errors = (payload as { errors?: Array<{ message?: string }> })
      ?.errors;
    if (Array.isArray(errors) && errors.length > 0) {
      const firstMsg = (errors[0]?.message ?? "").toLowerCase();
      console.warn("[fetch-mattertags] GraphQL errors:", errors);
      if (firstMsg.includes("not found") || firstMsg.includes("does not exist")) {
        return { kind: "not-found" };
      }
      if (
        firstMsg.includes("unauthorized") ||
        firstMsg.includes("forbidden") ||
        firstMsg.includes("permission")
      ) {
        return { kind: "auth-failed" };
      }
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

// Self-healing fallback: pull the live show page and extract the
// current applicationKey. The key lives inside a `parseJSON("...")`
// blob in the HTML, so the regex matches both escaped (\") and bare
// (") forms in case Matterport ever moves it.
async function scrapeApplicationKey(modelId: string): Promise<string | null> {
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
    const html = await res.text();
    const match = html.match(
      /\\?"applicationKey\\?"\s*:\s*\\?"([a-zA-Z0-9]{20,40})\\?"/,
    );
    return match?.[1] ?? null;
  } catch (err) {
    clearTimeout(timer);
    console.error("[fetch-mattertags] applicationKey scrape failed:", err);
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
