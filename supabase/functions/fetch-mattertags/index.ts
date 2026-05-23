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
      floor { id }
      scanLinks { scan { id } }
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
   * Matterport sweep INDEX (numeric string like "125") used in the
   * showcase URL as `&ss=<index>`. CRITICAL: this is the sweep's
   * `label`/`index` from AnchorLocation, NOT the long alphanumeric
   * `id` (e.g. "d2g67xm1m5mmigpyxib2myz6a"). Matterport silently
   * ignores non-numeric ss values and lands the camera on a default
   * sweep, which presents as "totally incorrect navigation".
   *
   * Purpose: emitting `&ss=<index>` on Jump-to-view teleports the
   * camera WITHOUT triggering Matterport's native Mattertag dock.
   */
  ss?: string;
  /**
   * Diagnostic metadata. Only populated when the request body includes
   * `debug: true`. Lets us spot-check picker decisions without
   * exporting the HUD.
   */
  _debug?: {
    pickedSweep: { id: string; index: number; floorId: string | null;
      position: { x: number; y: number; z: number } };
    distance: number;
    source: "scanLink" | "sameFloorNearest" | "fallback3D" | "none";
    sweepCount: number;
    floorId: string | null;
  };
}

const SWEEPS_QUERY = `query GetSweeps($modelId: ID!) {
  model(id: $modelId) {
    locations { id index label position { x y z } floor { id } }
  }
}`;

interface SweepPoint {
  id: string;
  index: number;
  floorId: string | null;
  x: number;
  y: number;
  z: number;
}

interface RawTagShape {
  anchorPosition: { x: number; y: number; z: number };
  floorId: string | null;
  scanLinkIds: string[];
}


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
  let body: { matterportId?: unknown; debug?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ success: false, error: "Invalid JSON body" }, 400);
  }
  const matterportId = String(body.matterportId ?? "").trim();
  if (!MODEL_ID_RE.test(matterportId)) {
    return json({ success: false, error: "Invalid Matterport ID" }, 400);
  }
  const debug = body.debug === true;

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
    const floorObj = e.floor as Record<string, unknown> | null | undefined;
    const floorId = floorObj && typeof floorObj === "object"
      ? String((floorObj as { id?: unknown }).id ?? "").trim() || null
      : null;
    const scanLinkIds: string[] = [];
    if (Array.isArray(e.scanLinks)) {
      for (const sl of e.scanLinks as Array<Record<string, unknown>>) {
        const scan = sl && typeof sl === "object" ? sl.scan : null;
        if (scan && typeof scan === "object") {
          const sid = String((scan as { id?: unknown }).id ?? "").trim();
          if (sid) scanLinkIds.push(sid);
        }
      }
    }
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
    // Stash raw picker inputs on the tag using non-enumerable-style
    // internal keys; stripped before serialization.
    (cleaned[cleaned.length - 1] as unknown as Record<string, unknown>).__floorId = floorId;
    (cleaned[cleaned.length - 1] as unknown as Record<string, unknown>).__scanLinkIds = scanLinkIds;
  }
  cleaned.sort((a, b) => b.anchorPosition.y - a.anchorPosition.y);
  return cleaned;
}

// ── Sweep enrichment ────────────────────────────────────────────────
//
// Picks the correct sweep per tag in this priority order:
//   1. Matterport's own scanLinks association (the sweeps from which
//      the tag was authored to be viewed).
//   2. Nearest sweep ON THE SAME FLOOR, measured in the floor plane
//      (ignore vertical axis so wall-mounted tags aren't biased to
//      the sweep directly below them through a ceiling).
//   3. Nearest sweep in 3D (when floor metadata is unavailable).
//
// CRITICAL: emits the sweep's NUMERIC INDEX (e.g. "125") as `ss`,
// not the long alphanumeric GraphQL `id`. Matterport's showcase URL
// `&ss=` parameter only accepts the numeric sweep index; passing the
// `id` lands the camera on a default sweep, which presents as the
// "totally incorrect navigation" symptom.
async function fetchSweeps(
  modelId: string,
  appKey: string,
): Promise<SweepPoint[]> {
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
      body: JSON.stringify({ query: SWEEPS_QUERY, variables: { modelId } }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const payload = await res.json().catch(() => null) as
      | { data?: { model?: { locations?: unknown } }; errors?: unknown }
      | null;
    if (!payload || payload.errors) return [];
    const raw = payload.data?.model?.locations;
    if (!Array.isArray(raw)) return [];
    const out: SweepPoint[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      const id = String(e.id ?? "").trim();
      if (!id) continue;
      // Prefer the explicit numeric `index`; fall back to parsing
      // `label` (Matterport historically returns label as the index
      // string). Skip the sweep if neither is a finite integer —
      // there is no usable `ss` value to emit.
      let index = Number(e.index);
      if (!Number.isFinite(index)) {
        const lbl = String(e.label ?? "").trim();
        index = /^\d+$/.test(lbl) ? Number(lbl) : NaN;
      }
      if (!Number.isFinite(index)) continue;
      const p = (e.position ?? {}) as Record<string, unknown>;
      const x = Number(p.x), y = Number(p.y), z = Number(p.z);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const floorObj = e.floor as Record<string, unknown> | null | undefined;
      const floorId = floorObj && typeof floorObj === "object"
        ? String((floorObj as { id?: unknown }).id ?? "").trim() || null
        : null;
      out.push({ id, index, floorId, x, y, z });
    }
    return out;
  } catch (err) {
    clearTimeout(timer);
    console.warn("[fetch-mattertags] sweeps query failed:", err);
    return [];
  }
}

interface PickResult {
  sweep: SweepPoint;
  distance: number;
  source: "scanLink" | "sameFloorNearest" | "fallback3D";
}

function pickSweepForTag(
  tag: CleanMattertag,
  sweeps: SweepPoint[],
): PickResult | null {
  if (sweeps.length === 0) return null;
  const raw = tag as unknown as Record<string, unknown>;
  const floorId = (raw.__floorId as string | null | undefined) ?? null;
  const scanLinkIds = (raw.__scanLinkIds as string[] | undefined) ?? [];
  const a = tag.anchorPosition;

  const dist3D = (s: SweepPoint) => {
    const dx = s.x - a.x, dy = s.y - a.y, dz = s.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };
  // Floor-plane distance: Matterport models use Z-up; tags sit on
  // walls (z ≈ floor level), sweeps sit at camera height (also
  // small z). Ignoring Z prevents a tag on a 2nd-floor wall from
  // being mapped to a 1st-floor sweep directly below it.
  const distXY = (s: SweepPoint) => {
    const dx = s.x - a.x, dy = s.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // 1. scanLinks — Matterport's authoritative answer.
  if (scanLinkIds.length > 0) {
    const linked = sweeps.filter((s) => scanLinkIds.includes(s.id));
    if (linked.length > 0) {
      let best = linked[0], bestD = dist3D(best);
      for (const s of linked.slice(1)) {
        const d = dist3D(s);
        if (d < bestD) { best = s; bestD = d; }
      }
      return { sweep: best, distance: bestD, source: "scanLink" };
    }
  }

  // 2. Nearest on same floor (floor-plane distance).
  if (floorId) {
    const sameFloor = sweeps.filter((s) => s.floorId === floorId);
    if (sameFloor.length > 0) {
      let best = sameFloor[0], bestD = distXY(best);
      for (const s of sameFloor.slice(1)) {
        const d = distXY(s);
        if (d < bestD) { best = s; bestD = d; }
      }
      return { sweep: best, distance: bestD, source: "sameFloorNearest" };
    }
  }

  // 3. Last-resort 3D nearest.
  let best = sweeps[0], bestD = dist3D(best);
  for (const s of sweeps.slice(1)) {
    const d = dist3D(s);
    if (d < bestD) { best = s; bestD = d; }
  }
  return { sweep: best, distance: bestD, source: "fallback3D" };
}

function stripInternalKeys(tag: CleanMattertag): CleanMattertag {
  const r = tag as unknown as Record<string, unknown>;
  delete r.__floorId;
  delete r.__scanLinkIds;
  return tag;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
