// Groq Cleaning Pass — one-time LLM post-processing for property documents.
//
// Called by extract-property-doc immediately after the heuristic extractor
// runs. Sends the raw document text to Groq (Llama 3.1 70B) and asks it to:
//   1. Produce a structured fields JSON aligned to the canonical key set
//      recognised by canonical-questions.ts (list_price, bedrooms, …).
//   2. Divide the document into coherent thematic chunks (not sliding-window).
//
// On success the caller merges the cleaner's fields over the heuristic fields
// and replaces the heuristic chunks with thematic chunks. On any failure
// (network, rate-limit, malformed JSON) the function returns null and the
// caller transparently falls back to the heuristic result — no data loss.

import type { PropertyChunk } from "./extractors/types.ts";

export interface GroqCleanResult {
  fields: Record<string, unknown>;
  chunks: PropertyChunk[];
  model: string;
}

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-70b-versatile";
const MAX_TEXT_CHARS = 12_000;
const CALL_TIMEOUT_MS = 30_000;

const SYSTEM_PROMPT = `You are a real estate data extraction specialist. Given raw text from a property document, extract structured data and organise the content into coherent thematic sections.

Return a JSON object with exactly two top-level keys:

"fields": an object mapping field names to scalar values. Use these standard keys whenever the concept is present in the document:
  property_address, list_price, sale_price, purchase_price, square_feet,
  living_area, bedrooms, bathrooms, half_baths, year_built, lot_size,
  hoa_fee, property_taxes, garage, parking_spaces, stories, property_type,
  listing_date, closing_date
Use lowercase snake_case for any additional custom fields. Omit fields that are not mentioned in the document. Financial values must be numbers (no currency symbols or commas).

"chunks": an array of objects each with the shape:
  { "id": string, "section": string, "content": string }
Each chunk represents one coherent thematic section (e.g. "Property Overview",
"Bedrooms & Bathrooms", "Financial Details", "Location & Schools", "Features &
Amenities"). Keep each chunk to 300–700 words. Produce 3–8 chunks total. Do
not duplicate content across chunks. Content must be verbatim or lightly
paraphrased from the source document — never invent facts.

Output ONLY valid JSON. No markdown fences, no extra text.`;

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

/**
 * Run the Groq Cleaning Pass on `rawText`.
 * Returns null on any failure so callers can fall back gracefully.
 */
export async function groqClean(
  rawText: string,
  docKind: string,
  apiKey: string,
): Promise<GroqCleanResult | null> {
  const truncated =
    rawText.length > MAX_TEXT_CHARS ? rawText.slice(0, MAX_TEXT_CHARS) : rawText;

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
              { role: "system", content: SYSTEM_PROMPT },
              {
                role: "user",
                content: `Document type: ${docKind}\n\n---\n${truncated}`,
              },
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
        continue; // retry after backoff
      }
      if (!resp.ok) {
        lastErr = `http_${resp.status}`;
        break; // non-retryable error
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
        chunks?: Array<{ id?: string; section?: string; content?: string }>;
      };

      const fields: Record<string, unknown> =
        typeof parsed.fields === "object" && parsed.fields !== null
          ? parsed.fields
          : {};

      const chunks: PropertyChunk[] = Array.isArray(parsed.chunks)
        ? parsed.chunks
            .filter((c) => typeof c.content === "string" && c.content.trim())
            .map((c, i) => ({
              id: String(c.id ?? `${docKind}-groq-${i}`),
              section: String(c.section ?? "Section"),
              content: String(c.content).slice(0, 2_000).trim(),
            }))
        : [];

      if (chunks.length === 0) {
        lastErr = "no_chunks_in_response";
        break;
      }

      return { fields, chunks, model: GROQ_MODEL };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }

  console.warn(`[groq-cleaner] Failed after retries: ${lastErr}`);
  return null;
}
