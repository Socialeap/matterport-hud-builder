#!/usr/bin/env node

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildCanonicalQAs } from "../src/lib/rag/canonical-questions.ts";

test("canonical QAs do not infer spa from fields containing space", () => {
  const qas = buildCanonicalQAs({
    outdoor_space: "A patio overlooking the Chaska Paseo.",
    workspace_variety: "Private offices, coworking areas, and meeting rooms.",
  });

  const questions = qas.map((q) => q.question.toLowerCase());
  assert.ok(
    questions.some((q) => q.includes("outdoor space")),
    "outdoor_space should still get natural field-name questions",
  );
  assert.equal(
    questions.some((q) => /\bspa\b/.test(q) || q.includes("spa services")),
    false,
    `Generated spa questions from non-spa fields: ${questions.join(" | ")}`,
  );
});
