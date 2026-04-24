// Groq Cleaning Pass — one-time LLM post-processing for property documents.
//
// Called by extract-property-doc immediately after the heuristic extractor
// runs. Sends the raw document text to Groq (Llama 3.1 70B) and asks it to:
//   1. Produce a structured fields JSON aligned to the template's field_schema
//      (MSP-defined canonical + custom fields). Falls back to the built-in
//      canonical key set when no schema is provided.
//   2. Divide the document into coherent thematic sections using doc_kind-aware
//      section names (not the generic sliding-window chunks from pdfjs).
//
// On success the caller merges the cleaner's fields over the heuristic fields
// and replaces the heuristic chunks with thematic chunks. On any failure
// (network, rate-limit, malformed JSON) the function returns null and the
// caller transparently falls back to the heuristic result — no data loss.

import type { JsonSchema, PropertyChunk } from "./extractors/types.ts";

export interface GroqCandidate {
  key: string;
  value: unknown;
  confidence: number;
  evidence?: string;
}

export interface GroqCleanResult {
  fields: Record<string, unknown>;
  candidates: GroqCandidate[];
  chunks: PropertyChunk[];
  model: string;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-70b-versatile";
const MAX_TEXT_CHARS = 12_000;
const CALL_TIMEOUT_MS = 30_000;

// ── Section hints keyed by doc_kind ──────────────────────────────────────────

const SECTION_HINTS: Record<string, string[]> = {
  residential_mls: [
    "Property Overview",
    "Room Details",
    "Financial & HOA",
    "Location & Schools",
    "Features & Amenities",
    "Agent Notes",
  ],
  commercial_lease: [
    "Lease Terms",
    "Tenant Rights",
    "Financials",
    "Property Specs",
    "Special Clauses",
    "Parties & Contacts",
  ],
  luxury_property: [
    "Estate Overview",
    "Architectural Features",
    "Interior Details",
    "Grounds & Amenities",
    "Market Positioning",
    "Location & Privacy",
  ],
  land: [
    "Parcel Overview",
    "Zoning & Use",
    "Utilities & Access",
    "Survey & Boundaries",
    "Financials",
    "Environmental",
  ],
  condo: [
    "Unit Overview",
    "Building & Common Areas",
    "HOA Details",
    "Financials",
    "Location",
    "Rules & Restrictions",
  ],
};

const FALLBACK_SECTIONS = [
  "Property Overview",
  "Features & Amenities",
  "Financial Details",
  "Location",
  "Additional Information",
];

const FALLBACK_FIELDS = [
  "property_address", "list_price", "sale_price", "square_feet",
  "bedrooms", "bathrooms", "year_built", "hoa_fee", "property_taxes",
  "garage", "parking_spaces", "stories", "property_type",
  "listing_date", "closing_date",
];

// ── Dynamic prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(docKind: string, fieldSchema?: JsonSchema): string {
  // Fields extraction guidance — template-aware when schema is present.
  let fieldsSection: string;

  if (fieldSchema && Object.keys(fieldSchema.properties ?? {}).length > 0) {
    const required = new Set(fieldSchema.required ?? []);
    const lines = Object.entries(fieldSchema.properties).map(([name, f]) => {
      const req = required.has(name) ? " [REQUIRED]" : "";
      const desc = f.description ? `: ${f.description}` : "";
      return `  ${name} (${f.type})${desc}${req}`;
    });
    fieldsSection =
      `The provider has defined the following extraction targets for this ${docKind} document.\n` +
      `Extract ALL fields listed below when present. Use exactly these key names.\n` +
      lines.join("\n") + "\n\n" +
      `Financial values must be numbers (no currency symbols or commas). ` +
      `Omit absent fields. For data in the document not covered above, ` +
      `use lowercase_snake_case additional keys.`;
  } else {
    fieldsSection =
      `Use these standard keys whenever the concept is present:\n  ` +
      FALLBACK_FIELDS.join(", ") + "\n" +
      `Financial values must be numbers. Omit absent fields. ` +
      `Use lowercase_snake_case for any additional custom fields.`;
  }

  // Chunk section names — doc_kind-aware with generic fallback.
  const hints = SECTION_HINTS[docKind] ?? FALLBACK_SECTIONS;
  const sectionsSection =
    `Divide the document into coherent thematic sections. ` +
    `Preferred section names for a ${docKind} document: ` +
    hints.map((s) => `"${s}"`).join(", ") + ". " +
    `Adapt section names when the document's content suggests a better fit. ` +
    `Keep each chunk 300–700 words. Produce 3–8 chunks total. ` +
    `Do not duplicate content across chunks. ` +
    `Content must be verbatim or lightly paraphrased — never invent facts.`;

  return (
    `You are a real estate data extraction specialist. Given raw text from a ` +
    `property document, extract structured data and organise the content ` +
    `into coherent thematic sections.\n\n` +
    fieldsSection + "\n\n" +
    sectionsSection + "\n\n" +
    `Return a JSON object with exactly THREE top-level keys:\n` +
    `  "fields": object of HIGH-confidence facts (canonical or schema-defined keys above)\n` +
    `  "candidates": array of medium-confidence or non-canonical facts you find. Each item:\n` +
    `      { "key": "<lowercase_snake_case>", "value": <scalar>, "confidence": 0.0-1.0,\n` +
    `        "evidence": "<≤120 char source quote>" }\n` +
    `      Aim for 5–25 candidates when content permits (amenities, design notes,\n` +
    `      neighborhood descriptors, brand affiliations, sustainability, etc.)\n` +
    `  "chunks": array of { "id": string, "section": string, "content": string }\n\n` +
    `Output ONLY valid JSON. No markdown fences, no extra text. ` +
    `NEVER invent facts — every entry must be supported by the source text.`
  );
}

// ── Utilities ─────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`groq-cleaner: timed out after ${ms}ms`)), ms)
    ),
  ]);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the Groq Cleaning Pass on `rawText`, guided by the MSP's template.
 *
 * `template.field_schema` is injected into the system prompt so that
 * provider-defined custom fields (e.g. school_district, flood_zone) are
 * explicitly targeted by the LLM, not just the generic canonical key set.
 *
 * Returns null on any failure so callers can fall back gracefully.
 */
export async function groqClean(
  rawText: string,
  template: { doc_kind: string; field_schema?: JsonSchema },
  apiKey: string,
): Promise<GroqCleanResult | null> {
  const truncated =
    rawText.length > MAX_TEXT_CHARS ? rawText.slice(0, MAX_TEXT_CHARS) : rawText;

  const systemPrompt = buildSystemPrompt(template.doc_kind, template.field_schema);

  let lastErr = "";

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(3_000 * attempt);

    try {
      const resp = await withTimeout(
        fetch(GROQ_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: truncated },
            ],
            temperature: 0.1,
            max_tokens: 4_000,
            response_format: { type: "json_object" },
          }),
        }),
        CALL_TIMEOUT_MS,
      );

      if (resp.status === 429) {
        lastErr = "rate_limited";
        continue;
      }
      if (!resp.ok) {
        lastErr = `http_${resp.status}`;
        break;
      }

      const completion = (await resp.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      const raw = completion.choices?.[0]?.message?.content ?? "";

      // Strip markdown fences the model might emit despite the prompt.
      const jsonText = raw
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```\s*$/, "")
        .trim();

      const parsed = JSON.parse(jsonText) as {
        fields?: Record<string, unknown>;
        candidates?: Array<{ key?: string; value?: unknown; confidence?: number; evidence?: string }>;
        chunks?: Array<{ id?: string; section?: string; content?: string }>;
      };

      const fields: Record<string, unknown> =
        typeof parsed.fields === "object" && parsed.fields !== null
          ? parsed.fields
          : {};

      const candidates: GroqCandidate[] = Array.isArray(parsed.candidates)
        ? parsed.candidates
            .filter((c) => c && typeof c.key === "string" && c.value != null && c.value !== "")
            .map((c) => ({
              key: String(c.key).trim(),
              value: c.value,
              confidence: typeof c.confidence === "number" ? c.confidence : 0,
              evidence: typeof c.evidence === "string" ? c.evidence.slice(0, 240) : undefined,
            }))
            .filter((c) => /^[a-z][a-z0-9_]*$/.test(c.key) && c.confidence >= 0.55)
        : [];

      const chunks: PropertyChunk[] = Array.isArray(parsed.chunks)
        ? parsed.chunks
            .filter((c) => typeof c.content === "string" && c.content.trim())
            .map((c, i) => ({
              id: String(c.id ?? `${template.doc_kind}-groq-${i}`),
              section: String(c.section ?? "Section"),
              content: String(c.content).slice(0, 2_000).trim(),
            }))
        : [];

      if (chunks.length === 0) {
        lastErr = "no_chunks_in_response";
        break;
      }

      return { fields, candidates, chunks, model: GROQ_MODEL };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  console.warn(`[groq-cleaner] Failed after retries: ${lastErr}`);
  return null;
}
