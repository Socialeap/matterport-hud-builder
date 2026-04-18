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
