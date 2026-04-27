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
import { tier1Rank, decideAnswer } from "../src/lib/portal/ask-runtime-logic.mjs";
import { buildPropertyQAEntries } from "../src/lib/rag/property-qa-builder.ts";

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
