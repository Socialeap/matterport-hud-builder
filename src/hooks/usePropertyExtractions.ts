import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  ExtractionError,
  invokeExtraction,
  invokeUrlExtraction,
} from "@/lib/extraction/client";
import { useIndexing } from "@/lib/rag/indexing-context";
import type { PropertyChunk } from "@/lib/rag/types";

export interface ExtractionFailure {
  stage: string;
  detail: string;
  status: number;
  at: number;
}

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

/** Legacy status enum kept for backwards-compatible callers. Mirrors the
 *  shared `IndexingPhase` from `IndexingProvider`. */
export type BackfillStatus = "idle" | "running" | "ok" | "failed";

export function usePropertyExtractions(propertyUuid: string | null) {
  const [extractions, setExtractions] = useState<PropertyExtraction[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [failuresByAsset, setFailuresByAsset] = useState<
    Record<string, ExtractionFailure>
  >({});

  const indexing = useIndexing();
  const status = indexing.statusFor(propertyUuid);

  // Map shared indexing phase → legacy backfill status so existing
  // panels keep rendering without churn.
  const backfillStatus: BackfillStatus =
    status.phase === "indexing"
      ? "running"
      : status.phase === "ready"
        ? "ok"
        : status.phase === "failed"
          ? "failed"
          : "idle";
  const backfillMessage = status.message;
  const backfilling = backfillStatus === "running";

  const recordFailure = useCallback(
    (vault_asset_id: string, err: unknown) => {
      const f: ExtractionFailure =
        err instanceof ExtractionError
          ? { stage: err.stage, detail: err.detail, status: err.status, at: Date.now() }
          : {
              stage: "unknown",
              detail: err instanceof Error ? err.message : String(err),
              status: 0,
              at: Date.now(),
            };
      setFailuresByAsset((prev) => ({ ...prev, [vault_asset_id]: f }));
      return f;
    },
    [],
  );

  const clearFailure = useCallback((vault_asset_id: string) => {
    setFailuresByAsset((prev) => {
      if (!(vault_asset_id in prev)) return prev;
      const { [vault_asset_id]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  const fetchRows = useCallback(async (uuid: string) => {
    const { data, error } = await supabase
      .from("property_extractions")
      .select("*")
      .eq("property_uuid", uuid)
      .order("extracted_at", { ascending: false });
    if (error) {
      toast.error("Failed to load extractions");
      return null;
    }
    return (data as unknown as PropertyExtraction[]) ?? [];
  }, []);

  const refresh = useCallback(async () => {
    if (!propertyUuid) {
      setExtractions([]);
      return;
    }
    setLoading(true);
    const rows = await fetchRows(propertyUuid);
    if (rows) setExtractions(rows);
    setLoading(false);
  }, [propertyUuid, fetchRows]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to shared indexing state — when the provider flips a
  // property to "ready" we re-pull rows so newly-embedded chunks are
  // visible to the UI immediately.
  useEffect(() => {
    if (!propertyUuid) return;
    let lastPhase = indexing.statusFor(propertyUuid).phase;
    const unsub = indexing.subscribe(propertyUuid, (s) => {
      if (s.phase === "ready" && lastPhase === "indexing") {
        refresh();
      }
      lastPhase = s.phase;
    });
    return unsub;
  }, [propertyUuid, indexing, refresh]);

  // Kick off (or join) the shared indexing job for this property.
  // Page-scoped dedupe lives inside the provider so two panels sharing
  // a property only pay for one job.
  useEffect(() => {
    if (!propertyUuid || loading || extractions.length === 0) return;
    indexing.request(propertyUuid).catch((err) => {
      console.warn("[doc-qa] indexing request failed:", err);
    });
  }, [propertyUuid, loading, extractions.length, indexing.request]);

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
        clearFailure(input.vault_asset_id);
        toast.success(`Extracted ${res.chunks_indexed} chunks`);
        await refresh();
        // Force a re-index so the new row gets embeddings + canonical QAs.
        indexing.requestForce(propertyUuid).catch((err) => {
          console.warn("Post-extraction embedding enrichment failed:", err);
        });
        return res;
      } catch (err) {
        const f = recordFailure(input.vault_asset_id, err);
        toast.error(`Extraction failed (${f.stage}): ${f.detail}`);
        return null;
      } finally {
        setRunning(false);
      }
    },
    [propertyUuid, refresh, clearFailure, recordFailure, indexing.requestForce],
  );

  const extractFromUrl = useCallback(
    async (input: {
      vault_asset_id: string;
      url: string;
      template_id?: string | null;
      saved_model_id?: string | null;
    }) => {
      if (!propertyUuid) {
        toast.error("No property selected");
        return null;
      }
      setRunning(true);
      try {
        const res = await invokeUrlExtraction({
          vault_asset_id: input.vault_asset_id,
          url: input.url,
          property_uuid: propertyUuid,
          template_id: input.template_id ?? null,
          saved_model_id: input.saved_model_id ?? null,
        });
        clearFailure(input.vault_asset_id);
        toast.success(`Extracted ${res.chunks_indexed} chunks from URL`);
        await refresh();
        indexing.requestForce(propertyUuid).catch((err) => {
          console.warn("Post-extraction embedding enrichment failed:", err);
        });
        return res;
      } catch (err) {
        const f = recordFailure(input.vault_asset_id, err);
        toast.error(`URL extraction failed (${f.stage}): ${f.detail}`);
        return null;
      } finally {
        setRunning(false);
      }
    },
    [propertyUuid, refresh, clearFailure, recordFailure, indexing.requestForce],
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

  // Explicit re-index escape hatch.
  const reindex = useCallback(async () => {
    if (!propertyUuid) return;
    try {
      await indexing.requestForce(propertyUuid);
      const fresh = await fetchRows(propertyUuid);
      if (fresh) setExtractions(fresh);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Re-index failed: ${msg}`);
    }
  }, [propertyUuid, fetchRows, indexing.requestForce]);

  return {
    extractions,
    loading,
    running,
    backfilling,
    backfillStatus,
    backfillMessage,
    failuresByAsset,
    refresh,
    extract,
    extractFromUrl,
    remove,
    reindex,
  };
}
