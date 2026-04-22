/**
 * Thin client helper to invoke the extract-property-doc edge function.
 * The extraction itself runs server-side (Deno) so that the PDF bytes
 * never leave our infra in the browser.
 */

import { supabase } from "@/integrations/supabase/client";
import type {
  ExtractionRequest,
  ExtractionResponse,
} from "./provider";

export async function invokeExtraction(
  req: ExtractionRequest,
): Promise<ExtractionResponse> {
  const { data, error } = await supabase.functions.invoke<ExtractionResponse>(
    "extract-property-doc",
    { body: req },
  );

  if (error) {
    if (error.context?.status === 423) {
      throw new Error("LUS freeze active for this property — unfreeze to continue");
    }
    throw error;
  }
  if (!data) throw new Error("extract-property-doc returned no data");
  return data;
}

export interface UrlExtractionRequest {
  vault_asset_id: string;
  property_uuid: string;
  url: string;
  saved_model_id?: string | null;
  template_id?: string | null;
}

/**
 * Companion to invokeExtraction for URL-based assets. The server-side
 * extract-url-content function fetches the page, runs SSRF guards,
 * structures fields via the LLM, chunks the cleaned text, and writes a
 * property_extractions row identical in shape to the file path's output.
 */
export async function invokeUrlExtraction(
  req: UrlExtractionRequest,
): Promise<ExtractionResponse> {
  const { data, error } = await supabase.functions.invoke<ExtractionResponse>(
    "extract-url-content",
    { body: req },
  );

  if (error) {
    if (error.context?.status === 423) {
      throw new Error("LUS freeze active for this property — unfreeze to continue");
    }
    throw error;
  }
  if (!data) throw new Error("extract-url-content returned no data");
  return data;
}
