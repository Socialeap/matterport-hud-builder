// ── Shared types for the RAG Q&A pipeline ──────────────────────────────

/** Embedding model dimensionality (MiniLM-L6-v2 = 384). */
export const EMBEDDING_DIM = 384;

// ── Web Worker message protocol ─────────────────────────────────────────

export type WorkerRequest =
  | { type: "init" }
  | { type: "embed"; id: string; texts: string[] };

export type WorkerResponse =
  | { type: "init:ready" }
  | { type: "init:progress"; message: string }
  | { type: "init:error"; error: string }
  | { type: "embed:result"; id: string; embeddings: number[][] }
  | { type: "embed:error"; id: string; error: string };

// ── Property document types ─────────────────────────────────────────────

export interface PropertyChunk {
  id: string;
  section: string;
  content: string;
}

export interface IndexedChunk extends PropertyChunk {
  embedding: number[];
}

// ── Orama schema type ───────────────────────────────────────────────────

export interface OramaPropertyDoc {
  id: string;
  section: string;
  content: string;
  embedding: number[];
}

// ── Search result ───────────────────────────────────────────────────────

export interface SearchResult {
  id: string;
  section: string;
  content: string;
  score: number;
}

// ── Pre-computed Q&A types ──────────────────────────────────────────────

/** Raw Q&A entry produced by the rule-based property-qa-builder. */
export interface QAEntry {
  question: string;
  answer: string;
  source_anchor_id: string;
}

/** Enriched Q&A entry with pre-computed embedding, ready for HTML injection. */
export interface QADatabaseEntry {
  id: string;
  question: string;
  answer: string;
  source_anchor_id: string;
  embedding: number[];
}
