// Golden-case tests for the prose-miner.
// Run via: deno test supabase/functions/_shared/prose-miner_test.ts

import { assertEquals, assertExists } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { mineFromChunks } from "./prose-miner.ts";
import type { PropertyChunk } from "./extractors/types.ts";

function chunk(id: string, content: string): PropertyChunk {
  return { id, section: "test", content };
}

// ── Marriott Marquis (commercial / hospitality) ──────────────────────────────

Deno.test("marriott: mines number_of_rooms and stories from prose", () => {
  const chunks = [
    chunk("c1",
      "The New York Marriott Marquis is a hotel located at 1535 Broadway in the " +
      "Times Square area of Manhattan. The 49-story hotel has 1,957 rooms, making " +
      "it one of the largest hotels in New York City. It was built in 1985."),
  ];
  const result = mineFromChunks(chunks, {});
  assertEquals(result.fields.number_of_rooms, 1957);
  assertEquals(result.fields.stories, 49);
  assertEquals(result.fields.year_built, 1985);
  assertExists(result.provenance.find((p) => p.field === "stories"));
});

Deno.test("marriott: respects pre-existing fields (gap-fill only)", () => {
  const chunks = [
    chunk("c1", "The 49-story hotel has 1,957 rooms and was built in 1985."),
  ];
  const result = mineFromChunks(chunks, { number_of_rooms: 1949 });
  // Existing value preserved
  assertEquals(result.fields.number_of_rooms, undefined);
  // Other facts still mined
  assertEquals(result.fields.stories, 49);
  assertEquals(result.fields.year_built, 1985);
});

// ── Hotel Indigo (editorial magazine prose) ──────────────────────────────────

Deno.test("hotel indigo: mines architect and rooms from designer credit", () => {
  const chunks = [
    chunk("c1",
      "The 245-room Hotel Indigo Lower Manhattan, designed by Stonehill Taylor, " +
      "occupies a landmark Wall Street tower. The boutique property includes " +
      "two on-site restaurants and a rooftop bar."),
  ];
  const result = mineFromChunks(chunks, { property_type: "Hotel" });
  assertEquals(result.fields.number_of_rooms, 245);
  assertEquals(result.fields.architect, "Stonehill Taylor");
  assertEquals(result.fields.number_of_restaurants, 2);
});

Deno.test("renovation: parses million-dollar figure", () => {
  const chunks = [
    chunk("c1",
      "The property completed a $15 million renovation in 2019, restoring its " +
      "original 1920s grandeur."),
  ];
  const result = mineFromChunks(chunks, {});
  assertEquals(result.fields.renovation_cost, 15_000_000);
  assertEquals(result.fields.year_renovated, 2019);
});

// ── Residential: must NOT trigger commercial-style patterns ──────────────────

Deno.test("residential: mines beds/baths/sqft, no false hospitality positives", () => {
  const chunks = [
    chunk("c1",
      "Beautiful 4 bedroom, 2.5 bathroom home with 2,400 sq ft of living space. " +
      "Built in 1998, the property includes a 2-car garage and 2 parking spaces."),
  ];
  const result = mineFromChunks(chunks, {});
  assertEquals(result.fields.bedrooms, 4);
  assertEquals(result.fields.bathrooms, 2.5);
  assertEquals(result.fields.square_feet, 2400);
  assertEquals(result.fields.year_built, 1998);
  assertEquals(result.fields.parking_spaces, 2);
  // No false positives
  assertEquals(result.fields.number_of_rooms, undefined);
  assertEquals(result.fields.number_of_suites, undefined);
  assertEquals(result.fields.meeting_space_sqft, undefined);
  assertEquals(result.fields.ballroom_capacity, undefined);
});

// ── Empty / degenerate ───────────────────────────────────────────────────────

Deno.test("empty input: returns empty result without errors", () => {
  const result = mineFromChunks([], {});
  assertEquals(result.fields, {});
  assertEquals(result.provenance, []);
});

Deno.test("first-match-wins: does not double-count across chunks", () => {
  const chunks = [
    chunk("c1", "The hotel has 1,957 rooms."),
    chunk("c2", "Across both towers, 2,800 rooms accommodate guests."),
  ];
  const result = mineFromChunks(chunks, {});
  assertEquals(result.fields.number_of_rooms, 1957);
  const prov = result.provenance.filter((p) => p.field === "number_of_rooms");
  assertEquals(prov.length, 1);
  assertEquals(prov[0].chunk_id, "c1");
});
