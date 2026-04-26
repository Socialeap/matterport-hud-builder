// Deno-local mirror of client-side extraction types. Kept in sync with
// src/lib/extraction/provider.ts — the two files describe the same contract
// from opposite sides of the wire.

export type ExtractorId = "pdfjs_heuristic" | "donut";

/** Mirrors `src/lib/rag/types.ts` — see that file for the canonical
 *  comments. Edge-side duplication is intentional: Deno cannot import
 *  TS from the client tree, and we want one source of truth on the wire. */
export type ChunkKind = "raw_chunk" | "field_chunk";
export type ChunkSource = "pdf" | "url" | "field";
export type ChunkVisibility = "public" | "private";

export interface PropertyChunk {
  id: string;
  section: string;
  content: string;
  kind?: ChunkKind;
  source?: ChunkSource;
  pageStart?: number;
  pageEnd?: number;
  qualityScore?: number;
  tokenEstimate?: number;
  visibility?: ChunkVisibility;
}

export interface JsonSchemaField {
  type: "string" | "number" | "boolean" | "date";
  description?: string;
  pattern?: string;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaField>;
  required?: string[];
}

export interface VaultTemplate {
  id: string;
  provider_id: string;
  label: string;
  doc_kind: string;
  field_schema: JsonSchema;
  extractor: ExtractorId;
  version: number;
}

export interface ExtractionResult {
  fields: Record<string, unknown>;
  chunks: PropertyChunk[];
  /** Raw document text returned by text-based extractors (pdfjs_heuristic).
   *  Available for the optional Groq Cleaning Pass in extract-property-doc.
   *  Vision-based extractors (donut) do not populate this field. */
  rawText?: string;
}

export interface ExtractionProvider {
  id: ExtractorId;
  version: string;
  extract(input: {
    bytes: Uint8Array;
    template: VaultTemplate;
    mimeType?: string;
  }): Promise<ExtractionResult>;
}
