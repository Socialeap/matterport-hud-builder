// induce-schema
// ─────────────
// Four modes, all powered by Google Gemini 2.5 Flash-Lite via the
// AI Studio REST API. The API key lives in the Supabase secret
// GEMINI_PRIMARY_MODEL (legacy name — it actually holds an AIza... key).
//
//   1. pdf_b64           — extract text from PDF, induce a JSON Schema.
//   2. mock_prompt       — generate a rich template from a description.
//   3. architect_draft   — Turn 1 of the Guided Refinement Architect:
//                          returns a numbered list of candidate fields
//                          tagged Foundational | Differentiator.
//   4. architect_refine  — Turn 2: take the MSP's kept items and emit
//                          a strict JSON Schema (Draft-07). Hidden
//                          canonical keys are merged additively before
//                          returning so the runtime Intent Router keeps
//                          working regardless of MSP choices.
//
// Called once per template at MSP authoring time — never on hot paths.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Types ────────────────────────────────────────────────────────────
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

interface CanonicalKeyDef {
  type: FieldType;
  description: string;
}

// ── Hidden canonical keys (mirror of src/lib/extraction/canonical-keys.ts).
// Edge function runs in Deno and cannot import from src/, so we duplicate.
// Keep the two files in sync.
const REQUIRED_CANONICAL_KEYS: Record<string, CanonicalKeyDef> = {
  property_address: {
    type: "string",
    description: "Full street address of the property (canonical).",
  },
};

const DOC_KIND_CANONICAL_KEYS: Record<string, Record<string, CanonicalKeyDef>> = {
  hud_statement: {
    purchase_price: { type: "number", description: "Purchase price (USD)." },
    sale_price: { type: "number", description: "Sale price (USD)." },
    closing_date: { type: "string", description: "Closing date (ISO 8601)." },
  },
  hospitality: {
    number_of_rooms: { type: "number", description: "Total guest rooms / keys." },
    number_of_suites: { type: "number", description: "Total suites." },
    total_meeting_sqft: {
      type: "number",
      description: "Total meeting / event space in square feet.",
    },
    menu_highlight: {
      type: "string",
      description: "Signature menu item or chef specialty.",
    },
  },
  commercial: {
    square_feet: { type: "number", description: "Total leasable square feet." },
    year_built: { type: "number", description: "Year the building was built." },
    property_type: {
      type: "string",
      description: "Commercial property type (office, retail, industrial, etc.).",
    },
  },
  residential: {
    list_price: { type: "number", description: "List price (USD)." },
    bedrooms: { type: "number", description: "Number of bedrooms." },
    bathrooms: { type: "number", description: "Number of bathrooms." },
    square_feet: { type: "number", description: "Living area in square feet." },
    year_built: { type: "number", description: "Year built." },
  },
};

function getCanonicalKeysFor(
  docKind: string | undefined,
): Record<string, CanonicalKeyDef> {
  const kind = (docKind ?? "").trim().toLowerCase();
  return {
    ...REQUIRED_CANONICAL_KEYS,
    ...(DOC_KIND_CANONICAL_KEYS[kind] ?? {}),
  };
}

// ── Mission Context (Architect system prompt prefix) ────────────────
const ARCHITECT_MISSION = `Mission: Transform raw property documents into a structured "Property Brain" — a digital knowledge base that translates unstructured info (PDFs, brochures) into a verified set of facts. This serves as the definitive source of truth for an AI-guided 3D tour, allowing the AI to provide authoritative, factual answers.

Purpose: Raw documents often contain overlapping info. By defining a precise schema, we create a map that helps the AI navigate these facts, preventing critical errors and ensuring every visitor answer is grounded in verified data.

Scope: Build a template that captures both Foundational facts (standard specs like sqft, year_built, address) and Differentiators (unique features like dining concepts, history, design inspiration). The objective is a "zero-hallucination" environment where the AI speaks only from the data provided.`;

// ── Original PDF system prompt (kept verbatim, now sent to Gemini) ──
const PDF_SYSTEM_PROMPT = `Role and Objective:
You are an expert Data Architect and Real Estate Information Systems specialist. Your task is to analyze the provided raw text — which represents a real estate property document, flyer, or MLS listing — and automatically generate a standard JSON Schema (Draft-07) that perfectly models the key data points found within the document.

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
1. Analyze the Text: Carefully read the user-provided document text. Identify all distinct, extractable data fields.
2. Map to Standard Keys: If a field you identify matches the concept of one of our standard keys above, you MUST use our standard key.
3. Create Custom Keys: If you find important extractable information that does not fit a standard key (e.g., "Roof Type", "School District"), create a clear, lowercase, snake_case key. Beyond the standard keys above, you SHOULD include any other extractable concepts the document covers — amenities, design notes, hospitality stats, commercial details, sustainability ratings, neighborhood descriptors, brand affiliations, etc. — add custom snake_case keys for them in \`properties\` so the runtime extractor knows to look for them too. Aim for a comprehensive schema (10–30 properties when content permits).
4. Determine Data Types: Assign the correct JSON data type to each field. Financial amounts and measurements should be number.
5. Add Descriptions: Write a brief, clear description for every property in the schema.
6. Assign Required Fields: Identify 2 to 5 core fields and list them in the required array.

Strict Output Constraints:
* Output ONLY a valid JSON object that begins with { and ends with }.
* Do NOT wrap in markdown code fences. Do NOT include any prose.`;

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_CHARS = 12_000;
const GEMINI_MODEL = "gemini-2.5-flash-lite";

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

function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

// ── Gemini caller ────────────────────────────────────────────────────
interface GeminiOpts {
  apiKey: string;
  systemPrompt: string;
  userPrompt: string;
  /** -1 = dynamic, 0 = no thinking (fastest), >0 = budget. */
  thinkingBudget: number;
  maxOutputTokens: number;
  temperature?: number;
  /** Optional strict response schema for Turn 2. */
  responseSchema?: Record<string, unknown>;
}

interface GeminiResult {
  text: string;
  usage: { prompt: number; completion: number; total: number };
}

async function callGemini(opts: GeminiOpts): Promise<GeminiResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const generationConfig: Record<string, unknown> = {
    temperature: opts.temperature ?? 0.2,
    topP: 0.95,
    maxOutputTokens: opts.maxOutputTokens,
    responseMimeType: "application/json",
    thinkingConfig: { thinkingBudget: opts.thinkingBudget },
  };
  if (opts.responseSchema) {
    generationConfig.responseSchema = opts.responseSchema;
  }
  const body = {
    contents: [{ role: "user", parts: [{ text: opts.userPrompt }] }],
    systemInstruction: { role: "system", parts: [{ text: opts.systemPrompt }] },
    generationConfig,
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error(`gemini_${resp.status}:${detail.slice(0, 400)}`);
  }
  const json = (await resp.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const text = json.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("") ?? "";
  const usage = {
    prompt: json.usageMetadata?.promptTokenCount ?? 0,
    completion: json.usageMetadata?.candidatesTokenCount ?? 0,
    total: json.usageMetadata?.totalTokenCount ?? 0,
  };
  return { text, usage };
}

// ── Schema sanitisation + validation ────────────────────────────────
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

const SNAKE = /^[a-z][a-z0-9_]*$/;

function validateSchemaStrict(schema: JsonSchema): string | null {
  const keys = Object.keys(schema.properties);
  if (keys.length < 3) return "schema must have at least 3 properties";
  if (keys.length > 60) return "schema must have at most 60 properties";
  for (const k of keys) {
    if (!SNAKE.test(k)) return `key "${k}" is not snake_case`;
    const f = schema.properties[k];
    if (!["string", "number", "boolean", "date"].includes(f.type)) {
      return `key "${k}" has invalid type "${f.type}"`;
    }
  }
  if (schema.required) {
    for (const r of schema.required) {
      if (!(r in schema.properties)) {
        return `required key "${r}" not in properties`;
      }
    }
  }
  return null;
}

/** Additive merge — never overwrites an MSP-defined property. */
function mergeCanonicalKeys(
  schema: JsonSchema,
  docKind: string | undefined,
): { schema: JsonSchema; added: string[] } {
  const canonical = getCanonicalKeysFor(docKind);
  const added: string[] = [];
  const properties = { ...schema.properties };
  for (const [k, def] of Object.entries(canonical)) {
    if (!(k in properties)) {
      properties[k] = { type: def.type, description: def.description };
      added.push(k);
    }
  }
  return {
    schema: { ...schema, properties },
    added,
  };
}

// ── Architect Turn 1: draft candidates ──────────────────────────────
interface DraftItem {
  id: number;
  key: string;
  label: "Foundational" | "Differentiator";
  title: string;
  desc: string;
}

async function runArchitectDraft(
  apiKey: string,
  propDescr: string,
): Promise<{ draft: DraftItem[]; usage: GeminiResult["usage"] }> {
  const system = `${ARCHITECT_MISSION}

You are the Property Template Architect (Turn 1: Draft).

Output contract — STRICT:
Return ONLY a valid JSON object of shape:
{ "draft": [ { "id": <int starting at 1>, "key": "<snake_case>", "label": "Foundational" | "Differentiator", "title": "<human-readable name>", "desc": "<≤120 char explanation>" } ] }

Rules:
- 12 to 24 items.
- "Foundational" = standard specs always extractable from any doc of this class (sqft, year_built, address-like).
- "Differentiator" = unique features that make THIS property stand out (signature dish, brand story, design note).
- Every "key" must be lowercase snake_case, ≤40 chars.
- No prose, no markdown, no commentary outside the JSON.`;

  const user = `Draft a candidate field list for this CLASS of property (a reusable mapping template, not a single listing). Prioritize "Source of Truth" facts a visitor would ask the Ask AI chat about — pricing, address, capacity, amenities, hours, hospitality stats, brand story, signature features:

"""${propDescr}"""`;

  const { text, usage } = await callGemini({
    apiKey,
    systemPrompt: system,
    userPrompt: user,
    thinkingBudget: 0, // fastest path for the draft
    maxOutputTokens: 1500,
    temperature: 0.3,
  });

  const parsed = JSON.parse(stripFences(text)) as { draft?: unknown };
  const rawDraft = Array.isArray(parsed.draft) ? parsed.draft : [];
  const draft: DraftItem[] = [];
  for (let i = 0; i < rawDraft.length; i++) {
    const it = rawDraft[i];
    if (typeof it !== "object" || it === null) continue;
    const o = it as Record<string, unknown>;
    const key = String(o.key ?? "").trim();
    const title = String(o.title ?? "").trim();
    const desc = String(o.desc ?? "").trim();
    const label = o.label === "Foundational" || o.label === "Differentiator"
      ? o.label
      : "Foundational";
    if (!SNAKE.test(key) || !title) continue;
    draft.push({
      id: typeof o.id === "number" ? o.id : i + 1,
      key,
      label,
      title,
      desc: desc.slice(0, 200),
    });
  }
  if (draft.length < 6) {
    throw new Error(`draft_too_short:${draft.length}`);
  }
  return { draft, usage };
}

// ── JSON repair + fallback synthesis (Turn 2 robustness) ────────────
/**
 * Best-effort repair for truncated/malformed Gemini JSON output.
 * Returns the parsed object on success, or null on failure.
 */
function tryRepairJson(raw: string): unknown | null {
  let s = stripFences(raw).trim();
  if (!s) return null;

  // Trim everything after the last balanced top-level '}'.
  // Walk the string tracking string state + brace depth.
  let depth = 0;
  let inStr = false;
  let escape = false;
  let lastBalanced = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inStr) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) lastBalanced = i;
    }
  }

  if (lastBalanced > 0) {
    const trimmed = s.slice(0, lastBalanced + 1);
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to heuristic repair
    }
  }

  // Heuristic: close an unterminated string, drop trailing commas, close braces.
  if (inStr) s += '"';
  s = s.replace(/,\s*([}\]])/g, "$1");
  // Append missing closing braces based on residual depth.
  // Recompute depth on the (possibly modified) string.
  let d = 0;
  let inS = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\" && inS) { esc = true; continue; }
    if (ch === '"') { inS = !inS; continue; }
    if (inS) continue;
    if (ch === "{") d++;
    else if (ch === "}") d--;
  }
  while (d > 0) { s += "}"; d--; }

  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Last-resort: build a valid Draft-07 schema purely from the MSP's kept items. */
function synthesizeFallbackSchema(keptItems: KeptItem[]): JsonSchema {
  const properties: Record<string, JsonSchemaField> = {};
  for (const it of keptItems) {
    if (!SNAKE.test(it.key)) continue;
    properties[it.key] = {
      type: "string",
      description: it.desc?.trim() || it.title.trim() || it.key,
    };
  }
  const required = Object.keys(properties).slice(0, Math.min(3, Object.keys(properties).length));
  return { type: "object", properties, required };
}

/**
 * Parse the Turn-2 Gemini response with three-tier resilience:
 * 1. Strict JSON.parse on stripped text.
 * 2. Repair pass (close strings, trim to last balanced brace, drop trailing commas).
 * 3. Synthesize a deterministic schema from the MSP's kept items.
 *
 * Always returns a sanitised JsonSchema — never throws on a model failure.
 */
function parseRefineResponse(text: string, keptItems: KeptItem[]): JsonSchema {
  const cleaned = stripFences(text);
  // Tier 1: strict
  try {
    return sanitiseSchema(JSON.parse(cleaned));
  } catch (e1) {
    console.warn("[architect_refine] strict parse failed:", String(e1).slice(0, 200));
  }
  // Tier 2: repair
  const repaired = tryRepairJson(cleaned);
  if (repaired) {
    try {
      return sanitiseSchema(repaired);
    } catch (e2) {
      console.warn("[architect_refine] repaired sanitise failed:", String(e2).slice(0, 200));
    }
  }
  // Tier 3: synthesize
  console.warn("[architect_refine] used_fallback_synthesis items=", keptItems.length);
  return synthesizeFallbackSchema(keptItems);
}

// ── Architect Turn 2: refine to schema ──────────────────────────────
interface KeptItem {
  key: string;
  title: string;
  desc?: string;
}

async function runArchitectRefine(
  apiKey: string,
  propDescr: string,
  docKind: string,
  keptItems: KeptItem[],
): Promise<{
  schema: JsonSchema;
  hidden_keys_added: string[];
  usage: GeminiResult["usage"];
}> {
  const system = `${ARCHITECT_MISSION}

You are the Property Template Architect (Turn 2: Final Schema).

Convert the user's KEPT field list into a strict JSON Schema (Draft-07):
{
  "type": "object",
  "properties": {
    "<snake_case_key>": { "type": "string|number|boolean", "description": "<short>" },
    ...
  },
  "required": ["...", "..."]
}

Rules:
- Every property MUST have a type from {string, number, boolean} and a non-empty description.
- Pick 2 to 5 essentials for the "required" array.
- Use the MSP-provided key names verbatim — do not rename.
- Output ONLY the JSON object, no prose, no markdown.`;

  const user = `Build a reusable mapper schema for this CLASS of property. Every required field must be a Source-of-Truth fact a visitor might ask about in the Ask AI chat.

Property class: "${propDescr}"
Doc kind: "${docKind}"

Kept fields (preserve every key):
${JSON.stringify(keptItems, null, 2)}`;

  const { text, usage } = await callGemini({
    apiKey,
    systemPrompt: system,
    userPrompt: user,
    thinkingBudget: -1, // dynamic — schema correctness matters
    maxOutputTokens: 8000, // bumped from 2000: 20+ kept fields can blow past 2K
    temperature: 0.1,
  });

  const sanitised = parseRefineResponse(text, keptItems);

  // Force MSP keys to be present even if Gemini dropped any.
  for (const it of keptItems) {
    if (!(it.key in sanitised.properties) && SNAKE.test(it.key)) {
      sanitised.properties[it.key] = {
        type: "string",
        description: it.desc || it.title,
      };
    }
  }

  const merged = mergeCanonicalKeys(sanitised, docKind);
  const validationErr = validateSchemaStrict(merged.schema);
  if (validationErr) {
    throw new Error(`schema_validation_failed:${validationErr}`);
  }
  return {
    schema: merged.schema,
    hidden_keys_added: merged.added,
    usage,
  };
}

// ── Handler ─────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "method_not_allowed" }, 405);
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  // Legacy secret name — actually holds the Gemini API key (AIza...).
  const GEMINI_API_KEY = Deno.env.get("GEMINI_PRIMARY_MODEL");

  if (!SUPABASE_URL || !ANON_KEY) {
    return jsonResponse({ error: "supabase_env_missing" }, 500);
  }
  if (!GEMINI_API_KEY) {
    return jsonResponse({ error: "gemini_key_missing" }, 500);
  }

  // Auth
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

  // Parse body
  let body: {
    pdf_b64?: string;
    mock_prompt?: string;
    mode?: string;
    prop_descr?: string;
    doc_kind?: string;
    kept_items?: KeptItem[];
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  // ── Architect Turn 1 ─────────────────────────────────────────────
  if (body.mode === "architect_draft") {
    const propDescr = (body.prop_descr ?? "").trim();
    if (propDescr.length < 4) {
      return jsonResponse({ error: "prop_descr_too_short" }, 400);
    }
    if (propDescr.length > 1000) {
      return jsonResponse({ error: "prop_descr_too_long" }, 400);
    }
    try {
      const out = await runArchitectDraft(GEMINI_API_KEY, propDescr);
      console.log("[architect_draft] usage", out.usage, "items", out.draft.length);
      return jsonResponse({ draft: out.draft, usage: out.usage });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[architect_draft] failed", msg);
      return jsonResponse({ error: "architect_draft_failed", detail: msg }, 502);
    }
  }

  // ── Architect Turn 2 ─────────────────────────────────────────────
  if (body.mode === "architect_refine") {
    const propDescr = (body.prop_descr ?? "").trim();
    const docKind = (body.doc_kind ?? "").trim();
    const kept = Array.isArray(body.kept_items) ? body.kept_items : [];
    if (propDescr.length < 4) {
      return jsonResponse({ error: "prop_descr_too_short" }, 400);
    }
    if (kept.length < 3) {
      return jsonResponse({ error: "kept_items_too_few", min: 3 }, 400);
    }
    if (kept.length > 60) {
      return jsonResponse({ error: "kept_items_too_many", max: 60 }, 400);
    }
    // Sanitise kept items
    const cleanKept: KeptItem[] = [];
    for (const it of kept) {
      if (!it || typeof it !== "object") continue;
      const k = String(it.key ?? "").trim();
      const t = String(it.title ?? "").trim();
      if (!SNAKE.test(k) || !t) continue;
      cleanKept.push({ key: k, title: t, desc: String(it.desc ?? "").slice(0, 200) });
    }
    if (cleanKept.length < 3) {
      return jsonResponse({ error: "kept_items_invalid" }, 400);
    }
    try {
      const out = await runArchitectRefine(
        GEMINI_API_KEY,
        propDescr,
        docKind,
        cleanKept,
      );
      console.log(
        "[architect_refine] usage",
        out.usage,
        "props",
        Object.keys(out.schema.properties).length,
        "added",
        out.hidden_keys_added,
      );
      return jsonResponse({
        schema: out.schema,
        hidden_keys_added: out.hidden_keys_added,
        usage: out.usage,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[architect_refine] failed", msg);
      return jsonResponse({ error: "architect_refine_failed", detail: msg }, 502);
    }
  }

  // ── Mock-prompt mode (text → schema) ─────────────────────────────
  if (body.mock_prompt) {
    const prompt = body.mock_prompt.trim();
    if (!prompt) return jsonResponse({ error: "empty_mock_prompt" }, 400);
    try {
      const { text, usage } = await callGemini({
        apiKey: GEMINI_API_KEY,
        systemPrompt: PDF_SYSTEM_PROMPT,
        userPrompt: prompt,
        thinkingBudget: -1,
        maxOutputTokens: 2000,
        temperature: 0.1,
      });
      const schema = sanitiseSchema(JSON.parse(stripFences(text)));
      if (Object.keys(schema.properties).length === 0) {
        return jsonResponse({ error: "no_fields_detected" }, 422);
      }
      console.log("[mock_prompt] usage", usage);
      return jsonResponse({ schema, text_preview: prompt.slice(0, 500) });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return jsonResponse({ error: "mock_prompt_failed", detail: msg }, 502);
    }
  }

  // ── PDF mode ─────────────────────────────────────────────────────
  if (!body.pdf_b64) {
    return jsonResponse({ error: "missing_pdf_b64_or_mock_prompt_or_mode" }, 400);
  }

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

  const truncated =
    fullText.length > MAX_TEXT_CHARS ? fullText.slice(0, MAX_TEXT_CHARS) : fullText;

  let schema: JsonSchema;
  try {
    const { text, usage } = await callGemini({
      apiKey: GEMINI_API_KEY,
      systemPrompt: PDF_SYSTEM_PROMPT,
      userPrompt: truncated,
      thinkingBudget: -1,
      maxOutputTokens: 2000,
      temperature: 0.1,
    });
    schema = sanitiseSchema(JSON.parse(stripFences(text)));
    console.log("[pdf_b64] usage", usage);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse(
      { error: "schema_parse_failed", detail: msg },
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
