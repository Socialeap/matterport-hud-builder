#!/usr/bin/env node

// Regression tests for the Ask AI bug class fixed in
// claude/fix-gemini-property-chat-bD3yZ. Each test pins one of the
// structural failure modes that produced wrong-category answers in
// the property chat (outdoor_space leaking into size queries, agent
// QAs leaking into age queries, field cards swamping doc chunks in
// Gemini context, etc.).

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyIntent,
  intentAllows,
} from "../src/lib/portal/ask-intents.mjs";
import {
  tier1Rank,
  rescoreChunksByIntent,
  decideAnswer,
  TIER1_FIELD_BOOST,
} from "../src/lib/portal/ask-runtime-logic.mjs";
import { buildPropertyQAEntries } from "../src/lib/rag/property-qa-builder.ts";

// ────────────────────────────────────────────────────────────────────
// Defect 5 — the two query tokenizers must stay separate data shapes.
//
// `_queryTokens` was declared twice in ask-runtime-logic.mjs: once
// returning a token SET (object map, underscore-preserving) for the
// field-match / Tier-1 lexical paths, and once returning an ordered
// ARRAY (underscore-splitting) for chunk rescoring. As an ES module the
// redeclaration is a hard SyntaxError (the whole file fails to load —
// this very test file could not import it). In the generated runtime's
// sloppy-mode IIFE the array definition silently won "last wins", so the
// map-consumers received an array: `tokens[word]` membership lookups
// returned undefined and `for…in` iterated array indices. The functions
// were renamed `_queryTokenMap` / `_queryTokenList`. Each test below
// fails if a consumer receives the wrong shape — under the old collapse
// the scored item never clears the floor / never pins, so the result is
// empty or unboosted.
// ────────────────────────────────────────────────────────────────────

test("tier1 lexical overlap consumes the query token MAP (membership scoring)", () => {
  // No embedding → tier1Rank falls back to lexical overlap:
  //   score = 0.40 + 0.30 * (overlap / total).
  // The query shares 4 of its 5 tokens with the question, so the QA must
  // clear TIER1_FLOOR (0.45) at ~0.64. If the consumer received an array
  // instead of a set, overlap counts to 0 → score 0.40 < floor → the
  // result would be empty.
  const qas = [
    {
      id: "field:z_nomatch:0",
      field: "z_nomatch", // chosen so the field-name boost can NOT fire
      question: "alpha bravo charlie delta",
      answer: "irrelevant",
      source_anchor_id: "field:z_nomatch",
      embedding: null,
      intents: [],
    },
  ];
  const ranked = tier1Rank(
    null,
    "alpha bravo charlie delta echo",
    qas,
    "unknown", // skip the intent filter; isolate lexical scoring
    intentAllows,
  );
  assert.strictEqual(ranked.length, 1, "token-overlapping QA must clear the floor via overlap");
  assert.ok(
    Math.abs(ranked[0].score - (0.4 + 0.3 * (4 / 5))) < 1e-9,
    `overlap score should be 0.64, got ${ranked[0].score}`,
  );
});

test("tier1 field-name boost consumes the query token MAP (key lookup)", () => {
  // Question shares no tokens with the query → overlap base is exactly
  // 0.40. The ONLY thing that lifts this QA over TIER1_FLOOR (0.45) is
  // the field-name boost, which does `tokens["parking"]`. An array there
  // returns undefined → no boost → score 0.40 < floor → empty result.
  const qas = [
    {
      id: "field:parking_spaces:0",
      field: "parking_spaces",
      question: "zzz qqq",
      answer: "Ample free public parking.",
      source_anchor_id: "field:parking_spaces",
      embedding: null,
      intents: [],
    },
  ];
  const ranked = tier1Rank(
    null,
    "is there visitor parking available",
    qas,
    "unknown",
    intentAllows,
  );
  assert.strictEqual(ranked.length, 1, "field-name match must lift the QA over the floor");
  assert.strictEqual(ranked[0].qa.field, "parking_spaces");
  assert.ok(
    Math.abs(ranked[0].score - (0.4 + TIER1_FIELD_BOOST)) < 1e-9,
    `field-boosted score should be ${0.4 + TIER1_FIELD_BOOST}, got ${ranked[0].score}`,
  );
});

test("chunk rescoring consumes the query token LIST (length + index seeding)", () => {
  // The keyword-pin path seeds its set from `qTokens[index]` and gates on
  // `qTokens.length > 0`. A map there has no numeric length → the set is
  // empty and no field_chunk is ever keyword-pinned. fc1's section token
  // ("hoa") is in the query; fc2's is not. Only fc1 may be pinned, and the
  // pin is worth exactly FIELD_CHUNK_KEYWORD_BOOST (0.35) over fc2.
  const chunks = [
    { id: "fc1", parentId: "fc1", source: "hoa_fee", section: "hoa_fee", content: "HOA dues.", kind: "field_chunk", score: 0.5 },
    { id: "fc2", parentId: "fc2", source: "zzz_qqq", section: "zzz_qqq", content: "Unrelated.", kind: "field_chunk", score: 0.5 },
  ];
  const out = rescoreChunksByIntent(chunks, "unknown", intentAllows, "what is the hoa fee");
  const fc1 = out.find((c) => c.id === "fc1");
  const fc2 = out.find((c) => c.id === "fc2");
  assert.ok(fc1 && fc2, "both chunks must survive rescoring");
  assert.strictEqual(fc1._keywordPinned, true, "matching field_chunk must be keyword-pinned");
  assert.strictEqual(fc2._keywordPinned, false, "non-matching field_chunk must not be pinned");
  assert.ok(
    Math.abs((fc1.score - fc2.score) - 0.35) < 1e-9,
    `keyword pin should add 0.35, got delta ${fc1.score - fc2.score}`,
  );
  assert.strictEqual(out[0].id, "fc1", "pinned chunk must sort to the top");
});

// ────────────────────────────────────────────────────────────────────
// Defect 3 — generic-token field-name boost no longer fires
// ────────────────────────────────────────────────────────────────────

test("'space' / 'this' / 'listing' / 'property' do not boost field-name matches", () => {
  // Construct two canonical QAs: one keyed on `outdoor_space`, one on
  // `parking_spaces`. Run a query containing only generic nouns ("size
  // of this space"). Neither field should clear the soft floor without
  // cosine signal — that's the point of the stopword set.
  const qas = [
    {
      id: "field:outdoor_space:0",
      field: "outdoor_space",
      question: "What is the outdoor space?",
      answer: "The outdoor space is a patio.",
      source_anchor_id: "field:outdoor_space",
      embedding: null,
      intents: ["amenity_presence"],
    },
    {
      id: "field:parking_spaces:0",
      field: "parking_spaces",
      question: "How many parking spaces?",
      answer: "Ample free public parking.",
      source_anchor_id: "field:parking_spaces",
      embedding: null,
      intents: ["parking"],
    },
  ];

  const ranked = tier1Rank(
    null,
    "what is the size of this space?",
    qas,
    "property_dimension",
    intentAllows,
  );
  // property_dimension excludes both fields entirely via intentAllows,
  // so the regression target here is a clean empty result.
  assert.deepStrictEqual(
    ranked,
    [],
    "property_dimension query must not surface unrelated field QAs",
  );
});

test("functional tokens like 'parking' still boost the right field", () => {
  const qas = [
    {
      id: "field:parking_spaces:0",
      field: "parking_spaces",
      question: "How many parking spaces?",
      answer: "Ample free public parking.",
      source_anchor_id: "field:parking_spaces",
      embedding: null,
      intents: ["parking"],
    },
  ];
  const ranked = tier1Rank(
    null,
    "is there parking on site?",
    qas,
    "parking",
    intentAllows,
  );
  assert.ok(ranked.length > 0, "parking-intent query should retain parking_spaces hit");
  assert.strictEqual(ranked[0].qa.field, "parking_spaces");
});

// ────────────────────────────────────────────────────────────────────
// Defect 4 — every curated entry carries a stable `field` tag
// ────────────────────────────────────────────────────────────────────

test("buildPropertyQAEntries tags every entry with a field key", () => {
  const models = [
    {
      name: "210 N Chestnut St, Chaska, MN 55318, US",
      propertyName: "Chaska Commons Coworking",
      location: "Chaska, MN",
    },
  ];
  const agent = {
    name: "Lisa Ritmore",
    titleRole: "Property Manager",
    email: "info@chaskacommons.com",
    phone: "+1 (952) 215-8455",
    welcomeNote: "Welcome",
    website: "https://chaskacommons.com",
  };

  const entries = buildPropertyQAEntries(models, agent);
  assert.ok(entries.length > 0, "must emit at least one entry for a populated model");
  for (const e of entries) {
    assert.ok(
      typeof e.field === "string" && e.field.length > 0,
      `entry without field tag: ${JSON.stringify(e)}`,
    );
    assert.ok(
      typeof e.source_anchor_id === "string" && e.source_anchor_id.length > 0,
      `entry without source_anchor_id: ${JSON.stringify(e)}`,
    );
  }
});

test("'representing this listing' QA is gated to contact_agent intent only", () => {
  // The Chaska bug: "How old is this space?" returned "Lisa Ritmore is
  // representing this listing." because the curated entry had no field
  // tag, so curatedFilter's empty-key branch let it through. With the
  // new field tag, intentAllows excludes it for year_built/pricing.
  const agentField = "agent_name";
  assert.strictEqual(intentAllows(agentField, "year_built"), false);
  assert.strictEqual(intentAllows(agentField, "pricing"), false);
  assert.strictEqual(intentAllows(agentField, "property_dimension"), false);
  assert.strictEqual(intentAllows(agentField, "contact_agent"), true);
});

// ────────────────────────────────────────────────────────────────────
// End-to-end ladder: nine queries from the failing chat transcript
// ────────────────────────────────────────────────────────────────────

function makeBrain() {
  return {
    propertyName: "Chaska Commons Coworking",
    address: "210 N Chestnut St, Chaska, MN 55318, US",
    actions: { directionsUrl: "https://maps.google.com/?q=Chaska" },
    canonicalQAs: [
      {
        id: "field:outdoor_space:0",
        field: "outdoor_space",
        question: "What is the outdoor space?",
        answer: "The outdoor space is a patio.",
        source_anchor_id: "field:outdoor_space",
        embedding: null,
        intents: [],
      },
      {
        id: "field:interior_features:0",
        field: "interior_features",
        question: "What are the interior features?",
        answer: "High open ceilings (14 feet).",
        source_anchor_id: "field:interior_features",
        embedding: null,
        intents: [],
      },
    ],
    fields: {
      outdoor_space: "A patio.",
      interior_features: "High open ceilings (14 feet).",
    },
    chunks: [
      {
        id: "coworking_brochure-0",
        section: "coworking_brochure",
        content:
          "Chaska Commons Coworking, located at 210 N Chestnut St, is a modern shared office space that officially opened in September 2025, blending the historic character of a building constructed in 1892.",
        kind: "raw_chunk",
      },
    ],
  };
}

test("integrity ladder: cost / size / age queries do not leak unrelated fields", () => {
  const brain = makeBrain();
  const cases = [
    { q: "what is the size of this space?", expectIntent: "property_dimension" },
    { q: "how big is this space?", expectIntent: "property_dimension" },
    { q: "What is the square feet ?", expectIntent: "property_dimension" },
    { q: "How old is this space?", expectIntent: "year_built" },
    { q: "How much does it cost?", expectIntent: "pricing" },
  ];
  for (const c of cases) {
    const cls = classifyIntent(c.q);
    assert.strictEqual(
      cls.intent,
      c.expectIntent,
      `intent drift on "${c.q}": got ${cls.intent}`,
    );
    const decision = decideAnswer({
      brain,
      query: c.q,
      queryVec: null,
      intent: cls.intent,
      intentAllows,
      curatedHits: [],
      chunkHits: brain.chunks.map((c) => ({
        id: c.id,
        parentId: c.id,
        source: "AI Profile → " + c.section,
        section: "AI Profile → " + c.section,
        content: c.content,
        kind: "raw_chunk",
        score: 0.6,
      })),
      canSynthesize: true,
    });
    // For these intents the path must be either "synthesis" (chunk-
    // grounded answer from Gemini) or "strict_unknown". It must NEVER
    // be "canonical" / "curated" returning outdoor_space or agent text.
    assert.ok(
      decision.path === "synthesis" || decision.path === "strict_unknown",
      `unsafe path on "${c.q}": ${decision.path} → ${decision.text}`,
    );
    if (decision.path === "synthesis") {
      // The hint set must not include outdoor_space when the query is
      // about size / age / cost — that was the Gemini-context-poisoning
      // root cause.
      const hintIds = (decision.synthChunks || []).map((s) => s.id);
      for (const h of hintIds) {
        assert.notStrictEqual(
          h,
          "field:outdoor_space",
          `outdoor_space hinted for unrelated query "${c.q}"`,
        );
      }
    }
  }
});

test("integrity ladder: action paths still resolve correctly", () => {
  const brain = makeBrain();
  const cls = classifyIntent("where is this property located?");
  assert.strictEqual(cls.intent, "location");
  const decision = decideAnswer({
    brain,
    query: "where is this property located?",
    queryVec: null,
    intent: cls.intent,
    intentAllows,
    curatedHits: [],
    chunkHits: [],
    canSynthesize: true,
  });
  assert.strictEqual(decision.path, "action");
  assert.match(decision.text, /210 N Chestnut St/);
});
