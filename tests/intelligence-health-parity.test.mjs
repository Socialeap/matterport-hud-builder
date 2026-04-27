/**
 * Parity test: the browser-side and Deno-side intelligence-health
 * modules must produce identical results for matched inputs. They
 * live in two files because Supabase edge functions can't import
 * from `src/lib/*` — but they must stay in lockstep. If you change
 * one, change the other; this test will fail if they drift.
 *
 * Run with `node --test --experimental-strip-types`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const browserMod = await import("../src/lib/intelligence/health.ts");
const denoMod = await import(
  "../supabase/functions/_shared/intelligence-health.ts"
);

const FIXED_NOW = "2026-04-27T00:00:00.000Z";

const MATRIX = [
  {
    name: "all-zero produces failed",
    input: {
      field_count: 0,
      canonical_qa_count: 0,
      chunk_count: 0,
      embedded_chunk_count: 0,
      candidate_field_count: 0,
      evidence_unit_count: 0,
    },
  },
  {
    name: "0 fields, 3 chunks indexed -> context_only_degraded",
    input: {
      field_count: 0,
      canonical_qa_count: 0,
      chunk_count: 3,
      embedded_chunk_count: 3,
      candidate_field_count: 0,
      evidence_unit_count: 0,
    },
  },
  {
    name: "5 fields + 8 chunks indexed -> ready",
    input: {
      field_count: 5,
      canonical_qa_count: 5,
      chunk_count: 8,
      embedded_chunk_count: 8,
      candidate_field_count: 0,
      evidence_unit_count: 12,
    },
  },
  {
    name: "fields exist but unembedded chunks -> degraded",
    input: {
      field_count: 3,
      canonical_qa_count: 2,
      chunk_count: 5,
      embedded_chunk_count: 0,
      candidate_field_count: 0,
      evidence_unit_count: 0,
    },
  },
  {
    name: "warnings demote ready to degraded",
    input: {
      field_count: 5,
      canonical_qa_count: 5,
      chunk_count: 8,
      embedded_chunk_count: 8,
      candidate_field_count: 0,
      evidence_unit_count: 12,
      warnings: ["thin_content"],
    },
  },
  {
    name: "blocking_errors force failed",
    input: {
      field_count: 5,
      canonical_qa_count: 5,
      chunk_count: 8,
      embedded_chunk_count: 8,
      candidate_field_count: 0,
      evidence_unit_count: 12,
      blocking_errors: ["extraction_aborted"],
    },
  },
];

test("intelligence-health parity: client mirror == deno mirror", () => {
  for (const row of MATRIX) {
    const a = browserMod.computeIntelligenceHealth(row.input, FIXED_NOW);
    const b = denoMod.computeIntelligenceHealth(row.input, FIXED_NOW);
    assert.deepEqual(a, b, `mismatch for case: ${row.name}`);
  }
});

test("intelligence-health parity: answerability score matches", () => {
  for (const row of MATRIX) {
    const a = browserMod.computeAnswerabilityScore(row.input);
    const b = denoMod.computeAnswerabilityScore(row.input);
    assert.equal(a, b, `score mismatch for case: ${row.name}`);
  }
});

test("intelligence-health parity: version constant matches", () => {
  assert.equal(
    browserMod.INTELLIGENCE_HEALTH_VERSION,
    denoMod.INTELLIGENCE_HEALTH_VERSION,
  );
});
