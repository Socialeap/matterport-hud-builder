/**
 * Client helper for the dryrun-template edge function. Lets the
 * template editor preview an extraction against an unsaved draft
 * template + a sample PDF without persisting anything.
 */

import { supabase } from "@/integrations/supabase/client";
import type { JsonSchema, ExtractorId } from "./provider";
import type { PropertyChunk } from "@/lib/rag/types";

export interface DryRunRequest {
  template: {
    label?: string;
    doc_kind?: string;
    extractor: ExtractorId;
    field_schema: JsonSchema;
  };
  pdfFile: File;
}

export interface DryRunSuccess {
  fields: Record<string, unknown>;
  chunks: PropertyChunk[];
  extractor: ExtractorId;
  extractor_version: string;
  pdf_bytes: number;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked encode to stay under the call-stack limit on big PDFs.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)),
    );
  }
  return btoa(binary);
}

export async function dryRunTemplate(
  req: DryRunRequest,
): Promise<DryRunSuccess> {
  const pdf_b64 = await fileToBase64(req.pdfFile);
  const { data, error } = await supabase.functions.invoke<
    DryRunSuccess | { error: string; detail?: string }
  >("dryrun-template", {
    body: { template: req.template, pdf_b64 },
  });
  if (error) throw error;
  if (!data) throw new Error("dryrun-template returned no data");
  if ("error" in data) {
    throw new Error(`${data.error}${data.detail ? `: ${data.detail}` : ""}`);
  }
  return data;
}
