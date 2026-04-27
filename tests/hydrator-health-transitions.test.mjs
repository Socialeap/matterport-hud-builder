/**
 * Tests for the IndexingProvider/extraction-hydrator transitions
 * driven by intelligence_health. We test the predicate logic in
 * isolation (without spinning up Supabase or the worker) by
 * recreating the same decision tree the production code uses.
 *
 * This pins three invariants:
 *
 *   1. A fresh extraction (status="degraded", no embeddings) is
 *      considered "needs work".
 *   2. After embeddings + canonical_qas land, recomputed health flips
 *      to "ready" and the row is "done".
 *   3. A context_only_degraded row (chunks but 0 fields) becomes
 *      "done" once chunks are embedded — never gets stuck re-embedding.
 *
 * Run via `node --test --experimental-strip-types`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const health = await import("../src/lib/intelligence/health.ts");
const FIXED_NOW = "2026-04-27T00:00:00.000Z";

const EMBEDDING_DIM = 384;

function makeChunk(withEmbedding) {
  return {
    id: "x",
    section: "s",
    content: "c",
    embedding: withEmbedding ? new Array(EMBEDDING_DIM).fill(0) : undefined,
  };
}

// Mirror the production rowAlreadyEnriched predicate.
function rowAlreadyEnriched(row) {
  const c = Array.isArray(row.chunks) ? row.chunks : [];
  const allChunksEmbedded =
    c.length > 0 &&
    c.every(
      (x) => Array.isArray(x?.embedding) && x.embedding.length === EMBEDDING_DIM,
    );
  const h = health.parseIntelligenceHealth(row.intelligence_health);
  if (h) {
    if (
      (h.status === "ready" || h.status === "context_only_degraded") &&
      allChunksEmbedded
    ) {
      return true;
    }
    return false;
  }
  const hasCanonicalQas =
    Array.isArray(row.canonical_qas) && row.canonical_qas.length > 0;
  return allChunksEmbedded && hasCanonicalQas;
}

test("fresh extraction (degraded, no embeddings) needs work", () => {
  const h = health.computeIntelligenceHealth(
    {
      field_count: 5,
      canonical_qa_count: 0,
      chunk_count: 8,
      embedded_chunk_count: 0,
      candidate_field_count: 0,
      evidence_unit_count: 4,
    },
    FIXED_NOW,
  );
  assert.equal(h.status, "degraded");
  const row = {
    chunks: [makeChunk(false), makeChunk(false)],
    canonical_qas: [],
    intelligence_health: h,
  };
  assert.equal(rowAlreadyEnriched(row), false);
});

test("after embeddings land + ready health => row is enriched", () => {
  const h = health.computeIntelligenceHealth(
    {
      field_count: 5,
      canonical_qa_count: 5,
      chunk_count: 8,
      embedded_chunk_count: 8,
      candidate_field_count: 0,
      evidence_unit_count: 12,
    },
    FIXED_NOW,
  );
  assert.equal(h.status, "ready");
  const row = {
    chunks: [makeChunk(true), makeChunk(true)],
    canonical_qas: [{ id: "q1", question: "Q?", answer: "A.", field: "x", source_anchor_id: "x" }],
    intelligence_health: h,
  };
  assert.equal(rowAlreadyEnriched(row), true);
});

test("context_only_degraded with embedded chunks + 0 canonical_qas => row is enriched (no re-embed loop)", () => {
  const h = health.computeIntelligenceHealth(
    {
      field_count: 0,
      canonical_qa_count: 0,
      chunk_count: 3,
      embedded_chunk_count: 3,
      candidate_field_count: 0,
      evidence_unit_count: 0,
    },
    FIXED_NOW,
  );
  assert.equal(h.status, "context_only_degraded");
  const row = {
    chunks: [makeChunk(true), makeChunk(true), makeChunk(true)],
    canonical_qas: [],
    intelligence_health: h,
  };
  assert.equal(rowAlreadyEnriched(row), true);
});

test("legacy row (no health) with empty canonical_qas needs work — closes the original bug", () => {
  const row = {
    chunks: [makeChunk(true), makeChunk(true)],
    canonical_qas: [], // Empty array: the old code treated this as enriched.
    intelligence_health: null,
  };
  assert.equal(rowAlreadyEnriched(row), false);
});

test("legacy row (no health) with non-empty canonical_qas + embeddings is enriched", () => {
  const row = {
    chunks: [makeChunk(true), makeChunk(true)],
    canonical_qas: [{ id: "q1", question: "Q?", answer: "A.", field: "x", source_anchor_id: "x" }],
    intelligence_health: null,
  };
  assert.equal(rowAlreadyEnriched(row), true);
});

test("failed health does not short-circuit to enriched even with embeddings", () => {
  const h = health.computeIntelligenceHealth(
    {
      field_count: 5,
      canonical_qa_count: 5,
      chunk_count: 8,
      embedded_chunk_count: 8,
      candidate_field_count: 0,
      evidence_unit_count: 12,
      blocking_errors: ["llm_unavailable"],
    },
    FIXED_NOW,
  );
  assert.equal(h.status, "failed");
  const row = {
    chunks: [makeChunk(true), makeChunk(true)],
    canonical_qas: [{ id: "q1", question: "Q?", answer: "A.", field: "x", source_anchor_id: "x" }],
    intelligence_health: h,
  };
  assert.equal(rowAlreadyEnriched(row), false);
});
