// vectorize-floorplan
// ───────────────────
// raster-v2: image processing now happens in the BROWSER
// (src/lib/portal/floor-map-compress.ts). Server-side decode/resize
// via `imagescript` blew the Worker's CPU budget for any reasonably
// sized Matterport screenshot, so this function now just:
//   1. Verifies the caller's JWT and that the path prefix == auth.uid().
//   2. Confirms an `ephemeral_assets` row exists for the upload.
//   3. Downloads the (already-small JPEG) from storage.
//   4. Base64-encodes it and returns it to the client for embedding.
//
// History: ai-v1/v2 used Gemini, raster-v1 used imagescript on the
// server, raster-v2 (current) does the resize client-side.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

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
  /** Pixel dimensions of the (already resized) JPEG, sent by the client. */
  width?: number;
  height?: number;
}

const PIPELINE_VERSION = "raster-v2";
const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

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
  | "size_limit"
  | "rate_limit"
  | "mime";

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

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

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

  const firstSegment = storagePath.split("/")[0] ?? "";
  if (firstSegment !== userId) {
    return fail("ownership", "path_owner_mismatch", 403, {
      expected_prefix: userId,
    });
  }

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

  const { data: dl, error: dlErr } = await serviceClient.storage
    .from("temporary-floorplans")
    .download(storagePath);
  if (dlErr || !dl) {
    return fail("download", "storage_download_failed", 500, {
      err: dlErr?.message,
    });
  }

  const mime = (tracking.mime_type ?? dl.type ?? "image/jpeg").toLowerCase();
  if (!ALLOWED_MIMES.has(mime)) {
    return fail("mime", "unsupported_mime", 415, { mime });
  }

  const fileSize = dl.size ?? tracking.file_size_bytes ?? 0;
  const kind = uploadKindForMime(mime) ?? "image_bytes";
  const sizeCheck = checkUploadSize(fileSize, kind);
  if (!sizeCheck.ok) {
    return fail("size_limit", sizeCheck.message, 413, { size: fileSize });
  }

  const buf = new Uint8Array(await dl.arrayBuffer());
  const base64 = uint8ToBase64(buf);

  const outW = Math.max(1, Math.round(Number(body.width) || 0)) || 1024;
  const outH = Math.max(1, Math.round(Number(body.height) || 0)) || 768;

  console.log(
    `[vectorize-floorplan] pipeline=${PIPELINE_VERSION} dims=${outW}x${outH} ` +
    `bytes=${buf.length} bytes_b64=${base64.length} mime=${mime}`,
  );

  return jsonResponse({
    ok: true,
    svg: "",
    raster: { mime: mime as "image/jpeg" | "image/png" | "image/webp", data: base64 },
    viewBox: `0 0 ${outW} ${outH}`,
    width: outW,
    height: outH,
    bytes: base64.length,
    mode: "raster",
    pipeline: PIPELINE_VERSION,
  });
});
