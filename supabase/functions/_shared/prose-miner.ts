// Prose-Miner — deterministic pass-2 enricher for property extractions.
//
// Runs after the LLM (extract-url-content / groq-cleaner) has produced its
// `fields` blob. Walks the extracted chunks with hand-tuned regex patterns
// that rescue canonical real-estate facts the LLM may have missed in
// editorial-style prose ("the 1957-room hotel was built in 1985…").
//
// Idempotent: never overwrites a value already present in `existingFields`.
// Pure pattern matching — no network, no LLM cost.

import type { PropertyChunk } from "./extractors/types.ts";

export interface ProvenanceEntry {
  field: string;
  chunk_id: string;
  snippet: string;
}

export interface MineResult {
  /** Newly discovered fields (gap-fill only — never overwrites existing). */
  fields: Record<string, unknown>;
  /** One provenance entry per mined field, for source citations. */
  provenance: ProvenanceEntry[];
}

interface PatternSpec {
  field: string;
  pattern: RegExp;
  /** Convert the raw match (capture group `value`) to the stored value. */
  transform: (m: RegExpExecArray) => unknown;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function toNumber(s: string): number | null {
  const cleaned = s.replace(/[, ]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function moneyToNumber(amountStr: string, unit?: string): number | null {
  const base = toNumber(amountStr);
  if (base == null) return null;
  const u = (unit ?? "").toLowerCase();
  if (u.startsWith("b")) return base * 1_000_000_000;
  if (u.startsWith("m")) return base * 1_000_000;
  if (u.startsWith("k")) return base * 1_000;
  return base;
}

function snippetAround(text: string, idx: number, len: number, pad = 25): string {
  const start = Math.max(0, idx - pad);
  const end = Math.min(text.length, idx + len + pad);
  return text.slice(start, end).replace(/\s+/g, " ").trim().slice(0, 160);
}

// ── Pattern registry ─────────────────────────────────────────────────────────
//
// Order matters: more specific patterns first. Each pattern fires at most once
// per field across the entire document (first match wins).

const PATTERNS: PatternSpec[] = [
  // Hospitality / commercial
  {
    field: "number_of_rooms",
    pattern: /(\d{2,5})[\s,-]+(?:guest[\s-]+)?rooms?\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "number_of_suites",
    pattern: /(\d{1,4})[\s,-]+suites?\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "number_of_restaurants",
    pattern: /(\d{1,3})\s+(?:on[-\s]?site\s+)?restaurants?\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "meeting_space_sqft",
    pattern:
      /([\d,]{3,9})\s*(?:sq\.?\s*ft\.?|square\s+feet)[^.]{0,60}\bmeeting\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "ballroom_capacity",
    pattern: /\bballroom[^.]{0,60}?(\d{2,5})\s*(?:people|guests|seats|attendees)\b/i,
    transform: (m) => toNumber(m[1]),
  },

  // Structure
  {
    field: "stories",
    pattern: /\b(\d{1,3})[-\s]?(?:story|stories|storey|storeys)\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "floors",
    pattern: /\b(\d{1,3})\s+floors\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "year_built",
    pattern: /\b(?:built|constructed|opened|completed)\s+in\s+((?:19|20)\d{2})\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "year_renovated",
    pattern:
      /\b(?:renovated|refurbished|restored)\s+(?:in\s+)?((?:19|20)\d{2})\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "renovation_cost",
    pattern:
      /\$\s*([\d.,]+)\s*(million|m|billion|b|k)?\s+(?:renovation|refurbishment|restoration)\b/i,
    transform: (m) => moneyToNumber(m[1], m[2]),
  },

  // Residential
  {
    field: "bedrooms",
    pattern: /\b(\d{1,2})\s+(?:bed|bedroom|bedrooms|br)\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "bathrooms",
    pattern: /\b(\d{1,2}(?:\.\d)?)\s+(?:bath|bathroom|bathrooms|ba)\b/i,
    transform: (m) => {
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    },
  },
  {
    field: "square_feet",
    pattern: /([\d,]{3,9})\s*(?:sq\.?\s*ft\.?|square\s+feet)\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "parking_spaces",
    pattern: /(\d{1,5})\s+parking\s+spaces?\b/i,
    transform: (m) => toNumber(m[1]),
  },

  // People / parties
  {
    field: "architect",
    pattern: /\bdesigned\s+by\s+([A-Z][\w&.\-' ]{2,60}?)(?=[.,;:\n]|\s+(?:and|with|in|for)\s)/,
    transform: (m) => m[1].trim().replace(/\s+/g, " "),
  },
  {
    field: "developer",
    pattern: /\bdeveloped\s+by\s+([A-Z][\w&.\-' ]{2,60}?)(?=[.,;:\n]|\s+(?:and|with|in|for)\s)/,
    transform: (m) => m[1].trim().replace(/\s+/g, " "),
  },
];

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan `chunks` for canonical facts not already present in `existingFields`.
 *
 * - Walks chunks in array order; for each pattern, first match wins.
 * - Never overwrites a key already in `existingFields`.
 * - Returns mined fields plus a provenance trail (chunk id + ~160-char snippet)
 *   so the Ask AI synthesizer can cite sources.
 */
export function mineFromChunks(
  chunks: PropertyChunk[],
  existingFields: Record<string, unknown>,
): MineResult {
  const fields: Record<string, unknown> = {};
  const provenance: ProvenanceEntry[] = [];
  const claimed = new Set<string>(
    Object.keys(existingFields).filter(
      (k) => existingFields[k] != null && existingFields[k] !== "",
    ),
  );

  for (const spec of PATTERNS) {
    if (claimed.has(spec.field)) continue;

    for (const chunk of chunks) {
      const text = chunk.content ?? "";
      if (!text) continue;

      const m = spec.pattern.exec(text);
      if (!m) continue;

      const value = spec.transform(m);
      if (value == null || value === "" || (typeof value === "number" && !Number.isFinite(value))) {
        continue;
      }

      fields[spec.field] = value;
      provenance.push({
        field: spec.field,
        chunk_id: chunk.id,
        snippet: snippetAround(text, m.index, m[0].length),
      });
      claimed.add(spec.field);
      break; // first match wins — move to next pattern
    }
  }

  return { fields, provenance };
}
