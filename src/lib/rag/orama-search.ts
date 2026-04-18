/**
 * Orama hybrid (BM25 + vector) search for property docs.
 *
 * A single in-memory `Map<scopeId, AnyOrama>` supports multiple
 * concurrently-hydrated property docs — one Orama DB per vault asset
 * (or whatever scope the caller chooses). The legacy default-scope
 * exports (`createPropertyDB`, `indexChunks`, `hybridSearch`, `resetDB`)
 * continue to work by operating on a `DEFAULT_SCOPE` instance.
 */

import {
  create,
  insert,
  search,
  type AnyOrama,
  MODE_HYBRID_SEARCH,
} from "@orama/orama";
import type {
  OramaPropertyDoc,
  IndexedChunk,
  SearchResult,
} from "./types";
import { EMBEDDING_DIM } from "./types";

const DEFAULT_SCOPE = "__default__";
const dbs = new Map<string, AnyOrama>();

async function createDbInstance(): Promise<AnyOrama> {
  return create({
    schema: {
      id: "string",
      section: "string",
      content: "string",
      embedding: `vector[${EMBEDDING_DIM}]`,
    } as const,
  });
}

async function getOrCreate(scopeId: string): Promise<AnyOrama> {
  let db = dbs.get(scopeId);
  if (!db) {
    db = await createDbInstance();
    dbs.set(scopeId, db);
  }
  return db;
}

// ── Scoped API ──────────────────────────────────────────────────────────

/** Create (or recreate) the Orama DB for `scopeId`. */
export async function createPropertyDBFor(scopeId: string): Promise<AnyOrama> {
  const db = await createDbInstance();
  dbs.set(scopeId, db);
  return db;
}

/** Index chunks into `scopeId`'s Orama DB. */
export async function indexChunksFor(
  scopeId: string,
  chunks: IndexedChunk[],
): Promise<void> {
  const db = await getOrCreate(scopeId);
  for (const chunk of chunks) {
    await insert(db, {
      id: chunk.id,
      section: chunk.section,
      content: chunk.content,
      embedding: chunk.embedding,
    } satisfies OramaPropertyDoc);
  }
}

/** Replace the chunks in `scopeId`'s DB (drop + re-index). */
export async function rebuildFor(
  scopeId: string,
  chunks: IndexedChunk[],
): Promise<void> {
  await createPropertyDBFor(scopeId);
  await indexChunksFor(scopeId, chunks);
}

/** Hybrid search against `scopeId`'s DB. */
export async function hybridSearchFor(
  scopeId: string,
  queryText: string,
  queryVec: number[],
  topK = 3,
  threshold = 0,
): Promise<SearchResult[]> {
  const db = dbs.get(scopeId);
  if (!db) {
    throw new Error(
      `Orama DB not initialised for scope=${scopeId} — hydrate first`,
    );
  }

  const results = await search(db, {
    mode: MODE_HYBRID_SEARCH,
    term: queryText,
    vector: { value: queryVec, property: "embedding" },
    limit: topK,
    similarity: threshold,
  });

  return results.hits.map((hit) => {
    const doc = hit.document as unknown as OramaPropertyDoc;
    return {
      id: doc.id,
      section: doc.section,
      content: doc.content,
      score: hit.score,
    };
  });
}

/** Drop `scopeId`'s DB from memory. */
export async function resetFor(scopeId: string): Promise<void> {
  dbs.delete(scopeId);
}

/** Drop every scope. */
export async function resetAll(): Promise<void> {
  dbs.clear();
}

// ── Legacy default-scope API (preserved for rag-pipeline.ts) ────────────

export async function createPropertyDB(): Promise<AnyOrama> {
  return createPropertyDBFor(DEFAULT_SCOPE);
}

export async function indexChunks(chunks: IndexedChunk[]): Promise<void> {
  return indexChunksFor(DEFAULT_SCOPE, chunks);
}

export async function hybridSearch(
  queryText: string,
  queryVec: number[],
  topK = 3,
  threshold = 0,
): Promise<SearchResult[]> {
  return hybridSearchFor(DEFAULT_SCOPE, queryText, queryVec, topK, threshold);
}

export async function resetDB(): Promise<void> {
  return resetFor(DEFAULT_SCOPE);
}
