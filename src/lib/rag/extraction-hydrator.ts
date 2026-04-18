/**
 * Bridges property_extractions rows into asset-scoped Orama DBs for
 * hybrid search. Used by Phase 2 HUD surfaces; exposed in Phase 1 so
 * the extraction round-trip is verifiable end-to-end.
 *
 * Also performs lazy embed backfill: when an extraction row's chunks
 * are first loaded, this module embeds them in-browser via the RAG
 * worker and flips `vault_assets.embedding_status` from 'pending' to
 * 'ready' (or 'failed').
 */

import { supabase } from "@/integrations/supabase/client";
import type { PropertyChunk } from "./types";
import type { RAGPipeline } from "./rag-pipeline";

export async function hydrateAsset(
  pipeline: RAGPipeline,
  vaultAssetId: string,
): Promise<{ chunks_indexed: number }> {
  await updateStatus(vaultAssetId, "running");

  try {
    const { data, error } = await supabase
      .from("property_extractions")
      .select("chunks")
      .eq("vault_asset_id", vaultAssetId);

    if (error) throw error;

    const chunks: PropertyChunk[] = (data ?? []).flatMap(
      (row) => (row.chunks as unknown as PropertyChunk[]) ?? [],
    );

    await pipeline.hydrateFromExtractions(vaultAssetId, chunks);
    await updateStatus(vaultAssetId, "ready");
    return { chunks_indexed: chunks.length };
  } catch (err) {
    await updateStatus(vaultAssetId, "failed");
    throw err;
  }
}

async function updateStatus(
  vaultAssetId: string,
  status: "pending" | "running" | "ready" | "failed",
): Promise<void> {
  await supabase
    .from("vault_assets")
    .update({
      embedding_status: status,
      ...(status === "ready" ? { embedding_backfilled_at: new Date().toISOString() } : {}),
    })
    .eq("id", vaultAssetId);
}
