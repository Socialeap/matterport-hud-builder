/**
 * Client helper for the induce-schema edge function. Sends an example PDF
 * to GPT-4o-mini which analyses its text and returns a JSON Schema aligned
 * to the system's canonical key set. Called once per template at MSP
 * authoring time — not on any hot path.
 */

import { supabase } from "@/integrations/supabase/client";
import type { JsonSchema } from "./provider";

export interface InduceSchemaResult {
  schema: JsonSchema;
  text_preview: string;
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunked encode to stay under the call-stack limit on large PDFs.
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

export async function induceSchema(pdfFile: File): Promise<InduceSchemaResult> {
  const pdf_b64 = await fileToBase64(pdfFile);
  const { data, error } = await supabase.functions.invoke<
    InduceSchemaResult | { error: string; detail?: string; raw_output?: string }
  >("induce-schema", {
    body: { pdf_b64 },
  });
  if (error) throw error;
  if (!data) throw new Error("induce-schema returned no data");
  if ("error" in data) {
    throw new Error(`${data.error}${data.detail ? `: ${data.detail}` : ""}`);
  }
  return data;
}
