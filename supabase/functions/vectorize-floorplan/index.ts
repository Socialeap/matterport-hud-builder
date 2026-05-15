// vectorize-floorplan
// ───────────────────
// Given { storage_path } pointing to a raster floor-plan image
// previously uploaded to the `temporary-floorplans` bucket by the
// authenticated user:
//   1. Verify the caller's JWT and confirm they own the file
//      (path prefix === auth.uid()).
//   2. Verify a matching ephemeral_assets row exists for that user.
//   3. Download the raster from storage via the service-role client.
//   4. Resolve the Gemini API key:
//        a. If the user has an active key in client_byok_keys, decrypt
//           and use it (BYOK — skip quota).
//        b. Otherwise check profiles.floor_plan_free_passes_used. If
//           below the lifetime cap (3), use the platform master key
//           (Deno.env GEMINI_API_KEY). If saturated, return 402.
//   5. Ask Gemini 2.5 Pro Vision to identify wall segments in the
//      image and return them as structured JSON (x1, y1, x2, y2 line
//      endpoints, normalized 0-1000). This skips the image-out + trace
//      detour entirely — Gemini commits to specific coordinates that
//      we render directly as SVG lines.
//   6. Validate the JSON, compose the SVG from the structured wall
//      coordinates, sanitize as defense in depth.
//   7. On AI failure (network, malformed output, wall count outside
//      [MIN, MAX] after one retry with a stronger prompt), return the
//      original raster as a JPEG fallback so the Builder remains
//      usable — pins still work over the raster.
//   8. On success without BYOK, atomically increment the user's
//      lifetime pass counter via consume_floor_plan_pass RPC.
//   9. Return { ok, svg | raster, viewBox, width, height, mode,
//      pipeline, wall_count, bytes, quota } to the client.
//
// The original raster is left in place — `pg_cron` purges it 30 days
// after upload (see migration 20260514130000_ephemeral_floorplan_assets.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { decode as decodeImage, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

import {
  checkUploadSize,
  uploadKindForMime,
} from "../_shared/upload-limits.ts";
import { checkRateLimit, ipFromRequest } from "../_shared/rate-limit.ts";
import { decryptKey } from "../_shared/byok-crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  storage_path: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Stage =
  | "auth"
  | "input"
  | "ownership"
  | "tracking"
  | "download"
  | "decode"
  | "size_limit"
  | "byok"
  | "quota"
  | "trace"
  | "rate_limit";

function fail(
  stage: Stage,
  detail: string,
  status: number,
  diagnostics: Record<string, unknown> = {},
) {
  return jsonResponse(
    { ok: false, stage, detail, error: detail, diagnostics },
    status,
  );
}

// ── Tunable constants ─────────────────────────────────────────────

/** Cap on the longest source dimension we send to Gemini. Keeps the
 *  request payload small and inference fast. */
const MAX_DIMENSION = 1536;
/** Discoverable build marker — bump whenever the pipeline changes so
 *  operators can verify in DevTools (network response → JSON; or
 *  view-source the rendered SVG → data-pipeline attribute) which
 *  version is actually deployed. ai-v2 = structured-output Vision
 *  approach; ai-v1 was the image-out + tracer pipeline (which never
 *  produced clean enough walls). */
const PIPELINE_VERSION = "ai-v2";
/** Lifetime free-pass cap for non-BYOK users. Must match the default
 *  in the consume_floor_plan_pass RPC. */
const LIFETIME_PASS_LIMIT = 3;
/** Vision-capable text model. Native support for inlineData image
 *  parts + structured JSON output via responseSchema. Overridable via
 *  env so a successor model can be swapped in without redeploying. */
const GEMINI_MODEL =
  Deno.env.get("GEMINI_FLOORPLAN_MODEL") ?? "gemini-2.5-pro";
/** Hard timeout on the Gemini call. Vision + structured output is
 *  noticeably faster than image-out — usually under 10s — so 30s is
 *  generous and still well under the 60s edge ceiling. */
const GEMINI_TIMEOUT_MS = 30_000;
/** Wall-count quality gates. Below the lower bound the model
 *  under-detected and we retry; above the upper bound it returned
 *  noise and we retry. Beyond two attempts we fall back to raster. */
const MIN_WALL_COUNT = 4;
const MAX_WALL_COUNT = 250;

const WALL_EXTRACTION_PROMPT = `You are a senior architect analyzing a top-down dollhouse view of a building.

Your task: identify ONLY the architectural WALL SEGMENTS visible in this image and return them as straight-line endpoints.

Coordinate system:
- (0, 0) is the top-left corner of the image.
- (1000, 1000) is the bottom-right corner.
- x increases rightward, y increases downward.
- All coordinates must be integers in [0, 1000].

INCLUDE:
- Exterior walls (the building's outer perimeter).
- Interior walls that separate rooms.
- Wall segments that frame doorways and openings — treat the doorway gap itself as MISSING wall (stop one segment before it, start the next segment after).

EXCLUDE entirely:
- Furniture (tables, chairs, sofas, beds, desks, shelves).
- Rugs, carpets, floor patterns, tile lines, hardwood seams.
- Plants, decorations, artwork on walls.
- Lighting fixtures, shadows, gradients.
- People.
- Anything that isn't a structural wall.

Quality rules:
- Each wall is a single straight line. Combine collinear pixels into one segment — don't emit multiple tiny fragments along the same wall.
- Endpoint snapping: corners should share exact coordinates. A horizontal wall has y1 === y2; a vertical wall has x1 === x2.
- Reject zero-length and near-collinear duplicates.
- A typical floor plan has 15-50 wall segments. If you find fewer than 8 you've under-detected.

Return ONLY valid JSON matching the schema. No commentary, no markdown fences.`;

const WALL_RETRY_SUFFIX = `

NOTE: The previous attempt produced too few or too many segments. Walls are MAJOR straight architectural lines, not fragments. Combine collinear segments. Ignore anything that isn't a load-bearing or partition wall.`;

const WALL_SCHEMA = {
  type: "object",
  properties: {
    walls: {
      type: "array",
      items: {
        type: "object",
        properties: {
          x1: { type: "number" },
          y1: { type: "number" },
          x2: { type: "number" },
          y2: { type: "number" },
        },
        required: ["x1", "y1", "x2", "y2"],
      },
    },
  },
  required: ["walls"],
};

interface Wall { x1: number; y1: number; x2: number; y2: number; }

// ── SVG composition ──────────────────────────────────────────────
//
// With structured wall coordinates we skip pixel tracing entirely —
// each wall renders as a single <line>. Coordinates come in as 0-1000
// normalized and get scaled to the source image dims so the viewBox
// matches the image (which keeps pin coordinates anchored across
// re-vectorizations and matches the runtime's aspect-ratio container).
function buildWallsSvg(width: number, height: number, walls: Wall[]): string {
  const sx = (n: number) => ((n / 1000) * width).toFixed(1);
  const sy = (n: number) => ((n / 1000) * height).toFixed(1);
  // Stroke width proportional to the smaller dimension so it reads
  // similarly at any image resolution. 0.5% gives ~3px at 600px,
  // ~7.5px at 1500px which both render as a visible architectural
  // line in the modal.
  const stroke = Math.max(2, Math.round(Math.min(width, height) * 0.005));
  const lines = walls
    .map((w) =>
      `<line x1="${sx(w.x1)}" y1="${sy(w.y1)}" x2="${sx(w.x2)}" y2="${sy(w.y2)}"/>`
    )
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="xMidYMid meet" data-pipeline="${PIPELINE_VERSION}" ` +
    `data-mode="ai-vector" fill="none" stroke="currentColor" ` +
    `stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">` +
    lines +
    `</svg>`
  );
}

// ── SVG sanitization (defense in depth) ──────────────────────────
//
// We generate every byte ourselves so there's no real XSS vector,
// but the sanitizer is here as a backstop per the spec. If a future
// refactor ever lets untrusted data into the path string this remains
// the last line of defense.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "");
}

// ── BYOK ciphertext helpers (mirrors synthesize-answer) ──────────
//
// The Postgres bytea column can come back as a Uint8Array, a
// `\xHEX` string, or a base64 string depending on supabase-js's
// internal format flag for the request. Handle all three so a
// transport upgrade doesn't silently break decryption.
function bytesFromBytea(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") {
    const s = value;
    if (s.startsWith("\\x") || s.startsWith("\\\\x")) {
      const hex = s.startsWith("\\\\x") ? s.slice(3) : s.slice(2);
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    }
    try {
      const bin = atob(s);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch {
      throw new Error("bytesFromBytea: unrecognized string encoding");
    }
  }
  throw new Error("bytesFromBytea: unsupported value type");
}

// ── API key resolution ───────────────────────────────────────────
//
// Preference order: caller's own active Gemini key (BYOK, bypasses
// quota) → platform master key gated by the lifetime pass counter
// → hard fail. The quota state is read but NOT incremented here —
// the increment happens only after a successful SVG is produced,
// so a Gemini failure doesn't waste the user's pass.
interface KeyResolution {
  apiKey: string;
  byok: boolean;
  quotaUsed: number;
}

class QuotaExhausted extends Error {
  used: number;
  limit: number;
  constructor(used: number, limit: number) {
    super("floor_map_quota_exhausted");
    this.used = used;
    this.limit = limit;
  }
}

type ServiceClient = ReturnType<typeof createClient>;

async function resolveApiKey(
  service: ServiceClient,
  userId: string,
): Promise<KeyResolution> {
  const { data: byokRow } = await service
    .from("client_byok_keys")
    .select("ciphertext, iv, active")
    .eq("client_id", userId)
    .eq("vendor", "gemini")
    .maybeSingle();

  if (byokRow && byokRow.active) {
    const cipherBytes = bytesFromBytea(byokRow.ciphertext);
    const ivBytes = bytesFromBytea(byokRow.iv);
    const plaintext = await decryptKey(cipherBytes, ivBytes);
    return { apiKey: plaintext, byok: true, quotaUsed: 0 };
  }

  // No BYOK — check the lifetime free-pass counter.
  const { data: profileRow } = await service
    .from("profiles")
    .select("floor_plan_free_passes_used")
    .eq("user_id", userId)
    .maybeSingle();
  const used = profileRow?.floor_plan_free_passes_used ?? 0;
  if (used >= LIFETIME_PASS_LIMIT) {
    throw new QuotaExhausted(used, LIFETIME_PASS_LIMIT);
  }

  const masterKey = Deno.env.get("GEMINI_API_KEY");
  if (!masterKey) {
    throw new Error("gemini_master_key_missing");
  }
  return { apiKey: masterKey, byok: false, quotaUsed: used };
}

// ── Gemini vision + structured output call ───────────────────────
//
// POSTs the source PNG (as inlineData) plus the wall-extraction
// prompt + a strict JSON response schema to gemini-2.5-pro and
// returns the parsed wall list. Throws on timeout, non-200, missing
// text part, invalid JSON, or schema mismatch. The caller's
// retry/fallback policy handles all of those uniformly.
async function callGeminiVision(
  apiKey: string,
  srcImg: Image,
  retry: boolean,
): Promise<Wall[]> {
  const srcBytes = await srcImg.encode();
  const srcB64 = uint8ToBase64(srcBytes);

  const promptText = retry
    ? WALL_EXTRACTION_PROMPT + WALL_RETRY_SUFFIX
    : WALL_EXTRACTION_PROMPT;

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: "image/png", data: srcB64 } },
              { text: promptText },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: WALL_SCHEMA,
          temperature: 0.0,
        },
      }),
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`gemini_http_${resp.status}:${errBody.slice(0, 200)}`);
  }

  const body = await resp.json() as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = body.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || typeof text !== "string") {
    throw new Error("gemini_no_text_part");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("gemini_invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || !("walls" in parsed)) {
    throw new Error("gemini_missing_walls");
  }
  const wallsRaw = (parsed as { walls: unknown }).walls;
  if (!Array.isArray(wallsRaw)) {
    throw new Error("gemini_walls_not_array");
  }

  // Strict validation: each wall must have four finite numeric
  // coordinates in [0, 1000], and reject zero-length segments
  // (where the endpoints are within 1 unit of each other in both
  // dimensions) — Gemini occasionally emits such degenerates and
  // they'd render as invisible dots.
  const walls: Wall[] = [];
  for (const w of wallsRaw) {
    if (!w || typeof w !== "object") continue;
    const x1 = Number((w as Record<string, unknown>).x1);
    const y1 = Number((w as Record<string, unknown>).y1);
    const x2 = Number((w as Record<string, unknown>).x2);
    const y2 = Number((w as Record<string, unknown>).y2);
    if (
      !Number.isFinite(x1) || !Number.isFinite(y1) ||
      !Number.isFinite(x2) || !Number.isFinite(y2)
    ) continue;
    if (x1 < 0 || x1 > 1000 || y1 < 0 || y1 > 1000) continue;
    if (x2 < 0 || x2 > 1000 || y2 < 0 || y2 > 1000) continue;
    if (Math.abs(x1 - x2) < 1 && Math.abs(y1 - y2) < 1) continue;
    walls.push({ x1, y1, x2, y2 });
  }
  return walls;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// ── Raster fallback ──────────────────────────────────────────────
//
// When the AI fails after retry, return the source image as a JPEG
// so the Builder still has something to overlay pins on. imagescript
// supports JPEG encoding but not WebP encoding (as of 1.2.17), so we
// pick JPEG@80 — small enough for transport, universally supported,
// and far better than a "vectorization failed" dead end.
async function encodeJpegFallback(
  srcImg: Image,
): Promise<{ mime: string; data: string }> {
  const bytes = await srcImg.encodeJPEG(80);
  return { mime: "image/jpeg", data: uint8ToBase64(bytes) };
}

// ── Entry point ──────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return fail("input", "method_not_allowed", 405);
  }

  const ip = ipFromRequest(req);
  const rl = checkRateLimit(ip, { perMinute: 6 });
  if (!rl.allowed) {
    return fail("rate_limit", "rate_limited", 429, {
      retry_after_seconds: rl.retryAfterSeconds,
    });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
    return fail("auth", "supabase_env_missing", 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return fail("auth", "unauthorized_no_jwt", 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return fail("auth", "unauthorized_invalid_jwt", 401);
  }
  const userId = userData.user.id;

  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return fail("input", "invalid_json", 400);
  }
  const storagePath = String(body.storage_path ?? "").trim();
  if (!storagePath) return fail("input", "missing_storage_path", 400);

  // Path must begin with the caller's user id so a leaked function
  // URL can never be coerced into vectorizing someone else's upload.
  // Mirrors the RLS check on storage.objects.
  const firstSegment = storagePath.split("/")[0] ?? "";
  if (firstSegment !== userId) {
    return fail("ownership", "path_owner_mismatch", 403, {
      expected_prefix: userId,
    });
  }

  // Confirm the upload was registered. Missing row → upload was
  // tampered with or already purged.
  const { data: tracking, error: trackingErr } = await serviceClient
    .from("ephemeral_assets")
    .select("id, expires_at, file_size_bytes, mime_type")
    .eq("user_id", userId)
    .eq("bucket_id", "temporary-floorplans")
    .eq("file_path", storagePath)
    .maybeSingle();
  if (trackingErr) {
    return fail("tracking", "tracking_lookup_failed", 500, {
      err: trackingErr.message,
    });
  }
  if (!tracking) {
    return fail("tracking", "no_tracking_row", 404);
  }

  // Resolve which key to use BEFORE downloading the image — saves
  // bandwidth + storage churn when a user's quota is already
  // exhausted.
  let keyRes: KeyResolution;
  try {
    keyRes = await resolveApiKey(serviceClient, userId);
  } catch (err) {
    if (err instanceof QuotaExhausted) {
      return fail("quota", "floor_map_quota_exhausted", 402, {
        used: err.used,
        limit: err.limit,
        hint: "Add your own Gemini API key to continue.",
      });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return fail("byok", "byok_resolution_failed", 500, { err: msg });
  }

  // Download the raster via the service role.
  const { data: dl, error: dlErr } = await serviceClient.storage
    .from("temporary-floorplans")
    .download(storagePath);
  if (dlErr || !dl) {
    return fail("download", "storage_download_failed", 500, {
      err: dlErr?.message,
    });
  }

  // Belt-and-braces size cap.
  const fileSize = dl.size ?? tracking.file_size_bytes ?? 0;
  const kind = uploadKindForMime(tracking.mime_type ?? dl.type) ?? "image_bytes";
  const sizeCheck = checkUploadSize(fileSize, kind);
  if (!sizeCheck.ok) {
    return fail("size_limit", sizeCheck.message, 413, { size: fileSize });
  }

  let image: Image;
  try {
    const buf = new Uint8Array(await dl.arrayBuffer());
    const decoded = await decodeImage(buf);
    if (!(decoded instanceof Image)) {
      return fail("decode", "unsupported_image_kind", 415);
    }
    image = decoded;
  } catch (err) {
    return fail("decode", "image_decode_failed", 415, {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  // Downscale very large sources before sending to the AI so the
  // round-trip stays under the timeout budget.
  const longest = Math.max(image.width, image.height);
  if (longest > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / longest;
    image = image.resize(
      Math.round(image.width * scale),
      Math.round(image.height * scale),
    );
  }
  const sourceW = image.width;
  const sourceH = image.height;

  // Try AI vectorization (1 attempt + 1 retry on quality failure or
  // network error). On total failure, fall back to a JPEG raster of
  // the source so the Builder remains usable.
  let svg: string | null = null;
  let wallCount = 0;
  let usedRetry = false;
  let lastErr: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const isRetry = attempt === 1;
    try {
      const walls = await callGeminiVision(keyRes.apiKey, image, isRetry);
      console.log(
        `[vectorize-floorplan] attempt=${attempt} model=${GEMINI_MODEL} ` +
        `byok=${keyRes.byok} walls=${walls.length} dims=${sourceW}x${sourceH}`,
      );
      if (walls.length >= MIN_WALL_COUNT && walls.length <= MAX_WALL_COUNT) {
        svg = sanitizeSvg(buildWallsSvg(sourceW, sourceH, walls));
        wallCount = walls.length;
        usedRetry = isRetry;
        break;
      }
      lastErr = `wall_count_out_of_range:${walls.length}`;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
      console.warn(
        `[vectorize-floorplan] attempt=${attempt} failed: ${lastErr}`,
      );
    }
  }

  // Raster fallback path: encode the source as JPEG and skip the
  // quota increment (the user's pass would be wasted on a failure).
  let raster: { mime: string; data: string } | null = null;
  let mode: "ai-vector" | "raster-fallback" = "ai-vector";
  if (!svg) {
    try {
      raster = await encodeJpegFallback(image);
      mode = "raster-fallback";
      console.warn(
        `[vectorize-floorplan] raster fallback engaged after both AI attempts. last_err=${lastErr}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return fail("trace", "raster_fallback_failed", 500, {
        err: msg,
        ai_err: lastErr,
      });
    }
  }

  // Atomic increment ONLY on AI success AND non-BYOK. The RPC is a
  // conditional UPDATE so concurrent requests can't overshoot the
  // limit by more than the natural race width.
  let quotaUsed = keyRes.quotaUsed;
  if (svg && !keyRes.byok) {
    const { data: consumeData } = await serviceClient.rpc(
      "consume_floor_plan_pass",
      { p_user_id: userId, p_limit: LIFETIME_PASS_LIMIT },
    );
    const row = Array.isArray(consumeData) ? consumeData[0] : consumeData;
    if (row && typeof row === "object" && "used" in row) {
      quotaUsed = (row as { used: number }).used;
    } else {
      // Defensive: if the RPC didn't return a row (shouldn't happen),
      // estimate the post-state so the UI doesn't lie to the user.
      quotaUsed = Math.min(LIFETIME_PASS_LIMIT, keyRes.quotaUsed + 1);
    }
  }

  return jsonResponse({
    ok: true,
    svg: svg ?? "",
    raster,
    viewBox: `0 0 ${sourceW} ${sourceH}`,
    width: sourceW,
    height: sourceH,
    wall_count: wallCount,
    // Legacy field name kept for any external consumers still
    // expecting it; same value as wall_count under the new pipeline.
    path_count: wallCount,
    bytes: (svg ?? raster?.data ?? "").length,
    mode,
    pipeline: PIPELINE_VERSION,
    retry: usedRetry,
    quota: {
      used: quotaUsed,
      limit: LIFETIME_PASS_LIMIT,
      byok_active: keyRes.byok,
    },
  });
});
