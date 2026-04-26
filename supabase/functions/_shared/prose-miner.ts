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

function wordOrNumberToNumber(s: string): number | null {
  const direct = toNumber(s);
  if (direct != null) return direct;
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  return words[s.toLowerCase()] ?? null;
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
  // Venue / event property facts
  {
    field: "property_size_acres",
    pattern: /\b(\d{1,5}(?:\.\d+)?)\s*[-\s]?acre(?:s)?\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "operating_season",
    pattern: /\bopen seasonally from\s+(.{8,120}?)(?=\.|\s*\[)/i,
    transform: (m) => m[1].trim().replace(/\s+/g, " "),
  },
  {
    field: "property_address",
    pattern: /\b(\d{1,6}\s+[A-Z][A-Za-z0-9 .'-]+?\s+[A-Z][A-Za-z .'-]+,\s*[A-Z]{2},?\s*\d{5})\b/,
    transform: (m) => m[1].trim().replace(/\s+/g, " "),
  },
  {
    field: "ceremony_deck_capacity",
    pattern: /\bCeremony Deck:[^.]*?\b(?:up to|for)\s+(\d{2,5})\s+guests?\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "reception_pavilion_square_feet",
    pattern: /\bReception Pavilion:\s*(?:A\s+)?([\d,]{3,9})\s*sq\.?\s*ft\.?/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "reception_pavilion_capacity",
    pattern: /\bReception Pavilion:[^.]*?\baccommodat(?:ing|es?)\s+up\s+to\s+(\d{2,5})\s+(?:seated\s+)?guests?\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "venue_minimum_guests",
    pattern: /\bminimum\s+of\s+(\d{1,5})\s+guests?\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "venue_max_capacity",
    pattern: /\b(?:maximum\s+of|holds?\s+a\s+maximum\s+of)\s+(\d{2,5})\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "lodging_capacity",
    pattern: /\baccommodations?\s+for\s+up\s+to\s+(\d{1,5})\s+guests?\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "cabin_count",
    pattern: /\bCabins:\s*(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+guest\s+cabins?\b/i,
    transform: (m) => wordOrNumberToNumber(m[1]),
  },
  {
    field: "glamping_tent_count",
    pattern: /\bGlamping:\s*(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+safari[-\s]+style\s+glamping\s+tents?\b/i,
    transform: (m) => wordOrNumberToNumber(m[1]),
  },
  {
    field: "dining_description",
    pattern: /\bDining:\s*([^.]{20,220}\.)/i,
    transform: (m) => m[1].trim().replace(/\s+/g, " "),
  },
  {
    field: "on_site_catering",
    pattern: /\bIn[-\s]?House Catering:\s*([^.]{20,220}\.)/i,
    transform: (m) => m[1].trim().replace(/\s+/g, " "),
  },
  {
    field: "catering_cost_per_person",
    pattern: /\bCatering:[^.]*?\bstarts?\s+at\s+\$([\d,]+)\s+per\s+person\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "bar_service_cost_range",
    pattern: /\bBar Service:[^.]*?\brange\s+from\s+approximately\s+\$([\d,]+)\s+to\s+\$([\d,]+)\s+per\s+person\b/i,
    transform: (m) => `$${m[1]} to $${m[2]} per person`,
  },
  {
    field: "site_fee_starting",
    pattern: /\bsite fees?\s+start\s+at\s+\$([\d,]+)\b/i,
    transform: (m) => moneyToNumber(m[1]),
  },
  {
    field: "saturday_site_fee",
    pattern: /\bincreasing\s+to\s+\$([\d,]+)\s+for\s+Saturdays\b/i,
    transform: (m) => moneyToNumber(m[1]),
  },
  {
    field: "accommodation_buyout_starting",
    pattern: /\bAll[-\s]Accommodation Buyout:[^.]*?\bstarting\s+around\s+\$([\d,]+)\b/i,
    transform: (m) => moneyToNumber(m[1]),
  },
  {
    field: "access_road_distance_miles",
    pattern: /\baccessed\s+via\s+a\s+(\d{1,3})[-\s]?mile\s+unpaved\s+road\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "drive_time_minutes",
    pattern: /\bdrive\s+takes\s+roughly\s+(\d{1,3})\s+minutes\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "wifi_cell_service",
    pattern: /\b(no\s+Wi[-\s]?Fi\s+or\s+reliable\s+cell\s+service[^.]*\.)/i,
    transform: (m) => m[1].trim().replace(/\s+/g, " "),
  },
  {
    field: "land_owner",
    pattern: /\bLand Owner:[^.]*?\bowned\s+by\s+the\s+([^.;]+?)(?=\.|\s+Board\b)/i,
    transform: (m) => {
      const owner = m[1].trim().replace(/\s+/g, " ");
      return /board$/i.test(owner) ? owner : `${owner} Board`;
    },
  },
  {
    field: "operator",
    pattern: /\boperators?—currently\s+([^—.]+?)(?:—|\.)/i,
    transform: (m) => m[1].trim().replace(/\s+/g, " "),
  },
  {
    field: "private_island_context",
    pattern: /\b(the ranch is a private "island"[^.]*\.)/i,
    transform: (m) => m[1].trim().replace(/\s+/g, " "),
  },
  {
    field: "off_grid_utilities",
    pattern: /\b(The property operates completely off[-\s]grid[^.]*\.)/i,
    transform: (m) => m[1].trim().replace(/\s+/g, " "),
  },

  // Hospitality / commercial
  // Allow commas inside digits ("1,957 rooms"); require ≥3 digits to avoid
  // catching "5 rooms" in residential prose. Min 100 rooms = hotel-scale.
  {
    field: "number_of_rooms",
    pattern: /(\d{1,3}(?:,\d{3})+|\d{3,5})[-\s]+(?:guest[-\s]+)?rooms?\b/i,
    transform: (m) => toNumber(m[1]),
  },
  {
    field: "number_of_suites",
    pattern: /(\d{1,3}(?:,\d{3})*|\d{1,4})[-\s]+suites?\b/i,
    transform: (m) => toNumber(m[1]),
  },
  // Accept either digits or the small word numbers commonly found in prose.
  {
    field: "number_of_restaurants",
    pattern:
      /\b(\d{1,3}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:on[-\s]?site\s+)?restaurants?\b/i,
    transform: (m) => {
      const word = m[1].toLowerCase();
      const words: Record<string, number> = {
        two: 2, three: 3, four: 4, five: 5, six: 6,
        seven: 7, eight: 8, nine: 9, ten: 10,
      };
      return words[word] ?? toNumber(m[1]);
    },
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
      /\b(?:renovated|refurbished|restored|renovation|refurbishment|restoration)[^.]{0,40}?\b((?:19|20)\d{2})\b/i,
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
