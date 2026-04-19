// Local round-trip test for the pdfjs_heuristic extractor.
// Run: `deno test --allow-net --allow-read --allow-env supabase/functions/extract-property-doc/test-harness.ts`
//
// Drop a fixture PDF at ./fixtures/sample.pdf and tune the
// FIXTURE_TEMPLATE / expected values below to match that PDF.

import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { pdfjsHeuristic } from "../_shared/extractors/pdfjs-heuristic.ts";
import type { VaultTemplate } from "../_shared/extractors/types.ts";

const FIXTURE_PATH = new URL("./fixtures/sample.pdf", import.meta.url);

const FIXTURE_TEMPLATE: VaultTemplate = {
  id: "00000000-0000-0000-0000-000000000001",
  provider_id: "00000000-0000-0000-0000-000000000002",
  label: "Sample",
  doc_kind: "hud_statement",
  extractor: "pdfjs_heuristic",
  version: 1,
  field_schema: {
    type: "object",
    properties: {
      property_address: { type: "string" },
      purchase_price: { type: "number" },
    },
  },
};

Deno.test("pdfjs_heuristic round-trips a fixture PDF", async () => {
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(FIXTURE_PATH);
  } catch {
    console.warn("fixture missing — skipping round-trip");
    return;
  }

  const result = await pdfjsHeuristic.extract({ bytes, template: FIXTURE_TEMPLATE });

  assert(result.chunks.length > 0, "should produce at least one chunk");
  assertEquals(typeof result.fields, "object");
  // Fixture-specific assertions go here once sample.pdf is provided:
  // assertEquals(result.fields.property_address, "123 Main St");
  // assertEquals(result.fields.purchase_price, 500000);
});

Deno.test("chunks carry id/section/content", async () => {
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(FIXTURE_PATH);
  } catch {
    return;
  }
  const { chunks } = await pdfjsHeuristic.extract({ bytes, template: FIXTURE_TEMPLATE });
  for (const c of chunks) {
    assert(c.id && c.section && typeof c.content === "string");
  }
});
