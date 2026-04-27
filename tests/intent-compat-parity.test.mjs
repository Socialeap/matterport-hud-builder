#!/usr/bin/env node

// Strict parity guard between the two FIELD_COMPAT tables that drive
// Ask AI intent-aware filtering:
//   1. src/lib/portal/ask-intents.mjs               — runs in the
//      visitor's browser IIFE; cannot have imports.
//   2. supabase/functions/_shared/intent-compat.ts  — runs in the
//      Deno edge function `synthesize-answer`; uses the same gates
//      to drop irrelevant field cards from Gemini's context.
//
// Drift between the two = visitor sees one set of intent gates, server
// applies a different set, and the same query returns different
// content depending on which path runs. That class of subtle desync
// is exactly what produced the property-chat integrity issues that
// motivated the structural fix in claude/fix-gemini-property-chat-bD3yZ.

import { test } from "node:test";
import assert from "node:assert/strict";

import { FIELD_COMPAT as MJS_COMPAT } from "../src/lib/portal/ask-intents.mjs";
import { FIELD_COMPAT as TS_COMPAT } from "../supabase/functions/_shared/intent-compat.ts";

function regexListSnapshot(list) {
  return (list || []).map((re) => re.toString());
}

function ruleSnapshot(rule) {
  return {
    allow: regexListSnapshot(rule.allow).sort(),
    exclude: regexListSnapshot(rule.exclude).sort(),
  };
}

test("FIELD_COMPAT: both tables expose the same intent keys", () => {
  const mjsKeys = Object.keys(MJS_COMPAT).sort();
  const tsKeys = Object.keys(TS_COMPAT).sort();
  assert.deepStrictEqual(
    tsKeys,
    mjsKeys,
    "intent set drift: " +
      JSON.stringify({
        in_mjs_only: mjsKeys.filter((k) => !tsKeys.includes(k)),
        in_ts_only: tsKeys.filter((k) => !mjsKeys.includes(k)),
      }),
  );
});

test("FIELD_COMPAT: every intent's allow + exclude regex sets match", () => {
  const intents = Object.keys(MJS_COMPAT);
  for (const intent of intents) {
    const mjsSnap = ruleSnapshot(MJS_COMPAT[intent]);
    const tsSnap = ruleSnapshot(TS_COMPAT[intent]);
    assert.deepStrictEqual(
      tsSnap,
      mjsSnap,
      `regex drift in intent="${intent}":\n` +
        `  mjs.allow:    ${mjsSnap.allow.join(", ")}\n` +
        `  ts.allow:     ${tsSnap.allow.join(", ")}\n` +
        `  mjs.exclude:  ${mjsSnap.exclude.join(", ")}\n` +
        `  ts.exclude:   ${tsSnap.exclude.join(", ")}`,
    );
  }
});

test("intentAllows: representative gate behaviors match between modules", async () => {
  const mjsModule = await import("../src/lib/portal/ask-intents.mjs");
  const tsModule = await import("../supabase/functions/_shared/intent-compat.ts");

  // Cases that motivated the structural fix — every entry encodes a
  // visitor-facing failure mode. If either module diverges the test
  // names the offending intent + field combo.
  const cases = [
    // outdoor_space must NOT be allowed for size queries
    { field: "outdoor_space", intent: "property_dimension", expect: false },
    // workspace_variety must NOT be allowed for size queries
    { field: "workspace_variety", intent: "property_dimension", expect: false },
    // agent_name must NOT surface for year_built / pricing
    { field: "agent_name", intent: "year_built", expect: false },
    { field: "agent_name", intent: "pricing", expect: false },
    // agent_name SHOULD surface for contact_agent
    { field: "agent_name", intent: "contact_agent", expect: true },
    // property_address SHOULD surface for location
    { field: "property_address", intent: "location", expect: true },
    // square_feet SHOULD be allowed for property_dimension
    { field: "square_feet", intent: "property_dimension", expect: true },
    // unknown intent always allows (legacy compatibility)
    { field: "anything_at_all", intent: "unknown", expect: true },
  ];

  for (const c of cases) {
    const mjsOut = mjsModule.intentAllows(c.field, c.intent);
    const tsOut = tsModule.intentAllows(c.field, c.intent);
    assert.strictEqual(
      mjsOut,
      c.expect,
      `mjs.intentAllows(${c.field}, ${c.intent}) = ${mjsOut}, expected ${c.expect}`,
    );
    assert.strictEqual(
      tsOut,
      c.expect,
      `ts.intentAllows(${c.field}, ${c.intent}) = ${tsOut}, expected ${c.expect}`,
    );
  }
});
