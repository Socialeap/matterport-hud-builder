import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  ExtractionError,
  invokeExtraction,
  invokeUrlExtraction,
} from "@/lib/extraction/client";
import { ensureExtractionEmbeddings } from "@/lib/rag/extraction-hydrator";
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

export type BackfillStatus = "idle" | "running" | "ok" | "failed";

/** Belt-and-suspenders ceiling for the entire backfill pipeline. With
 *  Layer-1 + Layer-2 timeouts in place this should never fire, but if
 *  it does the spinner is guaranteed to clear. */
const BACKFILL_WALL_CLOCK_MS = 180_000;

export function usePropertyExtractions(propertyUuid: string | null) {
  const [extractions, setExtractions] = useState<PropertyExtraction[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus>("idle");
  const [backfillMessage, setBackfillMessage] = useState<string | null>(null);
  const [failuresByAsset, setFailuresByAsset] = useState<
    Record<string, ExtractionFailure>
  >({});

  // Backwards-compatible boolean for callers that only care about the
  // run-vs-not-run dichotomy. Derived from status.
  const backfilling = backfillStatus === "running";

  const backfilledRef = useRef<Set<string>>(new Set());
  const okClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearOkTimer = useCallback(() => {
    if (okClearTimerRef.current) {
      clearTimeout(okClearTimerRef.current);
      okClearTimerRef.current = null;
    }
  }, []);

  const scheduleOkClear = useCallback(() => {
    clearOkTimer();
    okClearTimerRef.current = setTimeout(() => {
      setBackfillStatus("idle");
      setBackfillMessage(null);
      okClearTimerRef.current = null;
    }, 3000);
  }, [clearOkTimer]);

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

  // ── Phase 5d: one-shot lazy backfill of pre-Phase-5 rows. ──────────
  // The first refresh for each property kicks off ensureExtractionEmbeddings
  // in the background. Already-enriched rows fast-path via the helper's
  // own idempotency guard; only rows missing chunk embeddings or
  // canonical_qas actually spin up the worker. Result: MSPs who created
  // extractions before Phase 5 shipped get their tours upgraded the next
  // time they open the property in the builder — no manual action needed.
  useEffect(() => {
    if (!propertyUuid || loading) return;
    if (backfilledRef.current.has(propertyUuid)) return;
    backfilledRef.current.add(propertyUuid);

    let cancelled = false;
    (async () => {
      setBackfilling(true);
      try {
        const stats = await ensureExtractionEmbeddings([propertyUuid]);
        if (!cancelled && stats.rows_enriched > 0) {
          const fresh = await fetchRows(propertyUuid);
          if (fresh && !cancelled) setExtractions(fresh);
          console.info(
            `[doc-qa] backfilled ${stats.rows_enriched} extraction row(s)`,
            stats,
          );
        }
      } catch (err) {
        console.warn("[doc-qa] backfill failed:", err);
      } finally {
        if (!cancelled) setBackfilling(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [propertyUuid, loading, fetchRows]);

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
        try {
          await ensureExtractionEmbeddings([propertyUuid]);
        } catch (err) {
          console.warn("Post-extraction embedding enrichment failed:", err);
        }
        await refresh();
        return res;
      } catch (err) {
        const f = recordFailure(input.vault_asset_id, err);
        toast.error(`Extraction failed (${f.stage}): ${f.detail}`);
        return null;
      } finally {
        setRunning(false);
      }
    },
    [propertyUuid, refresh, clearFailure, recordFailure],
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
        try {
          await ensureExtractionEmbeddings([propertyUuid]);
        } catch (err) {
          console.warn("Post-extraction embedding enrichment failed:", err);
        }
        await refresh();
        return res;
      } catch (err) {
        const f = recordFailure(input.vault_asset_id, err);
        toast.error(`URL extraction failed (${f.stage}): ${f.detail}`);
        return null;
      } finally {
        setRunning(false);
      }
    },
    [propertyUuid, refresh, clearFailure, recordFailure],
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

  // Explicit re-index escape hatch. Clears the per-session guard so the
  // backfill runs even if this property was already checked.
  const reindex = useCallback(async () => {
    if (!propertyUuid) return;
    backfilledRef.current.delete(propertyUuid);
    setBackfilling(true);
    try {
      const stats = await ensureExtractionEmbeddings([propertyUuid]);
      if (stats.rows_enriched > 0) {
        toast.success(`Re-indexed ${stats.rows_enriched} extraction(s)`);
        const fresh = await fetchRows(propertyUuid);
        if (fresh) setExtractions(fresh);
      } else {
        toast.message("Extractions are already indexed.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Re-index failed: ${msg}`);
    } finally {
      setBackfilling(false);
      backfilledRef.current.add(propertyUuid);
    }
  }, [propertyUuid, fetchRows]);

  return {
    extractions,
    loading,
    running,
    backfilling,
    failuresByAsset,
    refresh,
    extract,
    extractFromUrl,
    remove,
    reindex,
  };
}
