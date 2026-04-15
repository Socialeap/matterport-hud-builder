/**
 * Orama in-memory database for hybrid (BM25 + vector) property search.
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

let db: AnyOrama | null = null;

/** Create (or recreate) the Orama database. */
export async function createPropertyDB(): Promise<AnyOrama> {
  db = await create({
    schema: {
      id: "string",
      section: "string",
      content: "string",
      embedding: `vector[${EMBEDDING_DIM}]`,
    } as const,
  });
  return db;
}

/** Index an array of chunks (already embedding-enriched) into Orama. */
export async function indexChunks(chunks: IndexedChunk[]): Promise<void> {
  if (!db) {
    await createPropertyDB();
  }

  for (const chunk of chunks) {
    await insert(db!, {
      id: chunk.id,
      section: chunk.section,
      content: chunk.content,
      embedding: chunk.embedding,
    } satisfies OramaPropertyDoc);
  }
}

/**
 * Hybrid search: combines BM25 full-text matching on `content` with
 * vector similarity on `embedding`.
 *
 * @param queryText  - the user's question (for BM25)
 * @param queryVec   - the query embedding (for vector similarity)
 * @param topK       - how many results to return (default 3)
 * @param threshold  - minimum score to include (default 0)
 */
export async function hybridSearch(
  queryText: string,
  queryVec: number[],
  topK = 3,
  threshold = 0,
): Promise<SearchResult[]> {
  if (!db) {
    throw new Error("Orama DB not initialised — call createPropertyDB() first");
  }

  const results = await search(db, {
    mode: MODE_HYBRID_SEARCH,
    term: queryText,
    vector: {
      value: queryVec,
      property: "embedding",
    },
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

/** Tear down the DB (useful when switching properties). */
export async function resetDB(): Promise<void> {
  db = null;
}
