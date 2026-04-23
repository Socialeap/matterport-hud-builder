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

/** Hard ceiling for model download + pipeline construction. The Xenova
 *  ~23 MB bundle should comfortably arrive inside this window even on
 *  3G; anything longer is almost certainly a wedged CDN fetch or a
 *  silently-broken WebGPU init we want to surface. */
const INIT_TIMEOUT_MS = 60_000;

/** Per-batch embed timeout. Scales with batch size so legitimately long
 *  jobs (e.g. a 169-chunk Wikipedia article on cold WASM) still finish,
 *  while a stuck worker is detected within a reasonable bound. */
function embedTimeoutMs(batchSize: number) {
  return Math.max(45_000, batchSize * 1500);
}

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
  /** Tracks the in-flight init() promise so handleError can reject it. */
  private pendingInit: { reject: (e: Error) => void } | null = null;

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

  /** Trigger model download + init. Resolves once ready, rejects on failure
   *  or after INIT_TIMEOUT_MS, whichever comes first. */
  init(): Promise<void> {
    if (this.ready) return Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        this.pendingInit = null;
        fn();
      };

      const unsub = this.onInit((msg) => {
        if (msg.type === "init:ready") {
          settle(() => resolve());
        } else if (msg.type === "init:error") {
          settle(() => reject(new Error(msg.error)));
        }
      });

      const timer = setTimeout(() => {
        const errMsg = "embedding model init timed out";
        this.initError = errMsg;
        // Notify any other init listeners so UIs can react too.
        this.initListeners.forEach((l) => l({ type: "init:error", error: errMsg }));
        settle(() => reject(new Error(errMsg)));
      }, INIT_TIMEOUT_MS);

      this.pendingInit = {
        reject: (e) => settle(() => reject(e)),
      };
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
      const timeout = embedTimeoutMs(texts.length);
      const timer = setTimeout(() => {
        // Drop the pending entry so a late embed:result is silently ignored.
        if (this.pendingEmbeds.has(id)) {
          this.pendingEmbeds.delete(id);
          reject(
            new Error(
              `embedding batch timed out after ${Math.round(timeout / 1000)}s (${texts.length} texts)`,
            ),
          );
        }
      }, timeout);

      this.pendingEmbeds.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
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
    if (this.pendingInit) {
      this.pendingInit.reject(new Error("Worker terminated"));
      this.pendingInit = null;
    }
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
    // Reject in-flight init promise too — previously these were silently
    // swallowed if no init listener was attached at the moment of error.
    if (this.pendingInit) {
      this.pendingInit.reject(new Error(message));
      this.pendingInit = null;
    }
    // Reset readiness so subsequent callers can retry from scratch.
    this.ready = false;
    this.initError = message;
    // Notify init listeners.
    this.initListeners.forEach((l) =>
      l({ type: "init:error", error: message })
    );
  };
}
