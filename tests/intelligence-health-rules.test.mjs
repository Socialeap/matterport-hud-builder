/**
 * Unit tests for the intelligence_health decision rules. Run with
 * `node --test --experimental-strip-types`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const mod = await import("../src/lib/intelligence/health.ts");
const FIXED_NOW = "2026-04-27T00:00:00.000Z";

test("0 fields + 0 chunks => failed", () => {
  const h = mod.computeIntelligenceHealth(
    {
      field_count: 0,
      canonical_qa_count: 0,
      chunk_count: 0,
      embedded_chunk_count: 0,
      candidate_field_count: 0,
      evidence_unit_count: 0,
    },
    FIXED_NOW,
  );
  assert.equal(h.status, "failed");
});

test("0 fields + 0 canonical_qa + chunks > 0 => context_only_degraded", () => {
  const h = mod.computeIntelligenceHealth(
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
});

test("learned fields + indexed evidence + good score => ready", () => {
  const h = mod.computeIntelligenceHealth(
    {
      field_count: 6,
      canonical_qa_count: 6,
      chunk_count: 8,
      embedded_chunk_count: 8,
      candidate_field_count: 0,
      evidence_unit_count: 14,
    },
    FIXED_NOW,
  );
  assert.equal(h.status, "ready");
});

test("fields without indexed chunks => degraded (RAG not yet ready)", () => {
  const h = mod.computeIntelligenceHealth(
    {
      field_count: 3,
      canonical_qa_count: 2,
      chunk_count: 5,
      embedded_chunk_count: 0,
      candidate_field_count: 0,
      evidence_unit_count: 0,
    },
    FIXED_NOW,
  );
  assert.equal(h.status, "degraded");
});

test("warnings present => never ready", () => {
  const h = mod.computeIntelligenceHealth(
    {
      field_count: 6,
      canonical_qa_count: 6,
      chunk_count: 8,
      embedded_chunk_count: 8,
      candidate_field_count: 0,
      evidence_unit_count: 14,
      warnings: ["thin_content"],
    },
    FIXED_NOW,
  );
  assert.equal(h.status, "degraded");
});

test("blocking_errors force failed regardless of counts", () => {
  const h = mod.computeIntelligenceHealth(
    {
      field_count: 6,
      canonical_qa_count: 6,
      chunk_count: 8,
      embedded_chunk_count: 8,
      candidate_field_count: 0,
      evidence_unit_count: 14,
      blocking_errors: ["llm_unavailable"],
    },
    FIXED_NOW,
  );
  assert.equal(h.status, "failed");
});

test("explicit status override is respected", () => {
  const h = mod.computeIntelligenceHealth(
    {
      field_count: 6,
      canonical_qa_count: 6,
      chunk_count: 8,
      embedded_chunk_count: 8,
      candidate_field_count: 0,
      evidence_unit_count: 14,
      status: "degraded",
    },
    FIXED_NOW,
  );
  assert.equal(h.status, "degraded");
});

test("isAnswerReady is true only for ready", () => {
  const make = (status) => ({
    version: 1,
    status,
    field_count: 0,
    canonical_qa_count: 0,
    chunk_count: 0,
    embedded_chunk_count: 0,
    candidate_field_count: 0,
    evidence_unit_count: 0,
    answerability_score: 0,
    warnings: [],
    blocking_errors: [],
    source_asset_id: null,
    property_uuid: null,
    saved_model_id: null,
    updated_at: FIXED_NOW,
  });
  assert.equal(mod.isAnswerReady(make("ready")), true);
  assert.equal(mod.isAnswerReady(make("degraded")), false);
  assert.equal(mod.isAnswerReady(make("failed")), false);
  assert.equal(mod.isAnswerReady(make("context_only_degraded")), false);
  assert.equal(mod.isAnswerReady(null), false);
});

test("hasAnyIntelligence is false only for failed/null", () => {
  const make = (status) => ({
    version: 1,
    status,
    field_count: 0,
    canonical_qa_count: 0,
    chunk_count: 0,
    embedded_chunk_count: 0,
    candidate_field_count: 0,
    evidence_unit_count: 0,
    answerability_score: 0,
    warnings: [],
    blocking_errors: [],
    source_asset_id: null,
    property_uuid: null,
    saved_model_id: null,
    updated_at: FIXED_NOW,
  });
  assert.equal(mod.hasAnyIntelligence(make("ready")), true);
  assert.equal(mod.hasAnyIntelligence(make("degraded")), true);
  assert.equal(mod.hasAnyIntelligence(make("context_only_degraded")), true);
  assert.equal(mod.hasAnyIntelligence(make("failed")), false);
  assert.equal(mod.hasAnyIntelligence(null), false);
});

test("describeIntelligenceHealth — ready vs context_only_degraded use distinct copy", () => {
  const ready = mod.computeIntelligenceHealth(
    {
      field_count: 6,
      canonical_qa_count: 6,
      chunk_count: 8,
      embedded_chunk_count: 8,
      candidate_field_count: 0,
      evidence_unit_count: 14,
    },
    FIXED_NOW,
  );
  const ctxOnly = mod.computeIntelligenceHealth(
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
  const readyCopy = mod.describeIntelligenceHealth(ready, "Property 1");
  const ctxCopy = mod.describeIntelligenceHealth(ctxOnly, "Property 1");
  assert.equal(readyCopy.tone, "success");
  assert.equal(ctxCopy.tone, "warning");
  assert.notEqual(readyCopy.heading, ctxCopy.heading);
  assert.notEqual(readyCopy.detail, ctxCopy.detail);
});
