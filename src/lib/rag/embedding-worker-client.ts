/**
 * Main-thread wrapper around the embedding Web Worker.
 *
 * Usage:
 *   const client = new EmbeddingWorkerClient();
 *   await client.init();                       // warm-up (optional, first embed call will auto-init)
 *   const vec = await client.embed("Hello");   // 384-dim vector
 *   const vecs = await client.embedBatch(["a","b"]);
 *   client.terminate();
 */

import type { WorkerRequest, WorkerResponse } from "./types";

type InitListener = (msg: Extract<WorkerResponse, { type: `init:${string}` }>) => void;

export class EmbeddingWorkerClient {
  private worker: Worker | null = null;
  private pendingEmbeds = new Map<
    string,
    { resolve: (v: number[][]) => void; reject: (e: Error) => void }
  >();
  private initListeners = new Set<InitListener>();
  private ready = false;
  private initError: string | null = null;
  private seqId = 0;

  /** Spawn the worker thread. */
  constructor() {
    this.worker = new Worker(
      new URL("../../workers/embedding.worker.ts", import.meta.url),
      { type: "module" }
    );
    this.worker.addEventListener("message", this.handleMessage);
    this.worker.addEventListener("error", this.handleError);
  }

  // ── Public API ──────────────────────────────────────────────────────

  /** Subscribe to initialisation progress events. */
  onInit(listener: InitListener) {
    this.initListeners.add(listener);
    return () => {
      this.initListeners.delete(listener);
    };
  }

  /** Trigger model download + init. Resolves once ready, rejects on failure. */
  init(): Promise<void> {
    if (this.ready) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      const unsub = this.onInit((msg) => {
        if (msg.type === "init:ready") {
          unsub();
          resolve();
        } else if (msg.type === "init:error") {
          unsub();
          reject(new Error(msg.error));
        }
      });
      this.post({ type: "init" });
    });
  }

  /** True once the model has been loaded. */
  get isReady() {
    return this.ready;
  }

  /** Embed a single string. Returns a 384-dim vector. */
  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  /** Embed multiple strings in one round-trip. */
  embedBatch(texts: string[]): Promise<number[][]> {
    if (!this.worker) {
      return Promise.reject(new Error("Worker has been terminated"));
    }

    const id = String(++this.seqId);
    return new Promise((resolve, reject) => {
      this.pendingEmbeds.set(id, { resolve, reject });
      this.post({ type: "embed", id, texts });
    });
  }

  /** Tear down the worker. */
  terminate() {
    if (this.worker) {
      this.worker.removeEventListener("message", this.handleMessage);
      this.worker.removeEventListener("error", this.handleError);
      this.worker.terminate();
      this.worker = null;
    }
    // Reject any pending requests.
    for (const [, { reject }] of this.pendingEmbeds) {
      reject(new Error("Worker terminated"));
    }
    this.pendingEmbeds.clear();
  }

  // ── Internals ───────────────────────────────────────────────────────

  private post(msg: WorkerRequest) {
    this.worker?.postMessage(msg);
  }

  private handleMessage = (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;

    switch (msg.type) {
      case "init:ready":
        this.ready = true;
        this.initError = null;
        this.initListeners.forEach((l) => l(msg));
        break;

      case "init:progress":
        this.initListeners.forEach((l) => l(msg));
        break;

      case "init:error":
        this.initError = msg.error;
        this.initListeners.forEach((l) => l(msg));
        break;

      case "embed:result": {
        const pending = this.pendingEmbeds.get(msg.id);
        if (pending) {
          this.pendingEmbeds.delete(msg.id);
          pending.resolve(msg.embeddings);
        }
        break;
      }

      case "embed:error": {
        const pending = this.pendingEmbeds.get(msg.id);
        if (pending) {
          this.pendingEmbeds.delete(msg.id);
          pending.reject(new Error(msg.error));
        }
        break;
      }
    }
  };

  private handleError = (e: ErrorEvent) => {
    const message = e.message || "Unknown worker error";
    // Reject all pending embeds.
    for (const [, { reject }] of this.pendingEmbeds) {
      reject(new Error(message));
    }
    this.pendingEmbeds.clear();
    // Notify init listeners.
    this.initListeners.forEach((l) =>
      l({ type: "init:error", error: message })
    );
  };
}
