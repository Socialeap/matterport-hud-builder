/**
 * Pure-logic tests for the quota lifecycle decision rules.
 *
 * These exercise the deriveQuotaState predicate that drives:
 *   - the meta SSE event payload
 *   - the 402 quota_exhausted gate
 *   - the runtime's downgrade form swap
 *
 * Integration tests against a live DB / edge function would round
 * out the picture (call #20 succeeds, call #21 returns 402, BYOK
 * activation flips the state immediately, etc.) and are tracked in
 * the PR description test plan.
 *
 * Run via `node --test --experimental-strip-types`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Inlined copy of the rule. We deliberately do NOT import from the
// edge function (it pulls Deno-only modules that don't load under
// Node). The rule is small, deterministic, and locked here as the
// canonical contract for the runtime + edge function.
function deriveQuotaState(q) {
  if (q.byok_active) {
    return {
      quota_remaining: -1,
      quota_state: "byok_unlimited",
      downgrade_required: false,
    };
  }
  const remaining = Math.max(0, q.free_limit - q.free_used);
  if (remaining === 0) {
    return {
      quota_remaining: 0,
      quota_state: "exhausted",
      downgrade_required: true,
    };
  }
  if (remaining === 1) {
    return {
      quota_remaining: 1,
      quota_state: "exhausted_after_this_answer",
      downgrade_required: true,
    };
  }
  return {
    quota_remaining: remaining,
    quota_state: "ok",
    downgrade_required: false,
  };
}

const baseline = {
  free_used: 0,
  free_limit: 20,
  byok_active: false,
  exhausted_email_sent_at: null,
};

test("fresh property: 20 remaining, ok, no downgrade", () => {
  const s = deriveQuotaState(baseline);
  assert.equal(s.quota_state, "ok");
  assert.equal(s.quota_remaining, 20);
  assert.equal(s.downgrade_required, false);
});

test("answer #19 leaves remaining=1 → exhausted_after_this_answer + downgrade", () => {
  const s = deriveQuotaState({ ...baseline, free_used: 19 });
  assert.equal(s.quota_state, "exhausted_after_this_answer");
  assert.equal(s.quota_remaining, 1);
  assert.equal(s.downgrade_required, true);
});

test("answer #20 leaves remaining=0 → exhausted + downgrade", () => {
  const s = deriveQuotaState({ ...baseline, free_used: 20 });
  assert.equal(s.quota_state, "exhausted");
  assert.equal(s.quota_remaining, 0);
  assert.equal(s.downgrade_required, true);
});

test("answer #21 attempt: still exhausted (Math.max guards underflow)", () => {
  const s = deriveQuotaState({ ...baseline, free_used: 21 });
  assert.equal(s.quota_state, "exhausted");
  assert.equal(s.quota_remaining, 0);
  assert.equal(s.downgrade_required, true);
});

test("BYOK active beats every other state, even when free_used > free_limit", () => {
  const s = deriveQuotaState({
    ...baseline,
    free_used: 50,
    byok_active: true,
  });
  assert.equal(s.quota_state, "byok_unlimited");
  assert.equal(s.quota_remaining, -1);
  assert.equal(s.downgrade_required, false);
});

test("BYOK reinstatement on a previously-exhausted property: state flips immediately", () => {
  const exhausted = deriveQuotaState({ ...baseline, free_used: 20 });
  assert.equal(exhausted.quota_state, "exhausted");
  const reinstated = deriveQuotaState({
    ...baseline,
    free_used: 20,
    byok_active: true,
  });
  assert.equal(reinstated.quota_state, "byok_unlimited");
  assert.equal(reinstated.downgrade_required, false);
});

test("custom free_limit (e.g. promo'd to 100) respected", () => {
  const s = deriveQuotaState({
    ...baseline,
    free_limit: 100,
    free_used: 50,
  });
  assert.equal(s.quota_state, "ok");
  assert.equal(s.quota_remaining, 50);
});
