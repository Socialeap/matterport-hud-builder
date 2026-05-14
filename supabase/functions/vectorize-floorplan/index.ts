// vectorize-floorplan
// ───────────────────
// Given { storage_path } pointing to a raster floor-plan image
// previously uploaded to the `temporary-floorplans` bucket by the
// authenticated user:
//   1. Verify the caller's JWT and confirm they own the file
//      (path prefix === auth.uid()).
//   2. Verify a matching ephemeral_assets row exists for that user.
//   3. Download the raster from storage via the service-role client.
//   4. Decode → binarize → marching-squares contour trace →
//      Douglas-Peucker simplify → emit minified SVG path data.
//   5. Sanitize the resulting SVG (defense in depth — we generate
//      every byte ourselves, but strip script/event handlers
//      anyway so a future change can't accidentally introduce XSS).
//   6. Return { ok, svg, viewBox, width, height, paths } to the
//      client, which embeds it in the builder draft and ultimately
//      in the exported standalone HTML.
//
// The original raster is left in place — `pg_cron` will purge it
// 30 days after upload (see migration
// 20260514130000_ephemeral_floorplan_assets.sql).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";
import { decode as decodeImage, Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

import {
  checkUploadSize,
  uploadKindForMime,
} from "../_shared/upload-limits.ts";
import { checkRateLimit, ipFromRequest } from "../_shared/rate-limit.ts";

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

// ── Binarization + contour tracing ────────────────────────────────
//
// Floor plans are overwhelmingly black-on-white architectural lines.
// Marching squares on a binarized image picks up wall contours with
// near-perfect fidelity and stays orthogonal — exactly what a
// blueprint wants. Douglas-Peucker simplification then drops
// collinear vertices so the SVG path data minifies to a fraction of
// the raster's byte count.

const MAX_DIMENSION = 2048;
const MIN_CONTOUR_LENGTH = 8;
const SIMPLIFY_EPSILON = 0.75;

interface TraceResult {
  paths: string[];
  width: number;
  height: number;
}

function binarize(img: Image, threshold: number): Uint8Array {
  const out = new Uint8Array(img.width * img.height);
  // imagescript packs RGBA into a Uint32. R=byte0, G=byte1, B=byte2.
  const bitmap = img.bitmap;
  for (let i = 0; i < out.length; i++) {
    const off = i * 4;
    const r = bitmap[off];
    const g = bitmap[off + 1];
    const b = bitmap[off + 2];
    const a = bitmap[off + 3];
    // Treat transparent as background. Luminance is the standard
    // BT.601 weighting; floor-plan ink usually clears the threshold
    // even at the default 128.
    const lum = a < 128 ? 255 : (0.299 * r + 0.587 * g + 0.114 * b);
    out[i] = lum < threshold ? 1 : 0;
  }
  return out;
}

interface Pt { x: number; y: number; }

// Trace contours by walking 2×2 cells (marching squares). For each
// cell we look at the four neighbours and decide which edge segment
// (if any) the contour passes through; we follow these segments
// until they close on themselves or hit the image border.
function traceContours(
  bin: Uint8Array,
  width: number,
  height: number,
): Pt[][] {
  // Build edge index. `cellAt(x,y)` returns the 4-bit code from
  // the 2x2 footprint anchored at (x,y).
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
      // 4-bit code: TL=8, TR=4, BR=2, BL=1
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      if (code === 0 || code === 15) continue;
      if (visited[y * (width + 1) + x]) continue;

      // Follow the contour from this seed cell.
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

        // Direction lookup follows the standard MS ambiguity
        // resolution (saddle cases prefer rotating right).
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
          default: safety = maxSteps; break; // 0 or 15
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

// Douglas-Peucker line simplification — drops points that are
// within `epsilon` pixels of the line connecting their neighbours.
// Run iteratively to avoid recursion blowups on long contours.
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

function traceImage(img: Image): TraceResult {
  // Downscale very large images so the contour tracer stays under
  // ~50 ms even on a worst-case 5 MB upload. Aspect ratio is
  // preserved so percentage-based pin coordinates are stable
  // regardless of source resolution.
  let working = img;
  const longest = Math.max(img.width, img.height);
  if (longest > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / longest;
    working = img.resize(
      Math.round(img.width * scale),
      Math.round(img.height * scale),
    );
  }
  // Convert to grayscale via the same luminance weighting as
  // binarize() — separate pass kept readable. The 160 threshold
  // is a good compromise for scanned/printed blueprints; pure
  // digital blueprints binarize cleanly almost anywhere in
  // [80, 200].
  const bin = binarize(working, 160);
  const contours = traceContours(bin, working.width, working.height);
  const paths: string[] = [];
  for (const c of contours) {
    const simplified = simplify(c, SIMPLIFY_EPSILON);
    if (simplified.length < 3) continue;
    paths.push(pointsToPathData(simplified));
  }
  return { paths, width: working.width, height: working.height };
}

// ── SVG assembly + sanitization ──────────────────────────────────
//
// We generate every byte of the SVG ourselves so there's no real
// XSS vector — but the sanitizer is here as a defense-in-depth
// measure called out by the spec. If a future refactor ever lets
// untrusted data into the path string this stays the last line of
// defense.
function sanitizeSvg(svg: string): string {
  // Strip script blocks and event handlers; these would never appear
  // in our own output but we run the gate anyway.
  return svg
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, "");
}

function buildSvg(trace: TraceResult): string {
  const { width, height, paths } = trace;
  // `preserveAspectRatio="xMidYMid meet"` is mandatory: pin
  // coordinates are stored as percentages of the SVG viewBox, so
  // the runtime relies on the aspect ratio staying locked even as
  // the modal resizes.
  const pathEls = paths
    .map((d) => `<path d="${d}"/>`)
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `preserveAspectRatio="xMidYMid meet" fill="none" stroke="currentColor" ` +
    `stroke-width="2" stroke-linejoin="round" stroke-linecap="round">` +
    pathEls +
    `</svg>`;
  return sanitizeSvg(svg);
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
  // URL can never be coerced into vectorizing someone else's
  // upload. This mirrors the RLS check on storage.objects.
  const firstSegment = storagePath.split("/")[0] ?? "";
  if (firstSegment !== userId) {
    return fail("ownership", "path_owner_mismatch", 403, {
      expected_prefix: userId,
    });
  }

  // Confirm the upload was registered. The Builder always inserts
  // an `ephemeral_assets` row immediately after upload so the
  // 30-day purge can find it. A missing row means the upload was
  // tampered with or the row was already purged.
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

  // Download the raster via the service role so it works whether
  // or not the user client has fresh storage permissions.
  const { data: dl, error: dlErr } = await serviceClient.storage
    .from("temporary-floorplans")
    .download(storagePath);
  if (dlErr || !dl) {
    return fail("download", "storage_download_failed", 500, {
      err: dlErr?.message,
    });
  }

  // Belt-and-braces size cap. The Builder enforces 5 MB before
  // upload; we re-check here so a direct-to-storage upload can't
  // smuggle a 50 MB image past us.
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
    // imagescript returns Image | GIF; we only support stills here.
    if (!(decoded instanceof Image)) {
      return fail("decode", "unsupported_image_kind", 415);
    }
    image = decoded;
  } catch (err) {
    return fail("decode", "image_decode_failed", 415, {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  let trace: TraceResult;
  try {
    trace = traceImage(image);
  } catch (err) {
    return fail("trace", "contour_trace_failed", 500, {
      err: err instanceof Error ? err.message : String(err),
    });
  }

  if (trace.paths.length === 0) {
    return fail("trace", "no_contours_detected", 422, {
      hint: "Image appears to be all one tone. Try a higher-contrast scan.",
    });
  }

  const svg = buildSvg(trace);

  return jsonResponse({
    ok: true,
    svg,
    viewBox: `0 0 ${trace.width} ${trace.height}`,
    width: trace.width,
    height: trace.height,
    path_count: trace.paths.length,
    bytes: svg.length,
  });
});
