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
import { decideAnswer, extractiveChunkAnswer } from "../src/lib/portal/ask-runtime-logic.mjs";

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

function pineyBrain() {
  return buildPropertyBrain({
    propertyIndex: 0,
    propertyUuid: "piney-1",
    configProperty: {
      id: "piney-1",
      name: "Piney River Ranch",
      propertyName: "Piney River Ranch",
      location: "700 Red Sandstone Vail, CO, 81658",
    },
    agent: {},
    brandName: "Transcendence Media",
    extractionEntries: [
      {
        template_id: "piney",
        template_label: "Piney River Property Doc",
        fields: {
          ceremony_deck_capacity: 200,
          reception_pavilion_capacity: 200,
          reception_pavilion_square_feet: 3054,
          venue_max_capacity: 200,
          catering_cost_per_person: 100,
          on_site_catering: "In-house buffet-style catering is mandatory and starts at $100 per person.",
          bar_service_cost_range: "$51 to $60 per person",
          site_fee_starting: 14000,
          saturday_site_fee: 19000,
          private_island_context: "The ranch is a private island entirely surrounded by thousands of acres of the White River National Forest.",
        },
        chunks: [
          {
            id: "pricing",
            section: "Pricing & Packages",
            content: "Site Fees: According to WeddingWire, 2026 site fees start at $14,000, increasing to $19,000 for Saturdays. In-House Catering: Mandatory buffet-style catering starts at $100 per person. Bar Service: Multi-hour bar packages range from approximately $51 to $60 per person.",
            embedding: null,
            kind: "raw_chunk",
          },
        ],
        canonical_qas: [
          {
            id: "field:bar_service_cost_range:0",
            field: "bar_service_cost_range",
            question: "How much does bar service cost?",
            answer: "Bar service ranges from $51 to $60 per person.",
            source_anchor_id: "field:bar_service_cost_range",
            embedding: null,
          },
          {
            id: "field:site_fee_starting:0",
            field: "site_fee_starting",
            question: "What's the price?",
            answer: "Site fees start at $14,000.",
            source_anchor_id: "field:site_fee_starting",
            embedding: null,
          },
          {
            id: "field:on_site_catering:0",
            field: "on_site_catering",
            question: "Is on-site catering available?",
            answer: "Yes. In-house buffet-style catering is mandatory and starts at $100 per person.",
            source_anchor_id: "field:on_site_catering",
            embedding: null,
          },
          {
            id: "field:reception_pavilion_capacity:0",
            field: "reception_pavilion_capacity",
            question: "What is the capacity of the pavilion?",
            answer: "The Reception Pavilion accommodates up to 200 seated guests.",
            source_anchor_id: "field:reception_pavilion_capacity",
            embedding: null,
          },
          {
            id: "field:ceremony_deck_capacity:0",
            field: "ceremony_deck_capacity",
            question: "How many people does the Ceremony Deck hold?",
            answer: "The Ceremony Deck seats up to 200 guests.",
            source_anchor_id: "field:ceremony_deck_capacity",
            embedding: null,
          },
          {
            id: "field:private_island_context:0",
            field: "private_island_context",
            question: "Is the ranch considered an island?",
            answer: "It is described as a private island because it is surrounded by thousands of acres of White River National Forest.",
            source_anchor_id: "field:private_island_context",
            embedding: null,
          },
        ],
        candidate_fields: {},
        field_provenance: {},
      },
    ],
    curatedQAs: [],
    hasDocs: true,
    hasQA: false,
    tagIntents: tagQAIntents,
  });
}

function runPiney(query) {
  const brain = pineyBrain();
  const { intent } = classifyIntent(query);
  return decideAnswer({
    brain,
    query,
    queryVec: null,
    intent,
    intentAllows,
    curatedHits: [],
    chunkHits: brain.chunks.map((c) => ({
      id: c.id,
      source: c.section,
      section: c.section,
      content: c.content,
      score: 0.8,
      kind: "raw_chunk",
    })),
    canSynthesize: false,
  });
}

function commercialBrain() {
  return buildPropertyBrain({
    propertyIndex: 0,
    propertyUuid: "commercial-1",
    configProperty: {
      id: "commercial-1",
      name: "Generic Mixed-Use Asset",
      propertyName: "Generic Mixed-Use Asset",
      location: "100 Market St, Denver, CO 80202",
    },
    agent: {},
    brandName: "Transcendence Media",
    extractionEntries: [
      {
        template_id: "commercial",
        template_label: "Commercial Offering Memo",
        fields: {
          lease_rate: "$32/SF/YR",
          cam_charges: "$6.50/SF",
          number_of_units: 48,
          rentable_square_feet: 12000,
          clear_height: "24 ft",
          zoning: "C-2",
          cap_rate: "5.8%",
        },
        candidate_fields: [
          {
            key: "dock_doors",
            value: "4 dock-high doors",
            confidence: 0.82,
            evidence: "Dock Doors: 4 dock-high doors",
          },
        ],
        chunks: [
          {
            id: "overview",
            section: "Offering Details",
            content: "Lease Rate: $32/SF/YR. CAM: $6.50/SF. Units: 48. Rentable SF: 12,000. Clear Height: 24 ft. Zoning: C-2. Cap Rate: 5.8%. Dock Doors: 4 dock-high doors.",
            embedding: null,
            kind: "raw_chunk",
          },
        ],
        canonical_qas: [
          {
            id: "field:lease_rate:0",
            field: "lease_rate",
            question: "How much is rent?",
            answer: "The lease rate is $32/SF/YR.",
            source_anchor_id: "field:lease_rate",
            embedding: null,
          },
          {
            id: "field:number_of_units:0",
            field: "number_of_units",
            question: "How many units are there?",
            answer: "It has 48 units.",
            source_anchor_id: "field:number_of_units",
            embedding: null,
          },
          {
            id: "field:rentable_square_feet:0",
            field: "rentable_square_feet",
            question: "How many rentable square feet?",
            answer: "The rentable area is 12,000 square feet.",
            source_anchor_id: "field:rentable_square_feet",
            embedding: null,
          },
          {
            id: "field:clear_height:0",
            field: "clear_height",
            question: "What's the clear height?",
            answer: "The clear height is 24 ft.",
            source_anchor_id: "field:clear_height",
            embedding: null,
          },
          {
            id: "field:zoning:0",
            field: "zoning",
            question: "What's the zoning?",
            answer: "The zoning is C-2.",
            source_anchor_id: "field:zoning",
            embedding: null,
          },
          {
            id: "field:cap_rate:0",
            field: "cap_rate",
            question: "What's the cap rate?",
            answer: "The cap rate is 5.8%.",
            source_anchor_id: "field:cap_rate",
            embedding: null,
          },
        ],
        field_provenance: {},
      },
    ],
    curatedQAs: [],
    hasDocs: true,
    hasQA: false,
    tagIntents: tagQAIntents,
  });
}

function runCommercial(query) {
  const brain = commercialBrain();
  const { intent } = classifyIntent(query);
  return decideAnswer({
    brain,
    query,
    queryVec: null,
    intent,
    intentAllows,
    curatedHits: [],
    chunkHits: brain.chunks.map((c) => ({
      id: c.id,
      source: c.section,
      section: c.section,
      content: c.content,
      score: 0.8,
      kind: "raw_chunk",
    })),
    canSynthesize: false,
  });
}

function chaskaBrain() {
  return buildPropertyBrain({
    propertyIndex: 0,
    propertyUuid: "chaska-1",
    configProperty: {
      id: "chaska-1",
      name: "210 N Chestnut St, Chaska, MN 55318, US",
      propertyName: "Chaska Commons Coworking",
      location: "Chaska, MN",
    },
    agent: { name: "Lisa Ritmore" },
    brandName: "Transcendence Media",
    extractionEntries: [
      {
        template_id: "coworking",
        template_label: "AI Profile: Coworking / Flex",
        fields: {
          outdoor_space: "A patio overlooks the new Chaska Paseo and provides direct access to local walking and biking paths.",
          interior_features: "High open ceilings (14 feet), restored hardwood and concrete floors, and large street-front windows.",
          workspace_variety: "Private offices, coworking areas, phone rooms, conference rooms, and shared amenities.",
        },
        chunks: [
          {
            id: "coworking_brochure-0",
            section: "coworking_brochure",
            content: "Chaska Commons Coworking, located at 210 N Chestnut St, Chaska, MN 55318, is a modern shared office space that officially opened in September 2025. The space offers private offices, coworking areas, phone rooms, conference rooms, a podcast studio, and patio access to the Chaska Paseo. Membership pricing and total square footage are not listed in the provided document.",
            embedding: null,
            kind: "raw_chunk",
          },
        ],
        canonical_qas: [
          {
            id: "field:outdoor_space:0",
            field: "outdoor_space",
            question: "What is the outdoor space?",
            answer: "The outdoor space is a patio overlooking the new Chaska Paseo.",
            source_anchor_id: "field:outdoor_space",
            embedding: null,
          },
        ],
        candidate_fields: {},
        field_provenance: {},
      },
    ],
    curatedQAs: [
      {
        id: "property-address",
        question: "What is the address?",
        answer: "The address is Chaska, MN.",
        source_anchor_id: "",
        embedding: [],
      },
      {
        id: "agent-name",
        question: "Who is the agent?",
        answer: "Lisa Ritmore is representing this listing.",
        source_anchor_id: "",
        embedding: [],
      },
    ],
    hasDocs: true,
    hasQA: true,
    tagIntents: tagQAIntents,
  });
}

function runChaska(query, opts = {}) {
  const brain = chaskaBrain();
  const { intent } = classifyIntent(query);
  return decideAnswer({
    brain,
    query,
    queryVec: null,
    intent,
    intentAllows,
    curatedHits: opts.curatedHits || [],
    chunkHits: [
      ...brain.chunks.map((c) => ({
        id: `${c.templateLabel}#chunk#${c.id}#u#0`,
        parentId: c.id,
        source: `${c.templateLabel} -> ${c.section}`,
        section: `${c.templateLabel} -> ${c.section}`,
        content: c.content,
        score: 0.72,
        kind: "raw_chunk",
      })),
      ...Object.entries(brain.fields).map(([field, value]) => ({
        id: `AI Profile: Coworking / Flex#field#${field}`,
        parentId: `field:${field}`,
        source: `AI Profile: Coworking / Flex -> ${field}`,
        section: `AI Profile: Coworking / Flex -> ${field}`,
        content: `${field}: ${value}`,
        score: 0.6,
        kind: "field_chunk",
      })),
    ],
    canSynthesize: opts.canSynthesize !== false,
  });
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

  assert.equal(intentAllows("number_of_units", "unit_count"), true);
  assert.equal(intentAllows("number_of_rooms", "unit_count"), false,
    "unit_count MUST NOT allow number_of_rooms");
  assert.equal(intentAllows("clear_height", "property_dimension"), true);
  assert.equal(intentAllows("lease_rate", "pricing"), true);
  assert.equal(intentAllows("cam_charges", "pricing"), true);
  assert.equal(intentAllows("noi", "investment_metric"), true);
  assert.equal(intentAllows("zoning", "zoning_context"), true);
});

test("Piney venue questions — route to canonical answers instead of raw blobs", () => {
  const cases = [
    {
      q: "what's the price?",
      intent: "pricing",
      contains: ["$14,000"],
      missing: ["sleeping 8", "wood-burning"],
    },
    {
      q: "HOw much doe bar service cost?",
      intent: "pricing",
      contains: ["$51", "$60"],
      missing: ["Glamping", "Cabins"],
    },
    {
      q: "Is on-site catering available?",
      intent: "catering_service",
      contains: ["catering", "$100"],
      missing: ["Road", "White River"],
    },
    {
      q: "What is the capacity is the pavillion?",
      intent: "space_capacity",
      contains: ["200", "Pavilion"],
      missing: ["Denver Water", "lease"],
    },
    {
      q: "How many people does the Ceremony Deck hold?",
      intent: "space_capacity",
      contains: ["200", "Ceremony Deck"],
      missing: ["Glamping", "site fees"],
    },
    {
      q: "Is the ranch considered an island?",
      intent: "island_context",
      contains: ["private island", "White River"],
      missing: ["Bar Service", "$51"],
    },
  ];

  for (const c of cases) {
    const classification = classifyIntent(c.q);
    assert.equal(classification.intent, c.intent, `Intent mismatch for ${c.q}`);
    const decision = runPiney(c.q);
    assert.equal(decision.path, "canonical", `Expected canonical for ${c.q}; got ${decision.path}`);
    assertAnyOf(decision.text, c.contains);
    assertMissing(decision.text, c.missing);
  }
});

test("Piney raw chunk fallback — extracts a concise sentence instead of dumping the chunk", () => {
  const chunk = "(sleeping 8) and two smaller ones (sleeping 4). Glamping: Three safari-style glamping tents equipped with wood-burning stoves and Keurig machines. Site Fees: According to WeddingWire, 2026 site fees start at $14,000, increasing to $19,000 for Saturdays. In-House Catering: Mandatory buffet-style catering starts at $100 per person. Bar Service: Multi-hour bar packages range from approximately $51 to $60 per person.";

  const generalPrice = extractiveChunkAnswer("what's the price?", chunk, "pricing");
  assert.ok(generalPrice.includes("$14,000"), generalPrice);
  assert.ok(!generalPrice.startsWith("(sleeping 8)"), generalPrice);
  assert.ok(generalPrice.length < chunk.length, "fallback should be shorter than the source chunk");

  const barOnly = extractiveChunkAnswer("How much does bar service cost?", chunk, "pricing");
  assert.ok(barOnly.includes("$51") && barOnly.includes("$60"), barOnly);
  assert.ok(!barOnly.includes("Glamping"), barOnly);
});

test("Ask AI generality — commercial and multifamily facts route through canonical facts", () => {
  const cases = [
    {
      q: "How much is rent?",
      intent: "pricing",
      contains: ["$32", "SF"],
    },
    {
      q: "How many units are there?",
      intent: "unit_count",
      contains: ["48", "units"],
    },
    {
      q: "How many rentable square feet?",
      intent: "property_dimension",
      contains: ["12,000", "square feet"],
    },
    {
      q: "What's the clear height?",
      intent: "property_dimension",
      contains: ["24 ft"],
    },
    {
      q: "What's the zoning?",
      intent: "zoning_context",
      contains: ["C-2"],
    },
    {
      q: "What's the cap rate?",
      intent: "investment_metric",
      contains: ["5.8%"],
    },
  ];

  for (const c of cases) {
    const classification = classifyIntent(c.q);
    assert.equal(classification.intent, c.intent, `Intent mismatch for ${c.q}`);
    const decision = runCommercial(c.q);
    assert.equal(decision.path, "canonical", `Expected canonical for ${c.q}; got ${decision.path}`);
    assertAnyOf(decision.text, c.contains);
    assertMissing(decision.text, ["Ceremony Deck", "Pavilion", "Piney"]);
  }
});

test("Ask AI generality — medium-confidence candidate fields can answer before raw prose", () => {
  const classification = classifyIntent("How many dock doors are there?");
  assert.equal(classification.intent, "unknown");
  const decision = runCommercial("How many dock doors are there?");
  assert.equal(decision.path, "canonical");
  assertAnyOf(decision.text, ["4 dock-high doors"]);
  assertMissing(decision.text, ["Lease Rate", "Clear Height"]);
});

test("Chaska coworking regressions — natural content questions route to synthesis", () => {
  const cases = [
    ["what is the size of this space?", "property_dimension"],
    ["how big is this space?", "property_dimension"],
    ["What is the square feet ?", "property_dimension"],
    ["What is purpose of this property?", "summary"],
    ["How old is this space?", "year_built"],
    ["How much does it cost?", "pricing"],
    ["What are some of the features?", "amenity_presence"],
  ];

  for (const [query, expectedIntent] of cases) {
    const classification = classifyIntent(query);
    assert.equal(classification.intent, expectedIntent, `Intent mismatch for ${query}`);
    const decision = runChaska(query);
    assert.equal(decision.path, "synthesis", `Expected synthesis for ${query}; got ${decision.path}`);
    assert.equal(decision.needsSynthesis, true);
    assert.ok(decision.synthChunks.length > 0);
    assert.ok(
      decision.synthChunks.some((c) => c.id === "coworking_brochure-0" || c.id.startsWith("field:")),
      `Synthesis hints should use persisted ids, got ${JSON.stringify(decision.synthChunks)}`,
    );
  }
});

test("Chaska coworking regressions — exact name and address actions stay precise", () => {
  let classification = classifyIntent("What is the name of this space?");
  assert.equal(classification.intent, "property_name");
  let decision = runChaska("What is the name of this space?");
  assert.equal(decision.path, "action");
  assert.ok(decision.text.includes("Chaska Commons Coworking"), decision.text);

  classification = classifyIntent("where is this property located?");
  assert.equal(classification.intent, "location");
  decision = runChaska("where is this property located?");
  assert.equal(decision.path, "action");
  assert.ok(decision.text.includes("210 N Chestnut St"), decision.text);
});

test("Chaska coworking regressions — unanchored curated hits cannot leak into fact intents", () => {
  const badCuratedHits = [
    {
      id: "address-leak",
      question: "What is the address?",
      answer: "The address is Chaska, MN.",
      source_anchor_id: "",
      field: "",
      score: 0.99,
    },
    {
      id: "agent-leak",
      question: "Who is the agent?",
      answer: "Lisa Ritmore is representing this listing.",
      source_anchor_id: "",
      field: "",
      score: 0.98,
    },
  ];

  const sizeDecision = runChaska("What is the square feet?", {
    canSynthesize: false,
    curatedHits: badCuratedHits,
  });
  assert.notEqual(sizeDecision.path, "curated");
  assertMissing(sizeDecision.text, ["address is", "Lisa Ritmore"]);

  const ageDecision = runChaska("How old is this space?", {
    canSynthesize: false,
    curatedHits: badCuratedHits,
  });
  assert.notEqual(ageDecision.path, "curated");
  assertMissing(ageDecision.text, ["address is", "Lisa Ritmore"]);
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

test("synthesis primary — strong raw_chunk hits route to Gemini when available", () => {
  const brain = brainFromFixture();
  // Strip canonical QAs so the canonical tier cannot win and we drop
  // into the chunk-direct or synthesis tier deterministically.
  brain.canonicalQAs = [];
  const decision = decideAnswer({
    brain,
    query: "what's special about the lobby?",
    queryVec: null,
    intent: "unknown",
    intentAllows,
    chunkHits: [
      {
        id: "raw-1",
        source: "overview",
        section: "overview",
        content: "The lobby features a 30-foot atrium with a sweeping marble staircase.",
        score: 0.78, // well above RAW_CHUNK_DIRECT_FLOOR
        kind: "raw_chunk",
      },
    ],
    canSynthesize: true,
  });
  assert.equal(decision.path, "synthesis",
    `Strong raw_chunk hit should feed synthesis; got ${decision.path}`);
  assert.equal(decision.needsSynthesis, true);
  assert.equal(decision.synthChunks[0].id, "raw-1");
});

test("Phase A — raw-chunk escalation does NOT fire on a field_chunk", () => {
  const brain = brainFromFixture();
  brain.canonicalQAs = [];
  const decision = decideAnswer({
    brain,
    query: "what's special about the lobby?",
    queryVec: null,
    intent: "unknown",
    intentAllows,
    chunkHits: [
      {
        id: "field-1",
        source: "overview",
        section: "overview",
        content: "amenities: pool, gym, spa",
        score: 0.9,
        kind: "field_chunk",
      },
    ],
    canSynthesize: true,
  });
  // Field chunks must not satisfy the raw-chunk-direct tier.
  assert.equal(decision.path, "synthesis",
    `field_chunk should feed synthesis instead of raw direct; got ${decision.path}`);
});

test("Phase A — action-intent guard still terminates before raw-chunk escalation", () => {
  const brain = brainFromFixture();
  // Booking action has data; the ladder should resolve via action and
  // never inspect chunk-direct hits even with a high-scoring raw chunk.
  const decision = decideAnswer({
    brain,
    query: "book me a room",
    queryVec: null,
    intent: "booking",
    intentAllows,
    chunkHits: [
      {
        id: "raw-1",
        source: "overview",
        section: "overview",
        content: "Random unrelated paragraph mentioning rooms in passing.",
        score: 0.95,
        kind: "raw_chunk",
      },
    ],
    canSynthesize: false,
  });
  assert.equal(decision.path, "action",
    `Action intent must short-circuit the raw-chunk direct tier; got ${decision.path}`);
});

test("Phase A — legacy chunk hits without `kind` are treated as raw_chunk", () => {
  const brain = brainFromFixture();
  brain.canonicalQAs = [];
  const decision = decideAnswer({
    brain,
    query: "describe the lobby",
    queryVec: null,
    intent: "unknown",
    intentAllows,
    chunkHits: [
      {
        id: "legacy-1",
        source: "overview",
        section: "overview",
        content: "The lobby features a 30-foot atrium with a sweeping marble staircase.",
        score: 0.78,
        // no kind field — simulates rows persisted before Phase A
      },
    ],
    canSynthesize: false,
  });
  assert.equal(decision.path, "chunk",
    "Missing `kind` should default to raw_chunk and trigger direct escalation");
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
