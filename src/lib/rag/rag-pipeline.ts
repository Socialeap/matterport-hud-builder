/**
 * RAG pipeline orchestrator.
 *
 * Coordinates: chunking → embedding → indexing → querying → synthesis.
 * Owns the lifecycle of the embedding Web Worker and Orama DB.
 */

import type {
  ChatMessage,
  IndexedChunk,
  PipelineStatus,
  PropertyChunk,
  SearchResult,
  SynthesisResponse,
} from "./types";
import { EmbeddingWorkerClient } from "./embedding-worker-client";
import { chunkPropertySpec } from "./property-chunker";
import {
  createPropertyDB,
  indexChunks,
  hybridSearch,
  hybridSearchFor,
  rebuildFor,
  resetDB,
} from "./orama-search";

const SYNTHESIS_FUNCTION = "chat-synthesis";

export type StatusCallback = (status: PipelineStatus, detail?: string) => void;

export class RAGPipeline {
  private worker: EmbeddingWorkerClient | null = null;
  private status: PipelineStatus = "idle";
  private statusListeners = new Set<StatusCallback>();
  private supabaseUrl: string;
  private supabaseAnonKey: string;

  constructor(supabaseUrl: string, supabaseAnonKey: string) {
    this.supabaseUrl = supabaseUrl;
    this.supabaseAnonKey = supabaseAnonKey;
  }

  // ── Status management ───────────────────────────────────────────────

  getStatus(): PipelineStatus {
    return this.status;
  }

  onStatus(cb: StatusCallback): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private setStatus(status: PipelineStatus, detail?: string) {
    this.status = status;
    this.statusListeners.forEach((cb) => cb(status, detail));
  }

  // ── Initialisation ─────────────────────────────────────────────────

  /**
   * Ingest a property specification document.
   * 1. Chunk the document
   * 2. Spin up the embedding worker & generate vectors
   * 3. Store in Orama
   */
  async ingest(propertySpec: string | Record<string, unknown>): Promise<void> {
    try {
      // 1 – Chunk
      this.setStatus("loading-model", "Preparing embedding model…");
      const chunks = chunkPropertySpec(propertySpec);

      if (chunks.length === 0) {
        throw new Error("Property spec produced no chunks");
      }

      // 2 – Create worker & wait for model
      if (!this.worker) {
        this.worker = new EmbeddingWorkerClient();
      }

      this.worker.onInit((msg) => {
        if (msg.type === "init:progress") {
          this.setStatus("loading-model", msg.message);
        }
      });

      await this.worker.init();

      // 3 – Embed all chunks
      this.setStatus("indexing", `Embedding ${chunks.length} chunks…`);

      const texts = chunks.map((c) => `${c.section}: ${c.content}`);
      const embeddings = await this.worker.embedBatch(texts);

      const indexedChunks: IndexedChunk[] = chunks.map((chunk, i) => ({
        ...chunk,
        embedding: embeddings[i],
      }));

      // 4 – Index in Orama
      await resetDB();
      await createPropertyDB();
      await indexChunks(indexedChunks);

      this.setStatus("ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus("error", msg);
      throw err;
    }
  }

  // ── Extraction hydration (Property Docs engine) ────────────────────

  /**
   * Hydrate an asset-scoped Orama DB from already-extracted chunks.
   * Used after a property-doc extraction run to make the chunks
   * searchable client-side via hybrid BM25+vector lookup.
   */
  async hydrateFromExtractions(
    scopeId: string,
    chunks: PropertyChunk[],
  ): Promise<void> {
    if (chunks.length === 0) {
      await rebuildFor(scopeId, []);
      return;
    }
    if (!this.worker) {
      this.worker = new EmbeddingWorkerClient();
      this.worker.onInit((msg) => {
        if (msg.type === "init:progress") {
          this.setStatus("loading-model", msg.message);
        }
      });
    }
    await this.worker.init();

    this.setStatus("indexing", `Embedding ${chunks.length} extraction chunks…`);
    const texts = chunks.map((c) => `${c.section}: ${c.content}`);
    const embeddings = await this.worker.embedBatch(texts);

    const indexed: IndexedChunk[] = chunks.map((c, i) => ({
      ...c,
      embedding: embeddings[i],
    }));
    await rebuildFor(scopeId, indexed);
    this.setStatus("ready");
  }

  /** Hybrid search against a specific asset's DB (not the default scope). */
  async searchAsset(
    scopeId: string,
    question: string,
    topK = 3,
  ): Promise<SearchResult[]> {
    if (!this.worker) throw new Error("Worker not available");
    const queryVec = await this.worker.embed(question);
    return hybridSearchFor(scopeId, question, queryVec, topK);
  }

  // ── Query ──────────────────────────────────────────────────────────

  /**
   * Run the full RAG pipeline for a user question.
   *
   * @returns The synthesised assistant answer.
   */
  async query(
    question: string,
    chatHistory: ChatMessage[] = [],
  ): Promise<string> {
    if (this.status !== "ready") {
      throw new Error(`Pipeline not ready (status: ${this.status})`);
    }

    try {
      // 1 – Embed the question
      this.setStatus("searching");

      if (!this.worker) {
        throw new Error("Worker not available");
      }

      const queryVec = await this.worker.embed(question);

      // 2 – Hybrid search
      const results = await hybridSearch(question, queryVec, 3);

      if (results.length === 0) {
        this.setStatus("ready");
        return "I couldn't find any relevant information in the property specifications for that question.";
      }

      // 3 – Synthesise via Supabase Edge Function
      this.setStatus("synthesizing");

      const answer = await this.synthesize(question, results, chatHistory);

      this.setStatus("ready");
      return answer;
    } catch (err) {
      this.setStatus("ready"); // recover to ready so user can retry
      throw err;
    }
  }

  // ── Synthesis ─────────────────────────────────────────────────────

  private async synthesize(
    question: string,
    context: SearchResult[],
    history: ChatMessage[],
  ): Promise<string> {
    const recentHistory = history.slice(-3);

    const url = `${this.supabaseUrl}/functions/v1/${SYNTHESIS_FUNCTION}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.supabaseAnonKey}`,
      },
      body: JSON.stringify({ query: question, context, history: recentHistory }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`Synthesis failed (${res.status}): ${text}`);
    }

    const data: SynthesisResponse = await res.json();

    if (data.error) {
      throw new Error(data.error);
    }

    return data.answer;
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    resetDB();
    this.setStatus("idle");
  }
}
