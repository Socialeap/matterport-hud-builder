// extract-property-doc
// ─────────────────────
// Given { vault_asset_id, template_id, property_uuid, saved_model_id? }:
//  1. Check LUS freeze for property_uuid → 423 if frozen
//  2. Load the vault_asset + template + PDF bytes from storage
//  3. Run the template's extractor (pdfjs_heuristic | donut)
//  4. Upsert a property_extractions row with fields + chunks
//  5. Mark vault_assets.embedding_status = 'pending' so the client
//     can backfill chunk-level embeddings asynchronously.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

import { getProvider } from "../_shared/extractors/index.ts";
import type { VaultTemplate } from "../_shared/extractors/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  vault_asset_id: string;
  template_id: string;
  property_uuid: string;
  saved_model_id?: string | null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type Stage = "auth" | "input" | "freeze" | "asset" | "no_storage_path"
  | "template" | "download" | "extraction" | "persist";

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return fail("input", "method_not_allowed", 405);
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

  // Authed client for RLS-aware checks (who is the caller?).
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return fail("auth", "unauthorized_invalid_jwt", 401);
  }
  const userId = userData.user.id;

  // Service client for privileged ops (storage download, cross-row reads).
  const serviceClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return fail("input", "invalid_json", 400);
  }
  if (!body.vault_asset_id || !body.template_id || !body.property_uuid) {
    return fail("input", "missing_fields", 400);
  }

  // 1 ─ Freeze check
  const { data: freeze } = await serviceClient
    .from("lus_freezes")
    .select("property_uuid")
    .eq("property_uuid", body.property_uuid)
    .maybeSingle();
  if (freeze) {
    return fail("freeze" as Stage, "lus_frozen", 423, { property_uuid: body.property_uuid });
  }

  // 2 ─ Load asset.
  const { data: asset, error: assetErr } = await serviceClient
    .from("vault_assets")
    .select("id, provider_id, storage_path, category_type, mime_type")
    .eq("id", body.vault_asset_id)
    .single();
  if (assetErr || !asset) return fail("asset", "asset_not_found", 404);

  let authorised = asset.provider_id === userId;
  if (!authorised) {
    const { data: link } = await serviceClient
      .from("client_providers")
      .select("id")
      .eq("provider_id", asset.provider_id)
      .eq("client_id", userId)
      .maybeSingle();
    authorised = !!link;
  }
  if (!authorised) {
    return fail("asset", "forbidden", 403);
  }

  if (asset.category_type !== "property_doc") {
    return fail("asset", "wrong_category", 400, { category: asset.category_type });
  }
  if (!asset.storage_path) {
    return fail("no_storage_path", "no_storage_path", 400, {
      hint: "use extract-url-content for URL-based assets",
    });
  }

  // Template must belong to the same provider as the asset.
  const { data: template, error: tplErr } = await serviceClient
    .from("vault_templates")
    .select("*")
    .eq("id", body.template_id)
    .eq("provider_id", asset.provider_id)
    .single();
  if (tplErr || !template) {
    return fail("template", "template_not_found", 404, {
      template_id: body.template_id,
    });
  }

  // 3 ─ Download bytes.
  let bytes: Uint8Array | null = null;
  let bucketUsed = "";
  for (const bucket of ["property-docs", "vault-assets"]) {
    const { data, error } = await serviceClient.storage
      .from(bucket)
      .download(asset.storage_path);
    if (!error && data) {
      bytes = new Uint8Array(await data.arrayBuffer());
      bucketUsed = bucket;
      break;
    }
  }
  if (!bytes) {
    console.error(
      `[extract-property-doc] stage=download path=${asset.storage_path}`,
    );
    return fail("download", "download_failed", 502, {
      storage_path: asset.storage_path,
    });
  }

  // 4 ─ Run extractor
  const provider = getProvider(template.extractor);
  let fields: Record<string, unknown>;
  let chunks: { id: string; section: string; content: string }[];
  try {
    const result = await provider.extract({
      bytes,
      template: template as unknown as VaultTemplate,
      mimeType: asset.mime_type ?? undefined,
    });
    fields = result.fields;
    chunks = result.chunks;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(
      `[extract-property-doc] stage=extraction extractor=${provider.id} detail=${msg}`,
    );
    return fail("extraction", msg, 500, {
      extractor: provider.id,
      mime_type: asset.mime_type,
      bytes: bytes.byteLength,
    });
  }

  // 5 ─ Upsert property_extractions
  const { data: upserted, error: upErr } = await serviceClient
    .from("property_extractions")
    .upsert(
      {
        vault_asset_id: body.vault_asset_id,
        template_id: body.template_id,
        saved_model_id: body.saved_model_id ?? null,
        property_uuid: body.property_uuid,
        fields,
        chunks,
        extractor: provider.id,
        extractor_version: provider.version,
      },
      { onConflict: "vault_asset_id,template_id" },
    )
    .select("id")
    .single();

  if (upErr || !upserted) {
    console.error(
      `[extract-property-doc] stage=persist detail=${upErr?.message ?? "unknown"}`,
    );
    return fail("persist", upErr?.message ?? "upsert_returned_no_row", 500, {
      extractor: provider.id,
      field_keys: Object.keys(fields).length,
      chunks: chunks.length,
    });
  }

  // 6 ─ Flip embedding_status to pending.
  await serviceClient
    .from("vault_assets")
    .update({ embedding_status: "pending" })
    .eq("id", body.vault_asset_id);

  console.info(
    `[extract-property-doc] extractor=${provider.id} bucket=${bucketUsed} fields=${Object.keys(fields).length} chunks=${chunks.length} ok`,
  );

  return jsonResponse({
    ok: true,
    extraction_id: upserted.id,
    fields,
    chunks_indexed: chunks.length,
    embedding_status: "pending" as const,
    diagnostics: {
      extractor: provider.id,
      field_keys: Object.keys(fields).length,
      bucket: bucketUsed,
    },
  });
});
