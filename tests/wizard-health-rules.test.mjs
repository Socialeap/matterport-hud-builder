/**
 * Wizard / UI logic tests against the intelligence_health contract.
 *
 * These tests pin three concrete rules that prevent regressing the
 * "0 learned fields shown as success" symptom:
 *
 *   1. A `failed` health blocks TrainingStep from calling onComplete.
 *      We simulate the relevant branch (the actual component renders
 *      via React; we test the logical predicate).
 *
 *   2. A `context_only_degraded` health must not produce success-tone
 *      copy out of describeIntelligenceHealth().
 *
 *   3. The AssetStatusRow row-status decision tree must never produce
 *      `"ready"` for a row whose health is anything other than
 *      `"ready"` — even when chunks > 0.
 *
 * Run via `node --test --experimental-strip-types tests/wizard-health-rules.test.mjs`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const health = await import("../src/lib/intelligence/health.ts");
const FIXED_NOW = "2026-04-27T00:00:00.000Z";

// Replicate the decision tree from PropertyIntelligenceSection's
// AssetStatusRow so we can assert it without rendering React.
function rowStatus({
  failure,
  extraction,
}) {
  if (failure) return "failed";
  if (!extraction) return "pending";
  const h = extraction.intelligence_health ?? null;
  if (h) {
    if (h.status === "ready") return "ready";
    if (h.status === "context_only_degraded") return "context_only";
    if (h.status === "failed") return "needs_review";
    return "pending";
  }
  return "pending";
}

test("TrainingStep predicate: failed health must block onComplete", () => {
  const h = health.computeIntelligenceHealth(
    {
      field_count: 0,
      canonical_qa_count: 0,
      chunk_count: 0,
      embedded_chunk_count: 0,
      candidate_field_count: 0,
      evidence_unit_count: 0,
      blocking_errors: ["llm_unavailable"],
    },
    FIXED_NOW,
  );
  // The wizard's predicate is exactly `health.status === "failed"`.
  assert.equal(h.status, "failed");
});

test("describeIntelligenceHealth: context_only_degraded does NOT use success tone", () => {
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
  const copy = health.describeIntelligenceHealth(h, "Property 1");
  assert.notEqual(copy.tone, "success");
  // The exact symptom: must not match the legacy "now familiar" copy.
  assert.equal(
    copy.heading.includes("now familiar"),
    false,
    "context_only_degraded must not show the success heading",
  );
});

test("describeIntelligenceHealth: failed shows error tone with retry guidance", () => {
  const h = health.computeIntelligenceHealth(
    {
      field_count: 0,
      canonical_qa_count: 0,
      chunk_count: 0,
      embedded_chunk_count: 0,
      candidate_field_count: 0,
      evidence_unit_count: 0,
      blocking_errors: ["extraction_aborted"],
    },
    FIXED_NOW,
  );
  const copy = health.describeIntelligenceHealth(h, "Property 1");
  assert.equal(copy.tone, "error");
  assert.ok(
    copy.nextAction && copy.nextAction.length > 0,
    "failed must offer a next action",
  );
});

test("AssetStatusRow rule: chunks>0 + 0 fields => row never reads as 'ready'", () => {
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
  const status = rowStatus({
    failure: null,
    extraction: { chunks: [{}, {}, {}], intelligence_health: h },
  });
  // The bug we are fixing: this used to be "ready" because chunkCount > 0.
  assert.equal(status, "context_only");
  assert.notEqual(status, "ready");
});

test("AssetStatusRow rule: legacy row without health stays 'pending', not 'ready'", () => {
  const status = rowStatus({
    failure: null,
    extraction: { chunks: [{}, {}, {}], intelligence_health: null },
  });
  assert.equal(status, "pending");
});

test("AssetStatusRow rule: ready health with chunks => row is 'ready'", () => {
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
  const status = rowStatus({
    failure: null,
    extraction: { chunks: new Array(8).fill({}), intelligence_health: h },
  });
  assert.equal(status, "ready");
});

test("AssetStatusRow rule: failure overrides everything", () => {
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
  const status = rowStatus({
    failure: { stage: "auth", detail: "x", status: 401, at: 0 },
    extraction: { chunks: new Array(8).fill({}), intelligence_health: h },
  });
  assert.equal(status, "failed");
});
