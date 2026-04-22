/**
 * Property-doc extraction types shared between client (invocation + preview)
 * and edge function (actual extraction).
 */

import type { PropertyChunk } from "@/lib/rag/types";

export type ExtractorId = "pdfjs_heuristic" | "donut";

export interface VaultTemplate {
  id: string;
  provider_id: string;
  label: string;
  doc_kind: string;
  field_schema: JsonSchema;
  extractor: ExtractorId;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaField>;
  required?: string[];
}

export interface JsonSchemaField {
  type: "string" | "number" | "boolean" | "date";
  description?: string;
  pattern?: string;
}

export interface ExtractionResult {
  fields: Record<string, unknown>;
  chunks: PropertyChunk[];
}

export interface ExtractionRequest {
  vault_asset_id: string;
  template_id: string;
  property_uuid: string;
  saved_model_id?: string | null;
}

export interface ExtractionResponse {
  extraction_id: string;
  fields: Record<string, unknown>;
  chunks_indexed: number;
  embedding_status: "pending" | "running" | "ready" | "failed";
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
