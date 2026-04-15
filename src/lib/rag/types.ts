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

// ── Chat types ──────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── Synthesis request/response (edge function) ──────────────────────────

export interface SynthesisRequest {
  query: string;
  context: SearchResult[];
  history: ChatMessage[];
}

export interface SynthesisResponse {
  answer: string;
  error?: string;
}

// ── Pipeline status ─────────────────────────────────────────────────────

export type PipelineStatus =
  | "idle"
  | "loading-model"
  | "indexing"
  | "ready"
  | "searching"
  | "synthesizing"
  | "error";

// ── Pre-computed Q&A types (Layout-Aware RAG) ───────────────────────────

/** Raw Q&A entry returned by the generate-qa-dictionary Edge Function. */
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
