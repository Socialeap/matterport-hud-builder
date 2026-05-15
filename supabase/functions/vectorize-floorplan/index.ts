// vectorize-floorplan
// ───────────────────
// Given { storage_path } pointing to a raster floor-plan image
// previously uploaded to the `temporary-floorplans` bucket by the
// authenticated user:
//   1. Verify the caller's JWT and confirm they own the file
//      (path prefix === auth.uid()).
//   2. Verify a matching ephemeral_assets row exists for that user.
//   3. Download the raster from storage via the service-role client.
//   4. Downsize to a sensible web display dimension and re-encode
//      as JPEG@85 — small enough to embed as a data URI in the
//      exported standalone HTML, large enough to read clearly.
//   5. Return { ok, raster, viewBox, width, height, mode, pipeline,
//      bytes } to the client. Pins layer on top of the raster via
//      percentage positioning.
//
// History note: PRs #78 and #79 attempted two AI-driven approaches
// (Gemini image-out + tracer; Gemini Vision + structured JSON
// walls). Neither produced reliably professional output on Matterport
// dollhouse renders — the models either kept furniture detail or
// fragmented the wall geometry. We've decommissioned the AI path
// and ship the source photo as-is. The migration column
// (profiles.floor_plan_free_passes_used) and BYOK plumbing are
// left in place but no longer referenced, so reviving an AI path
// later is a one-PR change.
//
// The original raster is left in storage — `pg_cron` purges it 30
// days after upload (see migration
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
  | "encode"
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

/** Cap on the longest dimension we ship to the client. Matterport
 *  dollhouse renders typically come in at 2000-3000px on the long
 *  side; downsizing to 1600 keeps the file size manageable while
 *  preserving enough detail that visitors can read the layout. */
const MAX_DIMENSION = 1600;
/** JPEG quality. 85 is a sweet spot for floor-plan photos: visually
 *  near-lossless, file sizes typically 150-400 KB after downsize. */
const JPEG_QUALITY = 85;
/** Discoverable build marker — bump whenever the pipeline changes so
 *  operators can verify in DevTools (network response → JSON; or
 *  view-source the rendered SVG → data-pipeline attribute) which
 *  version is actually deployed. raster-v1 = no AI, just resized
 *  JPEG of the source. Previous markers: ai-v1 (image-out + tracer,
 *  PR #78), ai-v2 (Vision + structured JSON, PR #79). */
const PIPELINE_VERSION = "raster-v1";

// ── Helpers ──────────────────────────────────────────────────────

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
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
  // URL can never be coerced into processing someone else's upload.
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

  // Download the raster via the service role.
  const { data: dl, error: dlErr } = await serviceClient.storage
    .from("temporary-floorplans")
    .download(storagePath);
  if (dlErr || !dl) {
    return fail("download", "storage_download_failed", 500, {
      err: dlErr?.message,
    });
  }

  // Belt-and-braces size cap on the source upload.
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

  // Downsize so the embedded JPEG stays a reasonable size in the
  // exported HTML. Aspect ratio is preserved so percentage-based
  // pin coordinates remain stable across re-uploads.
  const longest = Math.max(image.width, image.height);
  if (longest > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / longest;
    image = image.resize(
      Math.round(image.width * scale),
      Math.round(image.height * scale),
    );
  }
  const outW = image.width;
  const outH = image.height;

  let jpegBytes: Uint8Array;
  try {
    jpegBytes = await image.encodeJPEG(JPEG_QUALITY);
  } catch (err) {
    return fail("encode", "jpeg_encode_failed", 500, {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  const base64 = uint8ToBase64(jpegBytes);

  console.log(
    `[vectorize-floorplan] pipeline=${PIPELINE_VERSION} dims=${outW}x${outH} ` +
    `bytes_jpeg=${jpegBytes.length} bytes_b64=${base64.length}`,
  );

  return jsonResponse({
    ok: true,
    svg: "",
    raster: { mime: "image/jpeg", data: base64 },
    viewBox: `0 0 ${outW} ${outH}`,
    width: outW,
    height: outH,
    bytes: base64.length,
    mode: "raster",
    pipeline: PIPELINE_VERSION,
  });
});
