/**
 * Builder-time enrichment for property_extractions rows.
 *
 * Phase 5 turns the previously orphan embed-on-load round-trip into a
 * one-shot persistence step. For each extraction row belonging to the
 * provided property_uuids:
 *
 *   1. Skip the row entirely if every chunk already carries an
 *      `embedding` array AND `canonical_qas` is non-null.
 *   2. Build canonical Q&A pairs deterministically from `fields`
 *      (see `./canonical-questions`).
 *   3. Embed chunk texts + canonical-question texts in a single
 *      worker batch — halving round-trips vs. embedding twice.
 *   4. Write the enriched chunks (with embeddings inlined) and
 *      canonical_qas back to the same row via the authenticated
 *      Supabase client. RLS restricts writes to the owning provider;
 *      this function is callable only by the MSP, typically right
 *      after a successful extract-property-doc invocation.
 *
 * The result: at viewer runtime the delivered tour inlines chunks +
 * canonical QAs with their vectors already computed. No LLM, no
 * re-embed-on-every-load tax.
 */
import { supabase } from "@/integrations/supabase/client";
import { EmbeddingWorkerClient } from "./embedding-worker-client";
import type { Json } from "@/integrations/supabase/types";
import {
  buildCanonicalQAs,
  canonicalQuestionTexts,
  type CanonicalQA,
  type EmbeddedCanonicalQA,
} from "./canonical-questions";
import { EMBEDDING_DIM } from "./types";

interface RawExtractionRow {
  id: string;
  property_uuid: string;
  fields: Record<string, unknown>;
  chunks: unknown;
  canonical_qas: unknown;
}

interface RawChunk {
  id: string;
  section: string;
  content: string;
  embedding?: number[] | null;
}

export interface EnrichmentStats {
  rows_scanned: number;
  rows_enriched: number;
  chunks_embedded: number;
  canonical_qas_written: number;
}

function rowAlreadyEnriched(row: RawExtractionRow): boolean {
  const c = Array.isArray(row.chunks) ? (row.chunks as RawChunk[]) : [];
  const allChunksEmbedded =
    c.length > 0 &&
    c.every(
      (x) => Array.isArray(x?.embedding) && x.embedding.length === EMBEDDING_DIM,
    );
  return allChunksEmbedded && Array.isArray(row.canonical_qas);
}

/**
 * Ensure every extraction row linked to `propertyUuids` has per-chunk
 * embeddings and a canonical_qas cache. Callable only by the provider
 * who owns the underlying vault_assets — RLS rejects writes from any
 * other role. Safe to call repeatedly: already-enriched rows are
 * detected and skipped.
 *
 * Spins up a short-lived EmbeddingWorkerClient internally so callers
 * don't have to manage the worker lifecycle. Pass `opts.worker` to
 * reuse an existing instance (e.g., one shared with Q&A embedding).
 */
export async function ensureExtractionEmbeddings(
  propertyUuids: string[],
  opts?: { worker?: EmbeddingWorkerClient },
): Promise<EnrichmentStats> {
  const stats: EnrichmentStats = {
    rows_scanned: 0,
    rows_enriched: 0,
    chunks_embedded: 0,
    canonical_qas_written: 0,
  };

  if (propertyUuids.length === 0) return stats;

  const { data: rows, error } = await supabase
    .from("property_extractions")
    .select("id, property_uuid, fields, chunks, canonical_qas")
    .in("property_uuid", propertyUuids);

  if (error) {
    console.warn("ensureExtractionEmbeddings: fetch failed:", error);
    return stats;
  }
  if (!rows) return stats;

  stats.rows_scanned = rows.length;

  const typedRows = rows as RawExtractionRow[];
  if (typedRows.every(rowAlreadyEnriched)) return stats;

  const ownedWorker = !opts?.worker;
  const worker = opts?.worker ?? new EmbeddingWorkerClient();

  try {
    await worker.init();

    for (const row of typedRows) {
      if (rowAlreadyEnriched(row)) continue;

      const rawChunks = Array.isArray(row.chunks) ? (row.chunks as RawChunk[]) : [];
      const fields = (row.fields ?? {}) as Record<string, unknown>;
      const canonicalQAs: CanonicalQA[] = buildCanonicalQAs(fields);

      // One batch, two slices: chunk texts first, canonical-question texts
      // second. Halves the worker round-trips vs. embedding each group.
      const chunkTexts = rawChunks.map((c) => `${c.section}: ${c.content}`);
      const questionTexts = canonicalQuestionTexts(canonicalQAs);
      const batch = [...chunkTexts, ...questionTexts];

      let vectors: number[][] = [];
      if (batch.length > 0) {
        try {
          vectors = await worker.embedBatch(batch);
        } catch (err) {
          console.warn(
            `ensureExtractionEmbeddings: embed failed for row=${row.id}:`,
            err,
          );
          continue;
        }
      }

      const chunkVectors = vectors.slice(0, chunkTexts.length);
      const questionVectors = vectors.slice(chunkTexts.length);

      const enrichedChunks: RawChunk[] = rawChunks.map((c, i) => ({
        id: c.id,
        section: c.section,
        content: c.content,
        embedding: chunkVectors[i] ?? c.embedding ?? null,
      }));

      const enrichedCanonicalQAs: EmbeddedCanonicalQA[] = canonicalQAs.map(
        (qa, i) => ({
          ...qa,
          embedding: questionVectors[i] ?? [],
        }),
      );

      const { error: updateErr } = await supabase
        .from("property_extractions")
        .update({
          chunks: enrichedChunks as unknown as Json,
          canonical_qas: enrichedCanonicalQAs as unknown as Json,
        })
        .eq("id", row.id);

      if (updateErr) {
        console.warn(
          `ensureExtractionEmbeddings: persist failed for row=${row.id}:`,
          updateErr,
        );
        continue;
      }

      stats.rows_enriched += 1;
      stats.chunks_embedded += enrichedChunks.filter(
        (c) => Array.isArray(c.embedding) && c.embedding.length === EMBEDDING_DIM,
      ).length;
      stats.canonical_qas_written += enrichedCanonicalQAs.length;
    }
  } finally {
    if (ownedWorker) worker.terminate();
  }

  return stats;
}
