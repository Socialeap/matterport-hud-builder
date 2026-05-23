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

// ── GraphQL queries ───────────────────────────────────────────────────
// Schema confirmed via introspection against Matterport's public
// `my.matterport.com/api/mp/models/graph` endpoint:
//   Mattertag.fileAttachments     -> [FileAttachment]
//     FileAttachment { id filename mimeType downloadUrl ... }
//   Mattertag.externalAttachments -> [ExternalAttachment]
//     ExternalAttachment { id url thumbnailUrl mediaType category ... }
// Tags created with an uploaded image (the "Noire Restaurant /
// View Our Food Menu" style cards) put the image in fileAttachments
// with mimeType image/*. The legacy `media` string is empty for those.
// If a model's API version rejects the modern fields, we retry with
// the legacy query.
const MATTERPORT_GRAPHQL_QUERY = `query GetMattertags($modelId: ID!, $includeDisabled: Boolean!) {
  model(id: $modelId) {
    id
    mattertags(includeDisabled: $includeDisabled) {
      id
      label
      description
      media
      mediaType
      fileAttachments { id filename mimeType downloadUrl }
      externalAttachments { id url thumbnailUrl mediaType }
      anchorPosition { x y z }
    }
  }
}`;

const MATTERPORT_GRAPHQL_QUERY_LEGACY = `query GetMattertags($modelId: ID!, $includeDisabled: Boolean!) {
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
  /**
   * Matterport sweep id of the nearest sweep to anchorPosition. Set
   * when the sweeps GraphQL query succeeds; omitted otherwise so the
   * client falls back to the legacy `&tag=<id>` deep-link path.
   *
   * Purpose: emitting `&ss=<sweepId>` on Jump-to-view teleports the
   * camera WITHOUT triggering Matterport's native Mattertag dock,
   * which otherwise pops over our custom Property Features panel.
   */
  ss?: string;
}

// Try a handful of plausible field names for the sweeps collection on
// the Matterport `Model` type. Matterport's public graph has shipped
// `locations` historically; the iteration here makes us resilient if
// the field name shifts. The query intentionally requests only the
// minimum we need (id + position) so any schema mismatch fails fast
// and we degrade cleanly to "no ss, fall back to tag=".
const SWEEPS_QUERIES: ReadonlyArray<{ field: string; query: string }> = [
  {
    field: "locations",
    query: `query GetSweeps($modelId: ID!) {
      model(id: $modelId) { locations { id position { x y z } } }
    }`,
  },
  {
    field: "sweeps",
    query: `query GetSweeps($modelId: ID!) {
      model(id: $modelId) { sweeps { id position { x y z } } }
    }`,
  },
];

interface SweepPoint { id: string; x: number; y: number; z: number }


type FetchResult =
  | { kind: "ok"; tags: CleanMattertag[] }
  | { kind: "auth-failed" }
  | { kind: "not-found" }
  | { kind: "timeout" }
  | { kind: "network" }
  | { kind: "schema" }
  | { kind: "schema-mismatch" };

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

  // 3a. Schema fallback: this model's Matterport API version may not
  //     expose the modern `attachments`/`mediaType` fields. Retry once
  //     with the legacy field set so we still return tags.
  if (result.kind === "schema-mismatch") {
    console.warn(
      "[fetch-mattertags] extended query rejected; retrying legacy query",
    );
    result = await tryGraphQL(
      matterportId,
      MATTERPORT_APP_KEY,
      MATTERPORT_GRAPHQL_QUERY_LEGACY,
    );
  }

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
      if (result.kind === "schema-mismatch") {
        result = await tryGraphQL(
          matterportId,
          freshKey,
          MATTERPORT_GRAPHQL_QUERY_LEGACY,
        );
      }
    }
  }

  if (result.kind === "ok") {
    // Best-effort: enrich each tag with the id of its nearest sweep so
    // the runtime can deep-link via `&ss=` (no native Mattertag dock)
    // instead of `&tag=` (always pops the dock over our panel). If the
    // sweeps query fails for any reason, tags are returned unenriched
    // and the runtime falls back to the legacy tag-deep-link path.
    try {
      const sweeps = await fetchSweeps(matterportId, MATTERPORT_APP_KEY);
      if (sweeps.length > 0) {
        for (const tag of result.tags) {
          const ss = nearestSweepId(tag.anchorPosition, sweeps);
          if (ss) tag.ss = ss;
        }
      }
    } catch (err) {
      console.warn("[fetch-mattertags] sweep enrichment skipped:", err);
    }
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
  query: string = MATTERPORT_GRAPHQL_QUERY,
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
        query,
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
      // Schema validation error (e.g. this model's API rejects
      // `attachments` or `mediaType`). Signal a typed result so the
      // caller can retry with the legacy query.
      if (
        firstMsg.includes("cannot query field") ||
        firstMsg.includes("unknown field") ||
        firstMsg.includes("undefined field") ||
        firstMsg.includes("validation")
      ) {
        return { kind: "schema-mismatch" };
      }
      return { kind: "schema" };
    }

    const tags = sanitizeMattertags(payload, modelId);
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

function sanitizeMattertags(
  payload: unknown,
  modelId: string,
): CleanMattertag[] {
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
    let media = /^https?:\/\//i.test(mediaRaw) ? mediaRaw.slice(0, 2048) : "";

    // Modern tags store uploaded images under `fileAttachments`
    // (FileAttachment.downloadUrl) and linked photos/videos under
    // `externalAttachments` (ExternalAttachment.url/thumbnailUrl).
    // The `downloadUrl` returned here is a SHORT-LIVED signed CDN URL
    // (cdn-2.matterport.com/attachments/<id>/...?t=...) that expires
    // within ~24h. Storing it directly produces 410 Gone errors a day
    // later. Instead, store a stable proxy URL that re-resolves the
    // signed downloadUrl on demand via /api/mp-attachment.
    if (!media && Array.isArray(e.fileAttachments)) {
      for (const a of e.fileAttachments as Array<Record<string, unknown>>) {
        if (!a || typeof a !== "object") continue;
        const attachmentId = String(a.id ?? "").trim();
        const url = String(a.downloadUrl ?? "").trim();
        if (!/^[A-Za-z0-9]{16,64}$/.test(attachmentId)) continue;
        if (!/^https?:\/\//i.test(url)) continue;
        const mime = String(a.mimeType ?? "").toLowerCase();
        const filename = String(a.filename ?? "").toLowerCase();
        const looksImage =
          mime.startsWith("image/") ||
          /\.(jpe?g|png|gif|webp|avif)(\?|#|$)/i.test(url) ||
          /\.(jpe?g|png|gif|webp|avif)$/i.test(filename) ||
          /\/attachments\//i.test(url);
        if (looksImage) {
          media = `/api/mp-attachment?m=${encodeURIComponent(modelId)}&t=${encodeURIComponent(id)}&id=${encodeURIComponent(attachmentId)}`;
          break;
        }
      }
    }


    if (!media && Array.isArray(e.externalAttachments)) {
      for (const a of e.externalAttachments as Array<Record<string, unknown>>) {
        if (!a || typeof a !== "object") continue;
        const mt = String(a.mediaType ?? "").toUpperCase();
        const thumb = String(a.thumbnailUrl ?? "").trim();
        const link = String(a.url ?? "").trim();
        // PHOTO -> use the linked URL directly. VIDEO/RICH -> use the
        // thumbnail if present so the card still shows a preview image.
        const candidate =
          mt === "PHOTO" && /^https?:\/\//i.test(link)
            ? link
            : /^https?:\/\//i.test(thumb)
              ? thumb
              : "";
        if (candidate) {
          media = candidate.slice(0, 2048);
          break;
        }
      }
    }


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

// ── Sweep enrichment ────────────────────────────────────────────────
//
// Matterport's public `mattertags` field doesn't return any sweep
// association, so we issue a second GraphQL request asking for the
// model's sweep collection (id + 3D position) and compute the nearest
// one per tag via Euclidean distance to anchorPosition. The runtime
// uses that id in `&ss=<id>` to teleport WITHOUT opening the native
// Mattertag dock — the whole reason we're not just emitting `&tag=`.
//
// Iterates a few plausible field names because Matterport's schema
// has historically exposed sweeps under `locations` but may differ
// across model versions. Returns [] on any failure so the caller
// degrades silently.
async function fetchSweeps(
  modelId: string,
  appKey: string,
): Promise<SweepPoint[]> {
  for (const { field, query } of SWEEPS_QUERIES) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(MATTERPORT_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "x-matterport-application-key": appKey,
          "Origin": "https://my.matterport.com",
          "Referer": `https://my.matterport.com/show/?m=${modelId}`,
          "User-Agent": BROWSER_UA,
          "Accept-Language": "en-US,en;q=0.9",
        },
        body: JSON.stringify({ query, variables: { modelId } }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const payload = await res.json().catch(() => null) as
        | { data?: { model?: Record<string, unknown> }; errors?: unknown }
        | null;
      if (!payload || payload.errors) continue;
      const raw = payload.data?.model?.[field];
      if (!Array.isArray(raw)) continue;
      const out: SweepPoint[] = [];
      for (const entry of raw) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        const id = String(e.id ?? "").trim();
        const p = (e.position ?? {}) as Record<string, unknown>;
        if (!id) continue;
        const x = Number(p.x), y = Number(p.y), z = Number(p.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
        out.push({ id, x, y, z });
      }
      if (out.length > 0) return out;
    } catch (err) {
      clearTimeout(timer);
      console.warn(`[fetch-mattertags] sweeps query (${field}) failed:`, err);
    }
  }
  return [];
}

function nearestSweepId(
  tagPos: { x: number; y: number; z: number },
  sweeps: SweepPoint[],
): string | null {
  let best: SweepPoint | null = null;
  let bestDist = Infinity;
  for (const s of sweeps) {
    const dx = s.x - tagPos.x;
    const dy = s.y - tagPos.y;
    const dz = s.z - tagPos.z;
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best?.id ?? null;
}



function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
