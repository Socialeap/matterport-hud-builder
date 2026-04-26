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

/** Origin of a chunk's text. Distinguishes raw document body from
 *  field-derived synthetic text and (future) build-time pre-synth text. */
export type ChunkKind = "raw_chunk" | "field_chunk";

/** Where the underlying text came from. `pdf` covers any text-extracted
 *  document (pdf, docx, txt, rtf); `field` is template-derived text. */
export type ChunkSource = "pdf" | "url" | "field";

/** Public chunks ride the standalone HTML bundle and are searchable by
 *  the local Orama runtime. Private chunks stay in `property_extractions`
 *  for builder-side use only (e.g. server-side pre-synthesis grounding)
 *  and are stripped from `window.__PROPERTY_EXTRACTIONS__`. Defaults to
 *  `public` so legacy rows keep working. */
export type ChunkVisibility = "public" | "private";

export interface PropertyChunk {
  id: string;
  section: string;
  content: string;
  /** Phase A additive metadata. All fields optional for backward compat
   *  with rows persisted before the Hybrid RAG hardening landed. */
  kind?: ChunkKind;
  source?: ChunkSource;
  pageStart?: number;
  pageEnd?: number;
  /** Heuristic 0..1 score for fact density. Used by Phase C and by the
   *  runtime to break ties when multiple raw chunks score similarly. */
  qualityScore?: number;
  tokenEstimate?: number;
  visibility?: ChunkVisibility;
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
