// V1 extractor: pdfjs text extraction + regex/type coercion against
// the MSP-authored JSON Schema. Pure JS, no model weights, no third-party
// inference — fits the sovereign-AI constraint.
//
// Uses `unpdf` (Deno/serverless-friendly PDF text extractor) via esm.sh.

import type {
  ExtractionProvider,
  ExtractionResult,
  JsonSchemaField,
  PropertyChunk,
  VaultTemplate,
} from "./types.ts";

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

const VERSION = "1.0.0";
const CHUNK_CHARS = 1200;
const CHUNK_OVERLAP = 150;

export const pdfjsHeuristic: ExtractionProvider = {
  id: "pdfjs_heuristic",
  version: VERSION,
  async extract({ bytes, template }): Promise<ExtractionResult> {
    const text = await extractText(bytes);
    const fields = coerceFields(text, template);
    const chunks = chunkText(text, template.doc_kind);
    return { fields, chunks };
  },
};

async function extractText(bytes: Uint8Array): Promise<string> {
  const pdf = await unpdf.getDocumentProxy(bytes);
  const { text } = await unpdf.extractText(pdf, { mergePages: true });
  if (typeof text === "string") return text;
  if (Array.isArray(text)) return text.join("\n");
  return "";
}

function coerceFields(
  text: string,
  template: VaultTemplate,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(template.field_schema.properties)) {
    const value = extractField(text, name, schema);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

function extractField(
  text: string,
  name: string,
  schema: JsonSchemaField,
): unknown {
  // Prefer an explicit regex if provided; otherwise fall back to a
  // `Label: value` heuristic keyed on the field name.
  if (schema.pattern) {
    try {
      const m = new RegExp(schema.pattern).exec(text);
      if (m) return cast(m[1] ?? m[0], schema.type);
    } catch {
      // bad regex — fall through to label heuristic
    }
  }

  const label = humanizeLabel(name);
  const labelRegex = new RegExp(
    `${escapeRegex(label)}\\s*[:\\-]\\s*([^\\n\\r]+)`,
    "i",
  );
  const m = labelRegex.exec(text);
  if (m?.[1]) return cast(m[1].trim(), schema.type);

  return undefined;
}

function humanizeLabel(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cast(raw: string, type: JsonSchemaField["type"]): unknown {
  const trimmed = raw.trim();
  switch (type) {
    case "number": {
      const n = Number(trimmed.replace(/[,$\s]/g, ""));
      return Number.isFinite(n) ? n : undefined;
    }
    case "boolean": {
      if (/^(true|yes|y|1)$/i.test(trimmed)) return true;
      if (/^(false|no|n|0)$/i.test(trimmed)) return false;
      return undefined;
    }
    case "date": {
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? undefined : d.toISOString();
    }
    case "string":
    default:
      return trimmed;
  }
}

function chunkText(text: string, section: string): PropertyChunk[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];

  const chunks: PropertyChunk[] = [];
  let start = 0;
  let idx = 0;
  while (start < clean.length) {
    const end = Math.min(start + CHUNK_CHARS, clean.length);
    chunks.push({
      id: `${section}-${idx}`,
      section,
      content: clean.slice(start, end),
    });
    if (end === clean.length) break;
    start = end - CHUNK_OVERLAP;
    idx += 1;
  }
  return chunks;
}
