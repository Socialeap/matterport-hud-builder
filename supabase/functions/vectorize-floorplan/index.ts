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
//   5. Ask Gemini 3 Pro Image to redraw the dollhouse as a clean
//      black-on-white architectural schematic (the AI does the work
//      of separating walls from furniture/shadows/rugs that no
//      deterministic algorithm could reliably handle).
//   6. Run the cleaned image through the marching-squares tracer →
//      Douglas-Peucker simplify → SVG paths.
//   7. On AI failure (network, malformed output, zero/absurd path
//      counts after one retry with a stronger-contrast prompt),
//      return the original raster as a JPEG fallback so the Builder
//      remains usable — pins still work over the raster.
//   8. On success without BYOK, atomically increment the user's
//      lifetime pass counter via consume_floor_plan_pass RPC.
//   9. Return { ok, svg | raster, viewBox, width, height, mode,
//      pipeline, path_count, bytes, quota } to the client.
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

/** Cap on the longest source dimension before tracing. Keeps the
 *  per-pixel passes bounded regardless of upload resolution. */
const MAX_DIMENSION = 2048;
/** Luminance threshold for binarising Gemini's near-pure-B&W output. */
const BINARIZE_THRESHOLD = 200;
/** Douglas-Peucker tolerance for the AI-cleaned trace. */
const SIMPLIFY_EPSILON = 0.75;
/** Minimum vertices before a contour is worth emitting as a path. */
const MIN_CONTOUR_LENGTH = 8;
/** Aspect-ratio tolerance between source and AI output. Beyond this
 *  we resize/letterbox to the source dims so pin coordinates stay
 *  anchored across re-vectorizations. */
const ASPECT_TOLERANCE = 0.05;
/** Pipeline build marker — bump whenever the function changes so
 *  operators can verify in DevTools (network response → JSON, or
 *  view-source the rendered SVG → data-pipeline attribute) which
 *  version is actually deployed. */
const PIPELINE_VERSION = "ai-v1";
/** Lifetime free-pass cap for non-BYOK users. Must match the default
 *  in the consume_floor_plan_pass RPC. */
const LIFETIME_PASS_LIMIT = 3;
/** Gemini model id — overridable via env for forward compat (e.g.
 *  switching to a successor model or A/B testing). */
const GEMINI_MODEL =
  Deno.env.get("GEMINI_FLOORPLAN_MODEL") ?? "gemini-3-pro-image-preview";
/** Hard timeout on the Gemini call. Keeps us well under the platform's
 *  60s edge function ceiling so the client gets a clean error rather
 *  than a connection drop. */
const GEMINI_TIMEOUT_MS = 40_000;
/** Path-count quality gate. Below the lower bound the AI returned an
 *  empty/almost-empty image; above the upper bound it returned noise.
 *  Either condition triggers a retry; if the retry also fails we fall
 *  back to the raster. */
const MIN_PATH_COUNT = 1;
const MAX_PATH_COUNT = 500;

const DRAFTSMAN_PROMPT = `You are an expert Architectural Draftsman specializing in 2D schematic conversion.

Task: Analyze the provided 3D dollhouse view of a building. Redraw the building footprint as a clean 2D high-contrast architectural schematic.

Strict requirements:
1. Pure black walls (#000000) on a pure white background (#FFFFFF). No grays, no anti-aliasing, no gradients, no shadows.
2. Ignore ALL furniture, rugs, plants, people, lighting, decorative textures, and color fills inside rooms.
3. Maintain 1:1 spatial proportions and orientation. Do not add rooms or reshape the layout.
4. Show only structural walls. Include clear gaps for doors and openings; mark windows with a thin gap where appropriate.
5. Do not include text labels, dimensions, north arrows, compasses, scale bars, or watermarks.

Output a high-resolution PNG image only. No commentary, no captions.`;

const RETRY_PROMPT_SUFFIX = `

NOTE: The previous attempt was too noisy or empty. Increase contrast further: thicker pure-black wall strokes, larger gaps between rooms, fewer decorative detail lines. Output ONLY the wall outlines.`;

interface Pt { x: number; y: number; }

// ── Marching-squares contour tracer ──────────────────────────────
//
// Walks 2×2 cells over a binary mask. For each cell it computes a
// 4-bit code describing which of the four surrounding pixels are
// foreground; the code drives a direction lookup that follows the
// boundary segment until the walk hits a visited cell or the image
// border. With Gemini's clean B&W output the binarized mask matches
// the wall geometry exactly so the tracer's output is the final SVG.
function traceContours(bin: Uint8Array, width: number, height: number): Pt[][] {
  const at = (x: number, y: number): number => {
    if (x < 0 || y < 0 || x >= width || y >= height) return 0;
    return bin[y * width + x];
  };
  const visited = new Uint8Array((width + 1) * (height + 1));
  const contours: Pt[][] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tl = at(x - 1, y - 1);
      const tr = at(x, y - 1);
      const bl = at(x - 1, y);
      const br = at(x, y);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      if (visited[y * (width + 1) + x]) continue;

      const contour: Pt[] = [];
      let cx = x;
      let cy = y;
      let dir = 0; // 0=right, 1=down, 2=left, 3=up
      let safety = 0;
      const maxSteps = width * height * 4;
      while (safety++ < maxSteps) {
        const idx = cy * (width + 1) + cx;
        if (visited[idx]) break;
        visited[idx] = 1;
        contour.push({ x: cx, y: cy });

        const ttl = at(cx - 1, cy - 1);
        const ttr = at(cx, cy - 1);
        const tbl = at(cx - 1, cy);
        const tbr = at(cx, cy);
        const ccode = (ttl << 3) | (ttr << 2) | (tbr << 1) | tbl;

        switch (ccode) {
          case 1: dir = 2; break;
          case 2: dir = 1; break;
          case 3: dir = 2; break;
          case 4: dir = 3; break;
          case 5:
            dir = dir === 3 ? 2 : 0;
            break;
          case 6: dir = 1; break;
          case 7: dir = 2; break;
          case 8: dir = 0; break;
          case 9: dir = 3; break;
          case 10:
            dir = dir === 0 ? 3 : 1;
            break;
          case 11: dir = 3; break;
          case 12: dir = 0; break;
          case 13: dir = 0; break;
          case 14: dir = 1; break;
          default: safety = maxSteps; break;
        }
        if (dir === 0) cx++;
        else if (dir === 1) cy++;
        else if (dir === 2) cx--;
        else if (dir === 3) cy--;
        if (cx < 0 || cy < 0 || cx > width || cy > height) break;
      }
      if (contour.length >= MIN_CONTOUR_LENGTH) contours.push(contour);
    }
  }
  return contours;
}

// ── Douglas-Peucker line simplification ──────────────────────────
//
// Drops points within `epsilon` pixels of the line connecting their
// neighbours. Iterative (explicit stack) to avoid recursion overflow
// on long wall-spanning contours.
function simplify(points: Pt[], epsilon: number): Pt[] {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [lo, hi] = stack.pop()!;
    if (hi - lo < 2) continue;
    const a = points[lo];
    const b = points[hi];
    let maxDist = 0;
    let maxIdx = -1;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let i = lo + 1; i < hi; i++) {
      const p = points[i];
      const dist = Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
      if (dist > maxDist) {
        maxDist = dist;
        maxIdx = i;
      }
    }
    if (maxDist > epsilon && maxIdx !== -1) {
      keep[maxIdx] = 1;
      stack.push([lo, maxIdx]);
      stack.push([maxIdx, hi]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]);
  return out;
}

function pointsToPathData(points: Pt[]): string {
  if (points.length === 0) return "";
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += `L${points[i].x} ${points[i].y}`;
  }
  return d + "Z";
}

// ── Binarize ─────────────────────────────────────────────────────
//
// Gemini's "pure black on pure white" output is already near-binary,
// so a high luminance threshold (200) cleanly separates walls from
// background without latching onto the residual anti-aliasing fringe.
function binarize(img: Image, threshold: number): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  const bitmap = img.bitmap;
  for (let i = 0; i < out.length; i++) {
    const off = i * 4;
    const r = bitmap[off];
    const g = bitmap[off + 1];
    const b = bitmap[off + 2];
    const a = bitmap[off + 3];
    const lum = a < 128 ? 255 : (0.299 * r + 0.587 * g + 0.114 * b);
    out[i] = lum < threshold ? 1 : 0;
  }
  return out;
}

// ── SVG assembly + sanitization ──────────────────────────────────
//
// We generate every byte ourselves so there's no real XSS vector,
// but the sanitizer is here as defense in depth (called out by the
// spec). If a future refactor ever lets untrusted data into the
// path string this remains the last line of defense.
function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "");
}

function emitSvg(width: number, height: number, paths: string[]): string {
  const pathEls = paths.map((d) => `<path d="${d}"/>`).join("");
  // preserveAspectRatio="xMidYMid meet" is mandatory: pin coordinates
  // are stored as percentages of the SVG viewBox, so the runtime
  // relies on the aspect ratio staying locked even as the modal
  // resizes.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="xMidYMid meet" data-pipeline="${PIPELINE_VERSION}" ` +
    `data-mode="ai-vector" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linejoin="round" stroke-linecap="round">` +
    pathEls +
    `</svg>`
  );
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

// ── Gemini image-out call ────────────────────────────────────────
//
// POSTs the source PNG (as inlineData) plus the Draftsman prompt to
// gemini-3-pro-image-preview and returns the AI's PNG bytes. Throws
// on timeout, non-200, missing inlineData, or invalid base64. The
// caller's retry/fallback policy handles all of those uniformly.
async function callGemini(
  apiKey: string,
  srcImg: Image,
  retry: boolean,
): Promise<Uint8Array> {
  const srcBytes = await srcImg.encode();
  const srcB64 = uint8ToBase64(srcBytes);

  const promptText = retry
    ? DRAFTSMAN_PROMPT + RETRY_PROMPT_SUFFIX
    : DRAFTSMAN_PROMPT;

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
          responseModalities: ["IMAGE"],
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
      content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> };
    }>;
  };

  const parts = body.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    const data = part.inlineData?.data;
    if (data && typeof data === "string") {
      return base64ToUint8(data);
    }
  }
  throw new Error("gemini_no_image_part");
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ── Aspect-ratio normalization ───────────────────────────────────
//
// Gemini doesn't guarantee an output aspect that matches the input.
// Pin coordinates are percentages of the viewBox, so a 3-5% aspect
// drift would walk every existing pin off the wall it was anchored
// to. Resizing the AI output to the source dims keeps the viewBox
// constant across re-vectorizations and preserves pin stability.
function normalizeAspect(aiImg: Image, targetW: number, targetH: number): Image {
  if (aiImg.width === targetW && aiImg.height === targetH) return aiImg;
  return aiImg.resize(targetW, targetH);
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
  let pathCount = 0;
  let usedRetry = false;
  let lastErr: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const isRetry = attempt === 1;
    try {
      const aiBytes = await callGemini(keyRes.apiKey, image, isRetry);
      const aiDecoded = await decodeImage(aiBytes);
      if (!(aiDecoded instanceof Image)) {
        throw new Error("ai_decode_not_image");
      }
      const aiImg = normalizeAspect(aiDecoded, sourceW, sourceH);
      const mask = binarize(aiImg, BINARIZE_THRESHOLD);
      const contours = traceContours(mask, sourceW, sourceH);
      const paths: string[] = [];
      for (const c of contours) {
        const simplified = simplify(c, SIMPLIFY_EPSILON);
        if (simplified.length < 3) continue;
        paths.push(pointsToPathData(simplified));
      }
      console.log(
        `[vectorize-floorplan] attempt=${attempt} model=${GEMINI_MODEL} byok=${keyRes.byok} ` +
        `paths=${paths.length} dims=${sourceW}x${sourceH}`,
      );
      if (paths.length >= MIN_PATH_COUNT && paths.length <= MAX_PATH_COUNT) {
        svg = sanitizeSvg(emitSvg(sourceW, sourceH, paths));
        pathCount = paths.length;
        usedRetry = isRetry;
        break;
      }
      lastErr = `path_count_out_of_range:${paths.length}`;
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
    path_count: pathCount,
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
