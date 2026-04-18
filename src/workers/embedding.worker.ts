/**
 * Web Worker for generating text embeddings using transformers.js.
 *
 * The Xenova/all-MiniLM-L6-v2 model downloads ~23 MB of WASM + ONNX weights
 * on first run. All matrix math happens inside this worker so the main thread
 * never blocks.
 */

import type { WorkerRequest, WorkerResponse } from "@/lib/rag/types";

/** Loosely typed pipeline callable – avoids complex overload unions from transformers.js */
type FeatureExtractor = (
  text: string,
  options: Record<string, unknown>,
) => Promise<{ data: Float32Array }>;

let extractor: FeatureExtractor | null = null;
let initPromise: Promise<void> | null = null;

/** Post a typed response to the main thread. */
function respond(msg: WorkerResponse) {
  self.postMessage(msg);
}

/** Lazy-init: download the model + create the feature-extraction pipeline.
 *  Tries WebGPU first on browsers that expose it (inside a worker, via
 *  `self.navigator.gpu`), then falls back cleanly to the default WASM
 *  backend. `dtype: "q8"` is requested in both paths so cold-load
 *  bandwidth is minimised relative to v4's fp32 default. */
async function ensureInitialized(): Promise<void> {
  if (extractor) return;

  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      respond({ type: "init:progress", message: "Downloading embedding model…" });

      // Dynamic import so the heavy WASM bundle is only pulled when needed.
      const tf = await import("@huggingface/transformers");
      const { pipeline, env } = tf;

      // Disable local model caching fallback (browser Cache API is used instead).
      (env as Record<string, unknown>).allowLocalModels = false;

      respond({ type: "init:progress", message: "Loading model into memory…" });

      // WebGPU-first with WASM fallback. q8 quantisation in both paths
      // to keep cold-load bandwidth down relative to v4's fp32 default.
      const model = "Xenova/all-MiniLM-L6-v2";
      const gpu =
        typeof self !== "undefined" &&
        (self as unknown as { navigator?: { gpu?: unknown } }).navigator?.gpu;
      let pipe: unknown = null;
      if (gpu) {
        try {
          pipe = await pipeline("feature-extraction", model, {
            device: "webgpu",
            dtype: "q8",
          });
        } catch (gpuErr) {
          console.warn(
            "[transformers] webgpu init failed in worker, falling back to wasm:",
            gpuErr,
          );
          pipe = null;
        }
      }
      if (!pipe) {
        pipe = await pipeline("feature-extraction", model, { dtype: "q8" });
      }
      extractor = pipe as unknown as FeatureExtractor;

      respond({ type: "init:ready" });
    } catch (err) {
      extractor = null;
      initPromise = null;
      const message = err instanceof Error ? err.message : String(err);
      respond({ type: "init:error", error: message });
      throw err;
    }
  })();

  return initPromise;
}

/** Generate embeddings for an array of texts. */
async function embed(id: string, texts: string[]) {
  try {
    await ensureInitialized();

    if (!extractor) {
      respond({ type: "embed:error", id, error: "Model failed to initialize" });
      return;
    }

    const embeddings: number[][] = [];

    for (const text of texts) {
      const output = await extractor(text, {
        pooling: "mean",
        normalize: true,
      });
      embeddings.push(Array.from(output.data));
    }

    respond({ type: "embed:result", id, embeddings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    respond({ type: "embed:error", id, error: message });
  }
}

// ── Message handler ─────────────────────────────────────────────────────

self.addEventListener("message", (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;

  switch (msg.type) {
    case "init":
      ensureInitialized();
      break;

    case "embed":
      embed(msg.id, msg.texts);
      break;
  }
});
