/**
 * Shared types for the Property Map Wizard.
 *
 * The wizard owns a single `WizardDraft` from open → save. Path components
 * mutate the draft via callbacks; the modal shell controls navigation.
 */

import type { ExtractorId, JsonSchema } from "@/lib/extraction/provider";

export type WizardPath = "ai" | "library" | "manual";

export interface WizardDraft {
  /** null = create new template, set = edit existing. */
  id: string | null;
  path: WizardPath;
  /** 0-indexed step within the chosen path. */
  step: number;
  label: string;
  doc_kind: string;
  extractor: ExtractorId;
  /** Canonical schema as a JSON-stringified string (matches the legacy editor). */
  schema_text: string;
  /** Provenance hint — used only for UI labels. */
  source:
    | { kind: "starter"; ref: string }
    | { kind: "cloned"; ref: string }
    | { kind: "ai" }
    | { kind: "manual" }
    | null;
}

export const DEFAULT_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    property_address: { type: "string" },
    purchase_price: { type: "number" },
  },
};

export const DEFAULT_SCHEMA_TEXT = JSON.stringify(DEFAULT_SCHEMA, null, 2);

export function makeEmptyDraft(path: WizardPath): WizardDraft {
  return {
    id: null,
    path,
    step: 0,
    label: "",
    doc_kind: "",
    extractor: "pdfjs_heuristic",
    schema_text: DEFAULT_SCHEMA_TEXT,
    source: null,
  };
}

/** Number of steps each path runs through, including the final "Name & Save" step. */
export const PATH_STEP_COUNT: Record<WizardPath, number> = {
  ai: 3,
  library: 2,
  manual: 2,
};

export const PATH_STEP_LABELS: Record<WizardPath, string[]> = {
  ai: ["Describe property", "Pick the facts", "Name & save"],
  library: ["Pick a starting point", "Name & save"],
  manual: ["Author blueprint", "Name & save"],
};

export const PATH_TITLES: Record<WizardPath, string> = {
  ai: "Smart AI Blueprint",
  library: "Use a Pre-Built Template",
  manual: "Pro Developer Setup",
};
