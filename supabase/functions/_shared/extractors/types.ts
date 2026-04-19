// Deno-local mirror of client-side extraction types. Kept in sync with
// src/lib/extraction/provider.ts — the two files describe the same contract
// from opposite sides of the wire.

export type ExtractorId = "pdfjs_heuristic" | "donut";

export interface PropertyChunk {
  id: string;
  section: string;
  content: string;
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
}

export interface ExtractionProvider {
  id: ExtractorId;
  version: string;
  extract(input: {
    bytes: Uint8Array;
    template: VaultTemplate;
  }): Promise<ExtractionResult>;
}
