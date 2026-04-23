/**
 * Rule-based canonical question/answer generator.
 *
 * Phase 5 of the doc-QA engine elides the runtime LLM call entirely.
 * At build time we walk each extracted row's `fields` object and, for
 * every field present, emit a handful of natural-language question
 * phrasings + a templated answer. Those pairs are embedded (alongside
 * the chunks) in the same worker pass and persisted to
 * `property_extractions.canonical_qas`. At view time the runtime
 * encodes the viewer's question, does cosine against these canonical
 * embeddings, and — on a high-confidence hit — returns the templated
 * answer deterministically. Zero ML at run time, zero cost per view.
 *
 * The util is schema-agnostic: MSPs author their own templates and we
 * cannot enumerate field names up-front. A small curated list carries
 * richer phrasings for common fields; everything else falls back to a
 * SCHEMA-AWARE generator that tokenizes the field name and emits 8–12
 * natural phrasings (Phase A optimization #1) so unknown MSP fields
 * still cross the runtime cosine threshold for typical viewer queries.
 */

// ── Types ───────────────────────────────────────────────────────────

export interface CanonicalQA {
  /** Stable id: "field:<field_name>:<variant_idx>". */
  id: string;
  /** The source field this Q&A pair is derived from. */
  field: string;
  question: string;
  answer: string;
  /** Anchor target for the source-link UI. Always "field:<field_name>". */
  source_anchor_id: string;
}

export interface EmbeddedCanonicalQA extends CanonicalQA {
  embedding: number[];
}

type FieldValue = string | number | boolean | null | undefined;

interface Template {
  /** Phrasings to generate, substituting {label} with humanized field name. */
  questions: string[];
  /** Answer sentence; {value} is the formatted value, {label} the humanized name. */
  answerTemplate: string;
  /** How to format the value. Defaults to auto (currency if field name hints). */
  format?: "currency" | "number" | "year" | "raw";
}

// ── Curated templates for common real-estate fields ─────────────────

const TEMPLATES: Record<string, Template> = {
  purchase_price: {
    questions: [
      "What's the price?",
      "How much does it cost?",
      "What's the asking price?",
      "What's the purchase price?",
      "How much are they asking?",
      "How much is it?",
      "What does it cost?",
      "Price?",
    ],
    answerTemplate: "The purchase price is {value}.",
    format: "currency",
  },
  sale_price: {
    questions: [
      "What's the sale price?",
      "How much did it sell for?",
      "What's the price?",
      "How much is it?",
      "What did it go for?",
    ],
    answerTemplate: "The sale price is {value}.",
    format: "currency",
  },
  list_price: {
    questions: [
      "What's the list price?",
      "What's the listing price?",
      "How much is it listed at?",
      "What's the asking price?",
      "How much?",
    ],
    answerTemplate: "The list price is {value}.",
    format: "currency",
  },
  square_feet: {
    questions: [
      "How big is it?",
      "What's the square footage?",
      "How many square feet?",
      "What's the size?",
      "How large is it?",
      "Total square feet?",
      "Sqft?",
    ],
    answerTemplate: "It has {value} square feet.",
    format: "number",
  },
  sqft: {
    questions: ["How big is it?", "What's the square footage?", "How many square feet?", "Sqft?", "What's the size?"],
    answerTemplate: "It has {value} square feet.",
    format: "number",
  },
  living_area: {
    questions: ["What's the living area?", "How big is the living space?", "Living square feet?", "How much living space?"],
    answerTemplate: "The living area is {value} square feet.",
    format: "number",
  },
  bedrooms: {
    questions: [
      "How many bedrooms?",
      "How many beds?",
      "How many bedrooms does it have?",
      "Bedroom count?",
      "Number of bedrooms?",
      "Beds?",
    ],
    answerTemplate: "It has {value} bedrooms.",
  },
  beds: {
    questions: ["How many beds?", "How many bedrooms?", "Bed count?", "Beds?"],
    answerTemplate: "It has {value} beds.",
  },
  bathrooms: {
    questions: [
      "How many bathrooms?",
      "How many baths?",
      "How many bathrooms does it have?",
      "Bathroom count?",
      "Number of bathrooms?",
      "Baths?",
    ],
    answerTemplate: "It has {value} bathrooms.",
  },
  baths: {
    questions: ["How many baths?", "How many bathrooms?", "Bath count?"],
    answerTemplate: "It has {value} baths.",
  },
  half_baths: {
    questions: ["How many half baths?", "Are there half bathrooms?", "Half bath count?", "Powder rooms?"],
    answerTemplate: "It has {value} half baths.",
  },
  year_built: {
    questions: [
      "When was it built?",
      "What year was it built?",
      "How old is it?",
      "Year of construction?",
      "When was it constructed?",
      "Build year?",
    ],
    answerTemplate: "It was built in {value}.",
    format: "year",
  },
  address: {
    questions: [
      "What's the address?",
      "Where is it located?",
      "Where is the property?",
      "Where is it?",
      "What's the location?",
      "Street address?",
    ],
    answerTemplate: "The property is located at {value}.",
    format: "raw",
  },
  property_address: {
    questions: ["What's the property address?", "What's the address?", "Where is it?", "Where is it located?"],
    answerTemplate: "The property is located at {value}.",
    format: "raw",
  },
  lot_size: {
    questions: ["How big is the lot?", "What's the lot size?", "What size is the land?", "How much land?", "Acreage?"],
    answerTemplate: "The lot size is {value}.",
    format: "raw",
  },
  hoa_fee: {
    questions: ["What are the HOA fees?", "Is there an HOA?", "How much is the HOA?", "HOA cost?", "Monthly HOA?"],
    answerTemplate: "The HOA fee is {value}.",
    format: "currency",
  },
  hoa_fees: {
    questions: ["What are the HOA fees?", "How much are the HOA fees?", "HOA cost?", "Is there an HOA?"],
    answerTemplate: "The HOA fees are {value}.",
    format: "currency",
  },
  property_taxes: {
    questions: [
      "What are the property taxes?",
      "How much are the taxes?",
      "What do the taxes cost?",
      "Annual property tax?",
      "Tax amount?",
    ],
    answerTemplate: "The property taxes are {value} per year.",
    format: "currency",
  },
  annual_taxes: {
    questions: ["What are the annual taxes?", "How much are property taxes?", "Tax bill?", "Yearly taxes?"],
    answerTemplate: "The annual taxes are {value}.",
    format: "currency",
  },
  taxes: {
    questions: ["What are the taxes?", "How much are the taxes?", "Tax amount?", "Annual taxes?"],
    answerTemplate: "The taxes are {value}.",
    format: "currency",
  },
  parking_spaces: {
    questions: ["How many parking spaces?", "Is there parking?", "How much parking?", "Parking count?", "Number of parking spaces?"],
    answerTemplate: "There are {value} parking spaces.",
    format: "number",
  },
  garage: {
    questions: ["Is there a garage?", "How big is the garage?", "Garage size?", "Garage details?"],
    answerTemplate: "The garage is {value}.",
    format: "raw",
  },
  stories: {
    questions: ["How many stories?", "How many floors?", "How many levels?", "Story count?", "Number of floors?"],
    answerTemplate: "It has {value} stories.",
  },
  property_type: {
    questions: ["What type of property is it?", "What kind of property is this?", "Property type?", "What is it?"],
    answerTemplate: "It's a {value}.",
    format: "raw",
  },
  closing_date: {
    questions: ["When's the closing date?", "When does it close?", "Closing?", "Close date?"],
    answerTemplate: "The closing date is {value}.",
    format: "raw",
  },
  listing_date: {
    questions: ["When was it listed?", "When did it hit the market?", "List date?", "When was it put on the market?"],
    answerTemplate: "It was listed on {value}.",
    format: "raw",
  },
};

// ── Value formatting ────────────────────────────────────────────────

function formatValue(raw: FieldValue, format: Template["format"], fieldName: string): string {
  if (raw == null) return "";
  const effectiveFormat = format ?? inferFormat(fieldName, raw);

  switch (effectiveFormat) {
    case "currency":
      return formatCurrency(raw);
    case "number":
      return formatNumber(raw);
    case "year":
      return String(raw).replace(/[^\d]/g, "");
    case "raw":
    default:
      return String(raw);
  }
}

function inferFormat(fieldName: string, raw: FieldValue): Template["format"] {
  const lower = fieldName.toLowerCase();
  if (typeof raw === "number") {
    if (/price|cost|fee|tax|payment|rent|value/.test(lower)) return "currency";
    if (/year|built|since/.test(lower)) return "year";
    return "number";
  }
  return "raw";
}

function formatCurrency(v: FieldValue): string {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,$\s]/g, ""));
  if (!Number.isFinite(n)) return String(v);
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatNumber(v: FieldValue): string {
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US");
}

// ── Field name humanization ─────────────────────────────────────────

function humanizeLabel(field: string): string {
  return field
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

/** Tokenize a snake_case / camelCase field name into lowercase words. */
function tokenizeField(field: string): string[] {
  return field
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

// Stop-tokens we strip when extracting the "subject noun" of a field name.
// e.g. "number_of_rooms" → subject = "rooms"; "total_square_feet" → "square feet".
const STOP_TOKENS = new Set([
  "number",
  "num",
  "no",
  "count",
  "total",
  "amount",
  "qty",
  "quantity",
  "of",
  "the",
  "a",
  "an",
  "is",
  "are",
  "has",
  "have",
]);

// English-ish singularization for the subject noun. Only handles the most
// common patterns — we deliberately keep this simple (no morphological
// analyzer) because canonical phrasings are paraphrased, not parsed.
function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes") || word.endsWith("ches") || word.endsWith("shes")) {
    return word.slice(0, -2);
  }
  if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Extract the "subject" of a field name — the meaningful noun(s) after
 * stripping count/total/of stop-tokens. Returns both plural and singular
 * forms so phrasings can choose either ("how many rooms" vs "room count").
 */
function extractSubject(field: string): { plural: string; singular: string; tokens: string[] } {
  const tokens = tokenizeField(field);
  const meaningful = tokens.filter((t) => !STOP_TOKENS.has(t));
  const plural = (meaningful.length > 0 ? meaningful : tokens).join(" ");
  const singularTokens = (meaningful.length > 0 ? meaningful : tokens).map((t, i, arr) =>
    i === arr.length - 1 ? singularize(t) : t,
  );
  const singular = singularTokens.join(" ");
  return { plural, singular, tokens };
}

// ── Main entry point ────────────────────────────────────────────────

/**
 * Generate canonical Q&A pairs from a typed `fields` record.
 * Skips entries whose value is null / undefined / empty string.
 * Unknown field names fall back to a schema-aware generator that emits
 * 8–12 natural phrasings derived from the field name's tokens, so
 * MSP-defined fields like `number_of_rooms` get covered without manual
 * curation (Phase A optimization #1).
 */
export function buildCanonicalQAs(fields: Record<string, unknown>): CanonicalQA[] {
  const out: CanonicalQA[] = [];

  for (const [field, rawValue] of Object.entries(fields ?? {})) {
    const value = rawValue as FieldValue;
    if (value == null || value === "") continue;
    // Objects / arrays aren't answerable via a simple template.
    if (typeof value === "object") continue;

    const template = TEMPLATES[field.toLowerCase()] ?? buildGenericTemplate(field);
    const label = humanizeLabel(field);
    const valueStr = formatValue(value, template.format, field);
    if (!valueStr) continue;

    const answer = template.answerTemplate
      .replace(/\{value\}/g, valueStr)
      .replace(/\{label\}/g, label);

    // De-dupe phrasings inside a single field (curated + generic can overlap).
    const seen = new Set<string>();
    template.questions.forEach((qTemplate, idx) => {
      const question = qTemplate.replace(/\{label\}/g, label).trim();
      const key = question.toLowerCase();
      if (!question || seen.has(key)) return;
      seen.add(key);
      out.push({
        id: `field:${field}:${idx}`,
        field,
        question,
        answer,
        source_anchor_id: `field:${field}`,
      });
    });
  }

  return out;
}

/**
 * Schema-aware fallback for unknown field names. Looks at the field
 * name's tokens, isolates the subject noun, and emits 8–12 phrasings
 * spanning the most common natural ways a viewer would ask about a
 * count, identity, or attribute. Intentionally over-generates — MiniLM
 * cosine handles the dedupe at runtime via top-1 selection.
 */
function buildGenericTemplate(field: string): Template {
  const label = humanizeLabel(field);
  const { plural, singular, tokens } = extractSubject(field);
  const fieldLower = field.toLowerCase();

  // Detect intent from the tokens: count-like → "how many", presence-like
  // → "is there a", value-like → "what is the".
  const isCount =
    tokens.includes("number") ||
    tokens.includes("count") ||
    tokens.includes("total") ||
    tokens.includes("qty") ||
    tokens.includes("quantity") ||
    /^(num_|no_|n_)/.test(fieldLower);

  const isYear = tokens.includes("year") || tokens.includes("built");
  const isDate = tokens.includes("date") || tokens.includes("when");
  const isPrice =
    tokens.includes("price") ||
    tokens.includes("cost") ||
    tokens.includes("fee") ||
    tokens.includes("rate") ||
    tokens.includes("rent") ||
    tokens.includes("payment");
  const isSize =
    tokens.includes("size") ||
    tokens.includes("area") ||
    tokens.includes("sqft") ||
    tokens.includes("footage") ||
    tokens.includes("square");

  const questions: string[] = [];
  let format: Template["format"] | undefined;
  let answerTemplate = `The ${label} is {value}.`;

  if (isCount) {
    // "number_of_rooms" → subject "rooms" → "how many rooms"
    questions.push(
      `How many ${plural}?`,
      `How many ${plural} are there?`,
      `What is the ${plural} count?`,
      `What's the ${plural} count?`,
      `${plural.charAt(0).toUpperCase() + plural.slice(1)} count?`,
      `Number of ${plural}?`,
      `How many ${plural} does it have?`,
      `Total ${plural}?`,
      `${singular.charAt(0).toUpperCase() + singular.slice(1)} count?`,
      `How many ${singular}?`,
    );
    answerTemplate = `It has {value} ${plural}.`;
    format = "number";
  } else if (isYear) {
    questions.push(
      `What year ${label}?`,
      `When ${label}?`,
      `What's the ${label}?`,
      `${label.charAt(0).toUpperCase() + label.slice(1)}?`,
      `Tell me the ${label}.`,
      `What is the ${label}?`,
    );
    answerTemplate = `The ${label} is {value}.`;
    format = "year";
  } else if (isDate) {
    questions.push(
      `When is the ${label}?`,
      `What's the ${label}?`,
      `What is the ${label}?`,
      `${label.charAt(0).toUpperCase() + label.slice(1)}?`,
      `Tell me the ${label}.`,
    );
  } else if (isPrice) {
    questions.push(
      `What's the ${label}?`,
      `How much is the ${label}?`,
      `How much does the ${label} cost?`,
      `${label.charAt(0).toUpperCase() + label.slice(1)}?`,
      `Cost of ${plural}?`,
      `What is the ${label}?`,
      `Tell me the ${label}.`,
    );
    answerTemplate = `The ${label} is {value}.`;
    format = "currency";
  } else if (isSize) {
    questions.push(
      `What's the ${label}?`,
      `How big is the ${plural}?`,
      `What is the ${label}?`,
      `${label.charAt(0).toUpperCase() + label.slice(1)}?`,
      `Tell me the ${label}.`,
      `Size of ${plural}?`,
    );
    answerTemplate = `The ${label} is {value}.`;
    format = "number";
  } else {
    // Generic: identity / attribute lookup.
    questions.push(
      `What is the ${label}?`,
      `What's the ${label}?`,
      `Tell me about the ${label}.`,
      `Tell me the ${label}.`,
      `${label.charAt(0).toUpperCase() + label.slice(1)}?`,
      `What ${label}?`,
      `Do you know the ${label}?`,
      `What is ${plural}?`,
    );
  }

  return {
    questions,
    answerTemplate,
    format,
  };
}

/**
 * Extract the texts that should be embedded for a set of canonical QAs.
 * The runtime matches on the question text, so that's what we embed.
 * Keeping this separate from `buildCanonicalQAs` lets the caller batch
 * chunks + QA questions into a single worker pass.
 */
export function canonicalQuestionTexts(qas: CanonicalQA[]): string[] {
  return qas.map((q) => q.question);
}
