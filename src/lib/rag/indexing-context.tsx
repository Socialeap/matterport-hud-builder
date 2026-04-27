/**
 * IndexingProvider — page-scoped singleton coordinator for property
 * extraction embedding/QA enrichment.
 *
 * Solves a real bug: previously each `usePropertyExtractions` instance
 * spun up its OWN `EmbeddingWorkerClient`, and when both PropertyDocsPanel
 * and PropertyIntelligenceSection mounted for the same property they
 * raced — two workers downloading the same 23 MB Xenova model in parallel,
 * one winning, the other appearing stuck on "Preparing…" forever.
 *
 * Architecture:
 *   - One shared `EmbeddingWorkerClient` per provider instance (lazy).
 *   - `Map<propertyUuid, IndexingStatus>` so any subscribing component
 *     sees the SAME status for the SAME property.
 *   - `Map<propertyUuid, Promise>` so concurrent `request(uuid)` calls
 *     dedupe to a single in-flight job.
 *   - Per-job hard timeout + force-resolve fallback that re-checks the
 *     DB row before declaring failure (the work may have actually
 *     finished while the worker promise hung).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { supabase } from "@/integrations/supabase/client";
import { ensureExtractionEmbeddings } from "./extraction-hydrator";
import { EmbeddingWorkerClient } from "./embedding-worker-client";
import { EMBEDDING_DIM } from "./types";
import { parseIntelligenceHealth } from "@/lib/intelligence/health";

export type IndexingPhase = "idle" | "indexing" | "ready" | "failed";

export interface IndexingStatus {
  phase: IndexingPhase;
  message: string | null;
  /** Wall-clock when the current phase began — used for "Taking longer
   *  than usual?" UX in the badge. */
  startedAt: number | null;
}

interface IndexingContextValue {
  statusFor: (uuid: string | null) => IndexingStatus;
  request: (uuid: string) => Promise<void>;
  /** Like `request` but bypasses the in-flight dedupe AND the
   *  already-enriched fast-path. Used by the "Re-index" button. */
  requestForce: (uuid: string) => Promise<void>;
  subscribe: (uuid: string, listener: (s: IndexingStatus) => void) => () => void;
}

const IndexingContext = createContext<IndexingContextValue | null>(null);

const IDLE_STATUS: IndexingStatus = {
  phase: "idle",
  message: null,
  startedAt: null,
};

/** Hard ceiling per property indexing job. */
const JOB_TIMEOUT_MS = 90_000;

const log = (...args: unknown[]) => console.info("[indexing]", ...args);

export function IndexingProvider({ children }: { children: ReactNode }) {
  const workerRef = useRef<EmbeddingWorkerClient | null>(null);
  const inflightRef = useRef<Map<string, Promise<void>>>(new Map());
  const listenersRef = useRef<Map<string, Set<(s: IndexingStatus) => void>>>(
    new Map(),
  );
  const [statuses, setStatuses] = useState<Map<string, IndexingStatus>>(
    new Map(),
  );

  const setStatus = useCallback((uuid: string, status: IndexingStatus) => {
    setStatuses((prev) => {
      const next = new Map(prev);
      next.set(uuid, status);
      return next;
    });
    const listeners = listenersRef.current.get(uuid);
    if (listeners) for (const l of listeners) l(status);
    log(uuid.slice(0, 8), "→", status.phase, status.message ?? "");
  }, []);

  const getOrSpawnWorker = useCallback(() => {
    if (!workerRef.current) {
      log("spawn worker");
      workerRef.current = new EmbeddingWorkerClient();
    }
    return workerRef.current;
  }, []);

  const respawnWorker = useCallback(() => {
    if (workerRef.current) {
      try {
        workerRef.current.terminate();
      } catch {
        /* ignore */
      }
    }
    workerRef.current = null;
  }, []);

  /** Force-resolve fallback: re-read the row and decide whether the
   *  work is genuinely done. Health-driven: a row is "done" when its
   *  intelligence_health.status is `ready` OR `context_only_degraded`
   *  (the latter is a legitimate steady state — chunks indexed but no
   *  structured fields, see the contract spec). For rows persisted
   *  before C2 shipped (no intelligence_health column), fall back to
   *  the old structural check tightened to require non-empty
   *  canonical_qas — empty arrays no longer count as "done". */
  const forceResolveFromDb = useCallback(
    async (uuid: string): Promise<boolean> => {
      try {
        const { data } = await supabase
          .from("property_extractions")
          .select("chunks, canonical_qas, intelligence_health")
          .eq("property_uuid", uuid);
        if (!data || data.length === 0) return false;
        return data.every((row) => {
          const chunks = Array.isArray(row.chunks) ? row.chunks : [];
          if (chunks.length === 0) return true; // empty rows are "done"
          const health = parseIntelligenceHealth(row.intelligence_health);
          if (health) {
            // Health is the source of truth. `degraded` means indexing
            // hasn't finished yet — keep waiting. `failed` likewise
            // shouldn't short-circuit to ready.
            return (
              health.status === "ready" ||
              health.status === "context_only_degraded"
            );
          }
          // Legacy fallback (no health column).
          const allEmbedded = chunks.every(
            (c) =>
              c &&
              typeof c === "object" &&
              "embedding" in c &&
              Array.isArray((c as { embedding: unknown }).embedding) &&
              ((c as { embedding: number[] }).embedding.length ===
                EMBEDDING_DIM),
          );
          const canonicalQas = Array.isArray(row.canonical_qas)
            ? row.canonical_qas
            : null;
          return (
            allEmbedded && canonicalQas !== null && canonicalQas.length > 0
          );
        });
      } catch (err) {
        log("force-resolve check failed:", err);
        return false;
      }
    },
    [],
  );

  const runJob = useCallback(
    async (uuid: string): Promise<void> => {
      setStatus(uuid, {
        phase: "indexing",
        message: "Preparing model…",
        startedAt: Date.now(),
      });

      const worker = getOrSpawnWorker();

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("indexing job timed out")),
          JOB_TIMEOUT_MS,
        );
      });

      try {
        const job = ensureExtractionEmbeddings([uuid], {
          worker,
          onProgress: (m) => {
            setStatus(uuid, {
              phase: "indexing",
              message: m,
              startedAt: Date.now(),
            });
          },
        });

        const stats = await Promise.race([job, timeoutPromise]);

        if (stats.errors.length > 0) {
          setStatus(uuid, {
            phase: "failed",
            message: stats.errors[0],
            startedAt: null,
          });
          return;
        }

        setStatus(uuid, {
          phase: "ready",
          message:
            stats.rows_enriched > 0 ? "Ready for Ask AI" : "Ready for Ask AI",
          startedAt: null,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log("job error for", uuid.slice(0, 8), msg);

        // Last-chance force-resolve: maybe the work finished but the
        // worker promise hung. Check the DB before reporting failure.
        const actuallyDone = await forceResolveFromDb(uuid);
        if (actuallyDone) {
          log("force-resolved as ready despite worker error");
          setStatus(uuid, {
            phase: "ready",
            message: "Ready for Ask AI",
            startedAt: null,
          });
          return;
        }

        // Genuine failure: respawn worker so the next retry starts clean.
        respawnWorker();
        setStatus(uuid, {
          phase: "failed",
          message: msg,
          startedAt: null,
        });
      }
    },
    [forceResolveFromDb, getOrSpawnWorker, respawnWorker, setStatus],
  );

  const request = useCallback(
    (uuid: string): Promise<void> => {
      const existing = inflightRef.current.get(uuid);
      if (existing) {
        log(uuid.slice(0, 8), "join in-flight job");
        return existing;
      }
      // Fast-path: if the row is already fully enriched, mark ready
      // synchronously without spawning the worker.
      const job = (async () => {
        const alreadyDone = await forceResolveFromDb(uuid);
        if (alreadyDone) {
          setStatus(uuid, {
            phase: "ready",
            message: "Ready for Ask AI",
            startedAt: null,
          });
          return;
        }
        await runJob(uuid);
      })();

      inflightRef.current.set(uuid, job);
      job.finally(() => {
        inflightRef.current.delete(uuid);
      });
      return job;
    },
    [forceResolveFromDb, runJob, setStatus],
  );

  const requestForce = useCallback(
    (uuid: string): Promise<void> => {
      const existing = inflightRef.current.get(uuid);
      if (existing) return existing;
      const job = runJob(uuid);
      inflightRef.current.set(uuid, job);
      job.finally(() => {
        inflightRef.current.delete(uuid);
      });
      return job;
    },
    [runJob],
  );

  const statusFor = useCallback(
    (uuid: string | null): IndexingStatus => {
      if (!uuid) return IDLE_STATUS;
      return statuses.get(uuid) ?? IDLE_STATUS;
    },
    [statuses],
  );

  const subscribe = useCallback(
    (uuid: string, listener: (s: IndexingStatus) => void) => {
      let set = listenersRef.current.get(uuid);
      if (!set) {
        set = new Set();
        listenersRef.current.set(uuid, set);
      }
      set.add(listener);
      return () => {
        set?.delete(listener);
      };
    },
    [],
  );

  // Tear down the worker when the provider unmounts (page change).
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        log("terminate worker on unmount");
        try {
          workerRef.current.terminate();
        } catch {
          /* ignore */
        }
        workerRef.current = null;
      }
    };
  }, []);

  const value = useMemo<IndexingContextValue>(
    () => ({ statusFor, request, requestForce, subscribe }),
    [statusFor, request, requestForce, subscribe],
  );

  return (
    <IndexingContext.Provider value={value}>
      {children}
    </IndexingContext.Provider>
  );
}

/** Read the indexing context. Returns a no-op fallback when called
 *  outside a provider so non-builder routes don't crash. */
export function useIndexing(): IndexingContextValue {
  const ctx = useContext(IndexingContext);
  if (ctx) return ctx;
  return {
    statusFor: () => IDLE_STATUS,
    request: async () => {},
    requestForce: async () => {},
    subscribe: () => () => {},
  };
}
