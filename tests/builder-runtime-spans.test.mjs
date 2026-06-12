#!/usr/bin/env node

// P2 — canonical Builder runtime span builders: independent byte-identity.
//
// Two levels of proof, per the approved plan:
//   A. The canonical builders (src/lib/portal/builder-runtime-spans.mjs)
//      independently emit spans byte-identical to the PRE-refactor
//      generator. Expected hashes below are FIXED INDEPENDENT BASELINES
//      captured from origin/main@a646a20 BEFORE the extraction — they are
//      never derived from the refactored builders at test time.
//   B. portal.functions.ts integrates all five builders exactly once, in
//      canonical document order, with the correct branding and
//      runtime-source arguments, and retains no inline sentinel emission.
//
// Baseline provenance: captured 2026-06-12 against
// origin/main@a646a203cc945a6f1ea651d9fe48ffbaddafd6b1 by extracting each
// sentinel-INCLUSIVE span (BEGIN line start → END line end, no trailing
// newline) from the pre-refactor portal.functions.ts template and applying
// the canary's deTemplate un-escape (scripts/build-builder-canary.mjs).
// A byte change to any span is a runtime change: re-pin deliberately and
// re-derive the canary hash alongside it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  escapeHtml,
  BUILDER_SPAN_CANONICAL_ORDER,
  buildBuilderCssSpan,
  BUILDER_DEP_PEERJS_SPAN,
  BUILDER_MARKUP_SPAN,
  buildBuilderJsKernelSpan,
  BUILDER_JS_GLUE_SPAN,
} from "../src/lib/portal/builder-runtime-spans.mjs";
import {
  BUILDER_RUNTIME_SPANS,
  BUILDER_SENTINEL_LITERALS,
  INSPECTION_OUTCOMES,
  inspectPresentationHtml,
} from "../src/lib/presentation-upgrade-inspector.mjs";
import { buildRuntimeMetaTags } from "../src/lib/atlas-runtime-version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORTAL = readFileSync(
  path.join(__dirname, "..", "src", "lib", "portal.functions.ts"),
  "utf8",
);
const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const count = (haystack, needle) => haystack.split(needle).length - 1;

// ── A. Fixed independent baselines (origin/main@a646a20, pre-refactor) ──

const SYNTHETIC_KERNEL = {
  liveSessionJs: "/* synthetic-live-session */",
  annoInputJs: "/* synthetic-anno-input */",
};

const BASELINES = [
  {
    name: "css with default branding (#3B82F6 / #1a1a2e)",
    build: () => buildBuilderCssSpan({ accentColor: "#3B82F6", hudBgColor: "#1a1a2e" }),
    sha256: "20909f9ff5270d247035afd0883285c7db24f42f40ed20ced8eb86e82746b24e",
    bytes: 13009,
  },
  {
    name: "css with canary branding (#6c5ce7 / #0a0e27)",
    build: () => buildBuilderCssSpan({ accentColor: "#6c5ce7", hudBgColor: "#0a0e27" }),
    sha256: "56990bfc2830bf85266eb6188ac79c66822e14e108871d3b7d36e057b648929f",
    bytes: 13009,
  },
  {
    name: "dep:peerjs",
    build: () => BUILDER_DEP_PEERJS_SPAN,
    sha256: "aaec15b3118ef2c94a0e9b8e3f9157c5ad2fcb8aaae3f09388416abe65d7b38d",
    bytes: 788,
  },
  {
    name: "markup",
    build: () => BUILDER_MARKUP_SPAN,
    sha256: "16b42cb33e75d66a046e9b21ccba893a1ebf2b0492bdce123bfca4c71e0edb6d",
    bytes: 2063,
  },
  {
    name: "js:kernel with synthetic runtime sources",
    build: () => buildBuilderJsKernelSpan(SYNTHETIC_KERNEL),
    sha256: "983c816495bb031b3697dacbcb7dd796b886462baa5478096a25cdc18d56fe5e",
    bytes: 1001,
  },
  {
    name: "js:glue",
    build: () => BUILDER_JS_GLUE_SPAN,
    sha256: "eff286199fefe15ae291d9b14d0a9c5560910da2de7048836dda0ff33ee60f8c",
    bytes: 88207,
  },
];

for (const b of BASELINES) {
  test(`byte identity vs pre-refactor baseline — ${b.name}`, () => {
    const out = b.build();
    assert.equal(out.length, b.bytes, "byte length must match the pre-refactor baseline");
    assert.equal(sha256(out), b.sha256, "sha256 must match the pre-refactor baseline");
  });
}

test("builders are deterministic — repeated calls emit identical bytes", () => {
  for (const b of BASELINES) {
    assert.equal(b.build(), b.build(), `${b.name}: repeat call diverged`);
  }
});

// ── Branding stays escaped inside the builder ───────────────────────────

test("escapeHtml escapes exactly the four HTML-sensitive characters", () => {
  assert.equal(escapeHtml('&<>"'), "&amp;&lt;&gt;&quot;");
  assert.equal(escapeHtml("#3B82F6"), "#3B82F6");
});

test("css builder escapes branding at every interpolation point (14 accent + 1 hudBg)", () => {
  const out = buildBuilderCssSpan({ accentColor: 'A"B', hudBgColor: 'C"D' });
  assert.equal(count(out, "A&quot;B"), 14, "accentColor must be escaped at all 14 points");
  assert.equal(count(out, "C&quot;D"), 1, "hudBgColor must be escaped at its single point");
  assert.equal(count(out, 'A"B'), 0, "raw accentColor must never reach the output");
  assert.equal(count(out, 'C"D'), 0, "raw hudBgColor must never reach the output");
});

// ── Sentinel contract (the patcher's replacement unit) ──────────────────

const SPAN_OUTPUTS = () => ({
  css: buildBuilderCssSpan({ accentColor: "#3B82F6", hudBgColor: "#1a1a2e" }),
  "dep:peerjs": BUILDER_DEP_PEERJS_SPAN,
  markup: BUILDER_MARKUP_SPAN,
  "js:kernel": buildBuilderJsKernelSpan(SYNTHETIC_KERNEL),
  "js:glue": BUILDER_JS_GLUE_SPAN,
});

test("canonical order matches the inspector's span registry", () => {
  assert.deepEqual([...BUILDER_SPAN_CANONICAL_ORDER], [...BUILDER_RUNTIME_SPANS]);
  assert.ok(Object.isFrozen(BUILDER_SPAN_CANONICAL_ORDER));
});

test("every span is sentinel-inclusive: exact literals, once each, BEGIN first", () => {
  const outputs = SPAN_OUTPUTS();
  for (const name of BUILDER_SPAN_CANONICAL_ORDER) {
    const out = outputs[name];
    const lit = BUILDER_SENTINEL_LITERALS[name];
    assert.equal(count(out, lit.begin), 1, `${name}: BEGIN literal exactly once`);
    assert.equal(count(out, lit.end), 1, `${name}: END literal exactly once`);
    assert.ok(out.indexOf(lit.begin) < out.indexOf(lit.end), `${name}: BEGIN precedes END`);
    assert.equal(count(out, "f3d:runtime-"), 2, `${name}: exactly its own two sentinel tokens`);
    assert.ok(out.trimStart().startsWith(lit.begin.trimStart()), `${name}: starts on its BEGIN line`);
    assert.ok(out.endsWith(lit.end), `${name}: ends at its END sentinel, no trailing newline`);
  }
});

test("markup span preserves its original 4-space indentation bytes", () => {
  assert.ok(BUILDER_MARKUP_SPAN.startsWith("    <!-- f3d:runtime-markup BEGIN"));
});

// ── Presentation content can never leak INTO a span ─────────────────────

test("no preserved presentation content appears inside any span", () => {
  const SENSITIVE = [
    'id="matterport-frame"',
    "window.__PROTECTED_BLOB__",
    "window.__configReady",
    "window.__PRESENTATION_TOKEN__",
    "window.__QA_DATABASE__",
    "window.__PREAMBLE__",
    "window.__CONFIG__",
    "window.__SAVED_MODEL_ID__",
  ];
  const outputs = SPAN_OUTPUTS();
  for (const [name, out] of Object.entries(outputs)) {
    for (const tok of SENSITIVE) {
      assert.equal(count(out, tok), 0, `${name}: must not contain ${tok}`);
    }
  }
});

// ── Kernel parameterization ──────────────────────────────────────────────

test("kernel injects both runtime sources verbatim, live-session first", () => {
  const tricky =
    "const probe = " + "`" + "${" + "probeVar}" + "`" + "; // own template literal survives";
  const out = buildBuilderJsKernelSpan({ liveSessionJs: tricky, annoInputJs: "/*AI*/" });
  assert.equal(count(out, tricky), 1, "injected source must survive byte-for-byte");
  assert.ok(out.indexOf(tricky) < out.indexOf("/*AI*/"), "live-session injects before anno-input");
});

test("kernel's escaped comment tokens emit as literal text, not interpolations", () => {
  const out = buildBuilderJsKernelSpan(SYNTHETIC_KERNEL);
  const literalToken = "${" + "LIVE_SESSION_RUNTIME_JS}";
  assert.equal(count(out, literalToken), 1, "the warning comment keeps its literal token");
  assert.equal(count(out, SYNTHETIC_KERNEL.liveSessionJs), 1, "synthetic live-session injected once");
  assert.equal(count(out, SYNTHETIC_KERNEL.annoInputJs), 1, "synthetic anno-input injected once");
});

// ── B. Generator integration (portal.functions.ts call sites) ───────────

const CALL_SITES = [
  { span: "css", token: "${buildBuilderCssSpan({ accentColor, hudBgColor })}" },
  { span: "dep:peerjs", token: "${BUILDER_DEP_PEERJS_SPAN}" },
  { span: "markup", token: "${BUILDER_MARKUP_SPAN}" },
  {
    span: "js:kernel",
    token:
      "${buildBuilderJsKernelSpan({ liveSessionJs: LIVE_SESSION_RUNTIME_JS, annoInputJs: ANNO_INPUT_RUNTIME_JS })}",
  },
  { span: "js:glue", token: "${BUILDER_JS_GLUE_SPAN}" },
];

test("generator imports the canonical module", () => {
  assert.ok(
    PORTAL.includes('} from "./portal/builder-runtime-spans.mjs";'),
    "portal.functions.ts must import the span builders",
  );
  assert.ok(
    !PORTAL.includes("function escapeHtml"),
    "the local escapeHtml must be gone (single implementation in the module)",
  );
});

test("generator integrates all five builders exactly once, in canonical order", () => {
  let prev = -1;
  for (const c of CALL_SITES) {
    assert.equal(count(PORTAL, c.token), 1, `${c.span}: call site exactly once`);
    const at = PORTAL.indexOf(c.token);
    assert.ok(at > prev, `${c.span}: call site must follow ${prev === -1 ? "start" : "previous span"}`);
    prev = at;
  }
});

test("generator retains zero inline sentinel emission", () => {
  assert.equal(
    count(PORTAL, "f3d:runtime-"),
    0,
    "all ten sentinel tokens must come from the canonical module",
  );
});

test("generator still owns the kernel runtime-source constants it passes in", () => {
  assert.ok(PORTAL.includes("const LIVE_SESSION_RUNTIME_JS = getLiveSessionRuntimeJS();"));
  assert.ok(PORTAL.includes("const ANNO_INPUT_RUNTIME_JS = getAnnoInputRuntimeJS();"));
});

// ── Inspector round-trip: composed spans validate as the current runtime ─

test("a document composed from the real builders inspects as already_current", () => {
  const o = SPAN_OUTPUTS();
  const html = `<!doctype html>
<html><head>
<meta charset="utf-8" />
${buildRuntimeMetaTags("builder")}
<title>Composed</title>
<style>
${o.css}
</style>
${o["dep:peerjs"]}
</head><body>
<h1>PLACEHOLDER BRAND</h1>
<iframe id="matterport-frame" src="about:blank"></iframe>
${o.markup}
<script>
window.__PREAMBLE__="UExBQ0VIT0xERVI=";
window.__CONFIG__="UExBQ0VIT0xERVI=";
window.__SAVED_MODEL_ID__="00000000-0000-4000-8000-000000000000";
${o["js:kernel"]}
${o["js:glue"]}
</script>
</body></html>`;
  const r = inspectPresentationHtml(html);
  assert.equal(r.outcome, INSPECTION_OUTCOMES.ALREADY_CURRENT ?? "already_current");
  assert.equal(r.sentinels.valid, true, `sentinels must validate: ${JSON.stringify(r.sentinels.issues)}`);
  assert.deepEqual(r.sentinels.issues, []);
});
