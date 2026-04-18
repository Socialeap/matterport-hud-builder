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
 * generic "What is the {label}?" template derived from the field name.
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
    ],
    answerTemplate: "The purchase price is {value}.",
    format: "currency",
  },
  sale_price: {
    questions: [
      "What's the sale price?",
      "How much did it sell for?",
      "What's the price?",
    ],
    answerTemplate: "The sale price is {value}.",
    format: "currency",
  },
  list_price: {
    questions: ["What's the list price?", "What's the listing price?", "How much is it listed at?"],
    answerTemplate: "The list price is {value}.",
    format: "currency",
  },
  square_feet: {
    questions: [
      "How big is it?",
      "What's the square footage?",
      "How many square feet?",
      "What's the size?",
    ],
    answerTemplate: "It has {value} square feet.",
    format: "number",
  },
  sqft: {
    questions: ["How big is it?", "What's the square footage?", "How many square feet?"],
    answerTemplate: "It has {value} square feet.",
    format: "number",
  },
  living_area: {
    questions: ["What's the living area?", "How big is the living space?"],
    answerTemplate: "The living area is {value} square feet.",
    format: "number",
  },
  bedrooms: {
    questions: ["How many bedrooms?", "How many beds?", "How many bedrooms does it have?"],
    answerTemplate: "It has {value} bedrooms.",
  },
  beds: {
    questions: ["How many beds?", "How many bedrooms?"],
    answerTemplate: "It has {value} beds.",
  },
  bathrooms: {
    questions: ["How many bathrooms?", "How many baths?", "How many bathrooms does it have?"],
    answerTemplate: "It has {value} bathrooms.",
  },
  baths: {
    questions: ["How many baths?", "How many bathrooms?"],
    answerTemplate: "It has {value} baths.",
  },
  half_baths: {
    questions: ["How many half baths?", "Are there half bathrooms?"],
    answerTemplate: "It has {value} half baths.",
  },
  year_built: {
    questions: ["When was it built?", "What year was it built?", "How old is it?"],
    answerTemplate: "It was built in {value}.",
    format: "year",
  },
  address: {
    questions: ["What's the address?", "Where is it located?", "Where is the property?"],
    answerTemplate: "The property is located at {value}.",
    format: "raw",
  },
  property_address: {
    questions: ["What's the property address?", "What's the address?", "Where is it?"],
    answerTemplate: "The property is located at {value}.",
    format: "raw",
  },
  lot_size: {
    questions: ["How big is the lot?", "What's the lot size?", "What size is the land?"],
    answerTemplate: "The lot size is {value}.",
    format: "raw",
  },
  hoa_fee: {
    questions: ["What are the HOA fees?", "Is there an HOA?", "How much is the HOA?"],
    answerTemplate: "The HOA fee is {value}.",
    format: "currency",
  },
  hoa_fees: {
    questions: ["What are the HOA fees?", "How much are the HOA fees?"],
    answerTemplate: "The HOA fees are {value}.",
    format: "currency",
  },
  property_taxes: {
    questions: ["What are the property taxes?", "How much are the taxes?", "What do the taxes cost?"],
    answerTemplate: "The property taxes are {value} per year.",
    format: "currency",
  },
  annual_taxes: {
    questions: ["What are the annual taxes?", "How much are property taxes?"],
    answerTemplate: "The annual taxes are {value}.",
    format: "currency",
  },
  taxes: {
    questions: ["What are the taxes?", "How much are the taxes?"],
    answerTemplate: "The taxes are {value}.",
    format: "currency",
  },
  parking_spaces: {
    questions: ["How many parking spaces?", "Is there parking?", "How much parking?"],
    answerTemplate: "There are {value} parking spaces.",
    format: "number",
  },
  garage: {
    questions: ["Is there a garage?", "How big is the garage?"],
    answerTemplate: "The garage is {value}.",
    format: "raw",
  },
  stories: {
    questions: ["How many stories?", "How many floors?"],
    answerTemplate: "It has {value} stories.",
  },
  property_type: {
    questions: ["What type of property is it?", "What kind of property is this?"],
    answerTemplate: "It's a {value}.",
    format: "raw",
  },
  closing_date: {
    questions: ["When's the closing date?", "When does it close?"],
    answerTemplate: "The closing date is {value}.",
    format: "raw",
  },
  listing_date: {
    questions: ["When was it listed?", "When did it hit the market?"],
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

// ── Main entry point ────────────────────────────────────────────────

/**
 * Generate canonical Q&A pairs from a typed `fields` record.
 * Skips entries whose value is null / undefined / empty string.
 * Unknown field names fall back to a generic "What is the {label}?"
 * template so custom MSP templates still get coverage.
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

    template.questions.forEach((qTemplate, idx) => {
      const question = qTemplate.replace(/\{label\}/g, label);
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

function buildGenericTemplate(field: string): Template {
  const label = humanizeLabel(field);
  return {
    questions: [
      `What is the ${label}?`,
      `What's the ${label}?`,
      `Tell me about the ${label}.`,
    ],
    answerTemplate: `The ${label} is {value}.`,
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
