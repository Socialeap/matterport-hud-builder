#!/usr/bin/env node
// Regression tests for the Ask AI local runtime.
//
// Runs under Node's built-in test runner (no vitest, no jest, no extra
// devDeps). Imports the three .mjs modules directly — the exact same
// files that portal.functions.ts reads verbatim to embed in the
// downloaded HTML.
//
// Run:   node --test scripts/test-ask-runtime.mjs
// Or:    npm run test:ask

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyIntent, intentAllows, tagQAIntents } from "../src/lib/portal/ask-intents.mjs";
import { buildPropertyBrain } from "../src/lib/portal/property-brain.mjs";
import { decideAnswer } from "../src/lib/portal/ask-runtime-logic.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.resolve(__dirname, "..", "tests/fixtures/marriott-brain.fixture.json");
const FIXTURE = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));

function brainFromFixture() {
  const cfg = FIXTURE.config;
  const uuid = cfg.propertyUuidByIndex[0];
  const entries = FIXTURE.propertyExtractions[uuid] || [];
  return buildPropertyBrain({
    propertyIndex: 0,
    propertyUuid: uuid,
    configProperty: cfg.properties[0],
    agent: cfg.agent,
    brandName: cfg.brandName,
    extractionEntries: entries,
    curatedQAs: FIXTURE.qaDatabase,
    hasDocs: true,
    hasQA: true,
    tagIntents: tagQAIntents,
  });
}

function run(query, opts = {}) {
  const brain = brainFromFixture();
  const { intent } = classifyIntent(query);
  return decideAnswer({
    brain,
    query,
    queryVec: null,
    intent,
    intentAllows,
    curatedHits: [],
    chunkHits: (brain.chunks || []).map((c) => ({
      id: c.id,
      source: c.section,
      section: c.section,
      content: c.content,
      templateLabel: c.templateLabel,
      score: 0.5,
    })),
    canSynthesize: opts.canSynthesize === true ? true : false,
  });
}

function assertMissing(haystack, needles) {
  const lower = String(haystack).toLowerCase();
  for (const n of needles) {
    assert.ok(
      !lower.includes(String(n).toLowerCase()),
      `Answer must not contain "${n}". Got: ${JSON.stringify(haystack)}`
    );
  }
}

function assertAnyOf(haystack, needles) {
  if (!needles || needles.length === 0) return;
  const lower = String(haystack).toLowerCase();
  const hit = needles.some((n) => lower.includes(String(n).toLowerCase()));
  assert.ok(
    hit,
    `Answer should mention one of [${needles.join(", ")}]. Got: ${JSON.stringify(haystack)}`
  );
}

test("Ask AI regression — Marriott fixture", async (t) => {
  for (const q of FIXTURE.questions) {
    await t.test(q.q, () => {
      const classification = classifyIntent(q.q);
      assert.equal(
        classification.intent,
        q.expectedIntent,
        `Intent mismatch for "${q.q}": got ${classification.intent}, expected ${q.expectedIntent}`
      );
      const decision = run(q.q);
      assert.ok(
        q.expectedPaths.includes(decision.path),
        `Path mismatch for "${q.q}": got ${decision.path}, expected one of [${q.expectedPaths.join(", ")}]`
      );
      assertMissing(decision.text, q.mustNotContain || []);
      if ((q.mayContain || []).length > 0) {
        // mayContain is treated as "at least one must appear" only for
        // paths that produced a concrete answer. strict_unknown and
        // empty-text synthesis paths are allowed to miss mayContain.
        if (decision.path !== "strict_unknown" && decision.text) {
          assertAnyOf(decision.text, q.mayContain);
        }
      }
    });
  }
});

test("intent taxonomy — known failure cases are blocked by field-compat", () => {
  assert.equal(intentAllows("number_of_rooms", "ballrooms_count"), false,
    "ballrooms_count MUST NOT allow number_of_rooms");
  assert.equal(intentAllows("number_of_ballrooms", "ballrooms_count"), true,
    "ballrooms_count MUST allow number_of_ballrooms");

  assert.equal(intentAllows("agent_name", "designer_architect"), false,
    "designer_architect MUST NOT allow agent_name");
  assert.equal(intentAllows("architect", "designer_architect"), true,
    "designer_architect MUST allow architect");
  assert.equal(intentAllows("designer", "designer_architect"), true);

  assert.equal(intentAllows("number_of_rooms", "booking"), false,
    "booking MUST NOT allow number_of_rooms");
  assert.equal(intentAllows("booking_url", "booking"), true);

  assert.equal(intentAllows("number_of_restaurants", "restaurant_location"), false,
    "restaurant_location MUST NOT allow number_of_restaurants");
  assert.equal(intentAllows("restaurant_floor", "restaurant_location"), true);

  assert.equal(intentAllows("address", "amenity_presence"), false,
    "amenity_presence MUST NOT allow address");
  assert.equal(intentAllows("amenities", "amenity_presence"), true);

  assert.equal(intentAllows("agent_name", "contact_agent"), true);
  assert.equal(intentAllows("number_of_rooms", "location"), false,
    "location MUST NOT allow number_of_rooms");
});

test("property brain — actions and entities composed from fixture", () => {
  const brain = brainFromFixture();
  assert.equal(brain.propertyUuid, "11111111-1111-1111-1111-111111111111");
  assert.equal(brain.address, "1535 Broadway, New York, NY 10036");
  assert.ok(brain.directionsUrl && brain.directionsUrl.startsWith("https://maps.google.com/maps?q="),
    "directionsUrl should be composed from address");
  assert.equal(brain.actions.bookingUrl, "https://www.marriott.com/marquis-book");
  assert.equal(brain.actions.officialWebsite, "https://www.marriott.com/hotels/nycmq");
  assert.equal(brain.actions.phone, "+1-212-398-1900",
    "phone should prefer property phone_number over agent.phone");
  assert.equal(brain.agent.email, "jane@example.com");

  // Entities
  assert.equal(brain.entities.ballrooms.length, 3);
  assert.equal(brain.entities.restaurants.length, 3);
  assert.ok(brain.entities.rooms);
  assert.equal(brain.entities.rooms.count, 1966);
  assert.ok(brain.entities.floors);
  assert.equal(brain.entities.floors.count, 49);

  // Reserved PR-2 hooks — must be null in PR-1.
  assert.equal(brain.sourceContextHash, null);
  assert.equal(brain.presentationToken, null);

  // Canonical QA intent tagging is applied.
  const ballroomQA = brain.canonicalQAs.find((q) => q.field === "number_of_ballrooms");
  assert.ok(ballroomQA);
  assert.ok(ballroomQA.intents.includes("ballrooms_count"),
    "number_of_ballrooms QA should be tagged with ballrooms_count intent");
  assert.ok(!ballroomQA.intents.includes("rooms_count"),
    "number_of_ballrooms QA should NOT be tagged with rooms_count intent");
});

test("action resolver — booking path terminates with strict unknown when no URL", () => {
  const brain = brainFromFixture();
  // Simulate a property with no booking data.
  delete brain.fields.booking_url;
  brain.actions.bookingUrl = null;
  brain.actions.officialWebsite = null;
  const decision = decideAnswer({
    brain,
    query: "How do I book a room?",
    queryVec: null,
    intent: "booking",
    intentAllows,
    canSynthesize: true, // ensure we don't accidentally synthesize
  });
  assert.equal(decision.path, "strict_unknown");
  assert.equal(decision.strictUnknown, true);
  assert.ok(!decision.text.toLowerCase().includes("1,966"),
    "strict unknown must NOT leak room count");
});

test("synthesis fallback — signals caller when no local answer found", () => {
  const brain = brainFromFixture();
  const decision = decideAnswer({
    brain,
    query: "zzz unknown question never matches anything",
    queryVec: null,
    intent: "unknown",
    intentAllows,
    chunkHits: [
      { id: "c1", source: "overview", content: "some content", score: 0.4 },
    ],
    canSynthesize: true,
  });
  assert.ok(decision.path === "synthesis" || decision.path === "strict_unknown" || decision.path === "chunk",
    `Unknown query with chunks should route to synthesis/chunk/strict_unknown, got ${decision.path}`);
  if (decision.path === "synthesis") {
    assert.equal(decision.needsSynthesis, true);
    assert.ok(decision.synthChunks.length > 0);
  }
});
