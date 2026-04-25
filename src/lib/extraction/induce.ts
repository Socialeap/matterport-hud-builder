/**
 * Client helpers for the induce-schema edge function. Three flows:
 *
 *   - induceSchema(pdfFile) ........ classic PDF → JSON Schema (Gemini 2.5 Flash-Lite)
 *   - architectDraft(propDescr) .... Turn 1: candidate field list
 *   - architectRefine(...)  ........ Turn 2: validated JSON Schema with hidden
 *                                    canonical keys merged server-side.
 *
 * Called once per template at MSP authoring time — never on hot paths.
 */

import { supabase } from "@/integrations/supabase/client";
import type { JsonSchema } from "./provider";

export interface InduceSchemaResult {
  schema: JsonSchema;
  text_preview: string;
}

export interface DraftItem {
  id: number;
  key: string;
  label: "Foundational" | "Differentiator";
  title: string;
  desc: string;
}

export interface ArchitectDraftResult {
  draft: DraftItem[];
  usage: { prompt: number; completion: number; total: number };
}

export interface KeptItem {
  key: string;
  title: string;
  desc?: string;
}

export interface ArchitectRefineResult {
  schema: JsonSchema;
  hidden_keys_added: string[];
  usage: { prompt: number; completion: number; total: number };
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
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

function unwrap<T>(data: T | { error: string; detail?: string } | null): T {
  if (!data) throw new Error("induce-schema returned no data");
  if (typeof data === "object" && data !== null && "error" in data) {
    const e = data as { error: string; detail?: string };
    throw new Error(`${e.error}${e.detail ? `: ${e.detail}` : ""}`);
  }
  return data as T;
}

export async function induceSchema(pdfFile: File): Promise<InduceSchemaResult> {
  const pdf_b64 = await fileToBase64(pdfFile);
  const { data, error } = await supabase.functions.invoke("induce-schema", {
    body: { pdf_b64 },
  });
  if (error) throw error;
  return unwrap<InduceSchemaResult>(data);
}

export async function architectDraft(
  propDescr: string,
): Promise<ArchitectDraftResult> {
  const { data, error } = await supabase.functions.invoke("induce-schema", {
    body: { mode: "architect_draft", prop_descr: propDescr },
  });
  if (error) throw error;
  return unwrap<ArchitectDraftResult>(data);
}

export async function architectRefine(args: {
  propDescr: string;
  docKind: string;
  keptItems: KeptItem[];
}): Promise<ArchitectRefineResult> {
  const { data, error } = await supabase.functions.invoke("induce-schema", {
    body: {
      mode: "architect_refine",
      prop_descr: args.propDescr,
      doc_kind: args.docKind,
      kept_items: args.keptItems,
    },
  });
  if (error) throw error;
  return unwrap<ArchitectRefineResult>(data);
}
