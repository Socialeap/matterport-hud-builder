// dryrun-template
// ─────────────
// Pure preview endpoint for the template editor. Given a draft template
// (NOT persisted) and a sample PDF (base64-encoded), runs the same
// extractor pipeline that extract-property-doc uses and returns
// { fields, chunks } without touching the database or storage.
//
// Caller must be authenticated (any role); no provider/asset checks
// because nothing is persisted and the template+PDF are caller-supplied.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

import { getProvider } from "../_shared/extractors/index.ts";
import type {
  JsonSchema,
  VaultTemplate,
} from "../_shared/extractors/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DryRunBody {
  template: {
    label?: string;
    doc_kind?: string;
    extractor: "pdfjs_heuristic" | "donut";
    field_schema: JsonSchema;
  };
  pdf_b64: string;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function decodeBase64(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Cap to avoid abusive payloads. 10 MB matches the extract-property-doc
// upstream practice for sample docs (real estate PDFs rarely exceed this).
const MAX_PDF_BYTES = 10 * 1024 * 1024;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !ANON_KEY) {
    return jsonResponse({ error: "supabase_env_missing" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return jsonResponse({ error: "unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: DryRunBody;
  try {
    body = (await req.json()) as DryRunBody;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  if (!body.template || !body.pdf_b64) {
    return jsonResponse({ error: "missing_fields" }, 400);
  }
  if (
    !body.template.extractor ||
    !body.template.field_schema ||
    body.template.field_schema.type !== "object" ||
    !body.template.field_schema.properties
  ) {
    return jsonResponse({ error: "invalid_template" }, 400);
  }

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(body.pdf_b64);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: "invalid_pdf_b64", detail: msg }, 400);
  }
  if (bytes.byteLength === 0) {
    return jsonResponse({ error: "empty_pdf" }, 400);
  }
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return jsonResponse(
      { error: "pdf_too_large", max_bytes: MAX_PDF_BYTES },
      413,
    );
  }

  // Synthesise a transient template object. Real id/provider_id/version
  // are not used by the extractors — they only consume `extractor` and
  // `field_schema`. Defaulting the rest keeps the type happy.
  const template: VaultTemplate = {
    id: "dryrun",
    provider_id: userData.user.id,
    label: body.template.label ?? "(dry run)",
    doc_kind: body.template.doc_kind ?? "(dry run)",
    field_schema: body.template.field_schema,
    extractor: body.template.extractor,
    version: 0,
  };

  const provider = getProvider(template.extractor);
  try {
    const result = await provider.extract({ bytes, template });
    return jsonResponse({
      fields: result.fields,
      chunks: result.chunks,
      extractor: provider.id,
      extractor_version: provider.version,
      pdf_bytes: bytes.byteLength,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: "extraction_failed", detail: msg }, 500);
  }
});
