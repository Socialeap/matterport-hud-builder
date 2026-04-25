/**
 * Hidden canonical keys silently merged into MSP-authored templates so the
 * runtime Intent Router (src/lib/portal/ask-intents.mjs) always finds the
 * fields it expects regardless of what the MSP listed in their template.
 *
 * Merge rule (server-side, in induce-schema): only ADD keys that are NOT
 * already present. Never overwrite an MSP-defined property.
 */

export interface CanonicalKeyDef {
  type: "string" | "number" | "boolean" | "date";
  description: string;
}

/** Always merged into every architect-generated schema. */
export const REQUIRED_CANONICAL_KEYS: Record<string, CanonicalKeyDef> = {
  property_address: {
    type: "string",
    description: "Full street address of the property (canonical).",
  },
};

/** Doc-kind-specific canonical additions (additive merge). */
export const DOC_KIND_CANONICAL_KEYS: Record<
  string,
  Record<string, CanonicalKeyDef>
> = {
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

/**
 * Resolve the union of canonical keys to merge for a given doc_kind.
 * Unknown doc_kinds get the REQUIRED set only.
 */
export function getCanonicalKeysFor(
  docKind: string | undefined,
): Record<string, CanonicalKeyDef> {
  const kind = (docKind ?? "").trim().toLowerCase();
  return {
    ...REQUIRED_CANONICAL_KEYS,
    ...(DOC_KIND_CANONICAL_KEYS[kind] ?? {}),
  };
}
