// induce-schema
// ─────────────
// Accepts a base64-encoded PDF, extracts its raw text via unpdf (same
// library as pdfjs-heuristic), then sends that text to GPT-4o-mini to
// produce a JSON Schema that describes the document's extractable fields.
//
// The system prompt aligns the LLM's output to the canonical key set
// recognised by canonical-questions.ts (list_price, square_feet, etc.)
// so downstream Q&A generation works without any additional mapping.
//
// Called once per template at MSP authoring time — never on hot paths.
// Requires OPENAI_API_KEY set as a Supabase project secret.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Mirror of JsonSchemaField in _shared/extractors/types.ts.
// "integer" from the LLM is normalised to "number" during sanitisation.
type FieldType = "string" | "number" | "boolean" | "date";

interface JsonSchemaField {
  type: FieldType;
  description?: string;
  pattern?: string;
}

interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaField>;
  required?: string[];
}

// ── Exact system prompt from the product spec ────────────────────────────────
const SYSTEM_PROMPT = `Role and Objective:
You are an expert Data Architect and Real Estate Information Systems specialist. Your task is to analyze the provided raw text—which represents a real estate property document, flyer, or MLS listing—and automatically generate a standard JSON Schema (Draft-07) that perfectly models the key data points found within the document.

System Context & Alignment:
This schema will be used by an automated extraction engine to pull structured data from future documents of this type. To ensure maximum compatibility with our downstream Q&A systems, you must map the concepts you find in the document to the following standardized field keys whenever applicable:
* property_address (string)
* list_price, sale_price, purchase_price (number)
* square_feet, living_area (number)
* bedrooms, bathrooms, half_baths (number)
* year_built (integer)
* lot_size (string)
* hoa_fee, property_taxes (number)
* garage, parking_spaces (string/number)
* stories (integer)
* property_type (string)
* listing_date, closing_date (string)

Instructions:
1. Analyze the Text: Carefully read the user-provided document text. Identify all distinct, extractable data fields (e.g., prices, features, addresses, dates, contacts).
2. Map to Standard Keys: If a field you identify matches the concept of one of our standard keys listed above, you MUST use our standard key.
3. Create Custom Keys: If you find important extractable information that does not fit a standard key (e.g., "Roof Type", "School District", "Heating System"), create a clear, lowercase, snake_case key for it.
4. Determine Data Types: Assign the correct JSON data type (string, number, integer, boolean) to each field. Ensure financial amounts and measurements are typed appropriately (usually as number).
5. Add Descriptions: Write a brief, clear description for every property in the schema.
6. Assign Required Fields: Identify 2 to 5 core fields that are absolutely essential to this type of document and list them in the schema's required array.

Strict Output Constraints:
* You must output ONLY a valid JSON object.
* Do NOT wrap the JSON in markdown formatting blocks (e.g., do not use \`\`\`json ... \`\`\`).
* Do NOT include any conversational text, pleasantries, explanations, or introductory statements.
* The output must begin with { and end with }. Failure to return parseable JSON will break the application pipeline.`;

const MAX_PDF_BYTES = 10 * 1024 * 1024;
// GPT-4o-mini context window is large; 12 000 chars (~3 000 tokens) is
// enough to surface all fields in a typical real-estate PDF.
const MAX_TEXT_CHARS = 12_000;

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

// Strip markdown code fences the LLM might emit despite the prompt.
function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

// Normalise the raw LLM object into our internal JsonSchema shape.
// "integer" → "number"; any unrecognised type → "string".
function sanitiseSchema(raw: unknown): JsonSchema {
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as Record<string, unknown>).type !== "object"
  ) {
    throw new Error("LLM output is not a valid JSON Schema object");
  }
  const r = raw as Record<string, unknown>;
  const rawProps = (r.properties ?? {}) as Record<string, unknown>;
  const properties: Record<string, JsonSchemaField> = {};

  for (const [key, val] of Object.entries(rawProps)) {
    if (typeof val !== "object" || val === null) continue;
    const v = val as Record<string, unknown>;
    let type = String(v.type ?? "string");
    // JSON Schema Draft-07 has "integer"; our extractor only knows "number".
    if (type === "integer") type = "number";
    if (!["string", "number", "boolean", "date"].includes(type)) type = "string";
    const field: JsonSchemaField = { type: type as FieldType };
    if (typeof v.description === "string" && v.description) {
      field.description = v.description;
    }
    if (typeof v.pattern === "string" && v.pattern) {
      field.pattern = v.pattern;
    }
    properties[key] = field;
  }

  const schema: JsonSchema = { type: "object", properties };
  if (Array.isArray(r.required) && r.required.length > 0) {
    schema.required = (r.required as unknown[]).filter(
      (k): k is string => typeof k === "string" && k in properties,
    );
  }
  return schema;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

  if (!SUPABASE_URL || !ANON_KEY) {
    return jsonResponse({ error: "supabase_env_missing" }, 500);
  }
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: "openai_key_missing" }, 500);
  }

  // ── Auth ────────────────────────────────────────────────────────────────────
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

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { pdf_b64?: string };
  try {
    body = (await req.json()) as { pdf_b64?: string };
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!body.pdf_b64) {
    return jsonResponse({ error: "missing_pdf_b64" }, 400);
  }

  // ── Decode PDF bytes ────────────────────────────────────────────────────────
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(body.pdf_b64);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: "invalid_pdf_b64", detail: msg }, 400);
  }
  if (bytes.byteLength === 0) return jsonResponse({ error: "empty_pdf" }, 400);
  if (bytes.byteLength > MAX_PDF_BYTES) {
    return jsonResponse({ error: "pdf_too_large", max_bytes: MAX_PDF_BYTES }, 413);
  }

  // ── Extract text (same unpdf module as pdfjs-heuristic) ────────────────────
  let fullText: string;
  try {
    interface UnpdfModule {
      extractText(
        pdf: unknown,
        opts?: { mergePages?: boolean },
      ): Promise<{ text: string | string[] }>;
      getDocumentProxy(bytes: Uint8Array): Promise<unknown>;
    }
    const unpdf = (await import(
      "https://esm.sh/unpdf@0.12.1"
    )) as unknown as UnpdfModule;

    const pdf = await unpdf.getDocumentProxy(bytes);
    const { text: raw } = await unpdf.extractText(pdf, { mergePages: true });
    fullText = typeof raw === "string" ? raw : (raw as string[]).join("\n");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: "pdf_text_extraction_failed", detail: msg }, 500);
  }

  if (!fullText.trim()) {
    return jsonResponse({ error: "empty_pdf_text" }, 422);
  }

  // Truncate to stay within a reasonable token budget.
  const truncated =
    fullText.length > MAX_TEXT_CHARS
      ? fullText.slice(0, MAX_TEXT_CHARS)
      : fullText;

  // ── Call GPT-4o-mini ────────────────────────────────────────────────────────
  let llmRaw: string;
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: truncated },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return jsonResponse({ error: "openai_error", detail }, 502);
    }

    const completion = (await resp.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    llmRaw = completion.choices?.[0]?.message?.content ?? "";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: "openai_request_failed", detail: msg }, 502);
  }

  // ── Parse + sanitise schema ─────────────────────────────────────────────────
  let schema: JsonSchema;
  try {
    const stripped = stripFences(llmRaw);
    const parsed = JSON.parse(stripped) as unknown;
    schema = sanitiseSchema(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { error: "schema_parse_failed", detail: msg, raw_output: llmRaw.slice(0, 500) },
      422,
    );
  }

  if (Object.keys(schema.properties).length === 0) {
    return jsonResponse({ error: "no_fields_detected" }, 422);
  }

  return jsonResponse({
    schema,
    text_preview: fullText.slice(0, 500).trim(),
  });
});
