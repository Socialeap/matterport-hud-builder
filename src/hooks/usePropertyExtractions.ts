import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { invokeExtraction } from "@/lib/extraction/client";
import { ensureExtractionEmbeddings } from "@/lib/rag/extraction-hydrator";
import type { PropertyChunk } from "@/lib/rag/types";

export interface PropertyExtraction {
  id: string;
  vault_asset_id: string;
  template_id: string;
  saved_model_id: string | null;
  property_uuid: string;
  fields: Record<string, unknown>;
  chunks: PropertyChunk[];
  extractor: string;
  extractor_version: string;
  extracted_at: string;
}

export function usePropertyExtractions(propertyUuid: string | null) {
  const [extractions, setExtractions] = useState<PropertyExtraction[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    if (!propertyUuid) {
      setExtractions([]);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("property_extractions")
      .select("*")
      .eq("property_uuid", propertyUuid)
      .order("extracted_at", { ascending: false });

    if (error) {
      toast.error("Failed to load extractions");
    } else {
      setExtractions((data as unknown as PropertyExtraction[]) ?? []);
    }
    setLoading(false);
  }, [propertyUuid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const extract = useCallback(
    async (input: {
      vault_asset_id: string;
      template_id: string;
      saved_model_id?: string | null;
    }) => {
      if (!propertyUuid) {
        toast.error("No property selected");
        return null;
      }
      setRunning(true);
      try {
        const res = await invokeExtraction({
          vault_asset_id: input.vault_asset_id,
          template_id: input.template_id,
          property_uuid: propertyUuid,
          saved_model_id: input.saved_model_id ?? null,
        });
        toast.success(`Extracted ${res.chunks_indexed} chunks`);
        // Enrich the new extraction with chunk embeddings + canonical
        // Q&As so the delivered tour runs a zero-LLM answer pipeline.
        // Non-fatal on failure — the tour falls back to BM25-only Q&A.
        try {
          await ensureExtractionEmbeddings([propertyUuid]);
        } catch (err) {
          console.warn("Post-extraction embedding enrichment failed:", err);
        }
        await refresh();
        return res;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        toast.error(`Extraction failed: ${msg}`);
        return null;
      } finally {
        setRunning(false);
      }
    },
    [propertyUuid, refresh],
  );

  const remove = useCallback(
    async (extractionId: string) => {
      const { error } = await supabase
        .from("property_extractions")
        .delete()
        .eq("id", extractionId);
      if (error) {
        toast.error("Failed to delete extraction");
        return false;
      }
      toast.success("Extraction removed");
      await refresh();
      return true;
    },
    [refresh],
  );

  return { extractions, loading, running, refresh, extract, remove };
}
