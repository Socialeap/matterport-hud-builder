#!/usr/bin/env node

// P3 — Presentation Upgrade Patcher: pure, deterministic, byte-preserving
// single-file upgrade of a Builder index.html from a v1 patch source
// (2.1.0 / 2.2.0) to the current runtime.
//
// PRIMARY end-to-end proof: the two realistic sanitized fixtures
// (tests/fixtures/builder-2.1.0.sanitized.html + 2.2.0) — realistic
// preserved chrome, metadata, config/token placeholders, and all five
// runtime spans. Minimal adversarial variants (built by transforming the
// realistic fixtures) supplement, never replace, that proof.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  patchPresentationHtml,
  PATCH_OUTCOMES,
  REJECTION_CODES,
  REJECTION_MESSAGES,
  EXPECTED_MUTATION_REGION_COUNT,
  BRANDING_ANCHORS,
  ANCHOR_CHANNEL_TOKEN,
  normalizeHexColor,
} from "../src/lib/presentation-upgrade-patcher.mjs";
import {
  inspectPresentationHtml,
  F3D_META_NAMES,
  BUILDER_RUNTIME_SPANS,
  BUILDER_SENTINEL_LITERALS,
} from "../src/lib/presentation-upgrade-inspector.mjs";
import {
  buildBuilderCssSpan,
  buildBuilderJsKernelSpan,
  BUILDER_DEP_PEERJS_SPAN,
  BUILDER_MARKUP_SPAN,
  BUILDER_JS_GLUE_SPAN,
} from "../src/lib/portal/builder-runtime-spans.mjs";
import {
  ATLAS_RUNTIME_VERSION,
  ATLAS_PACKAGE_SCHEMA,
} from "../src/lib/atlas-runtime-version.mjs";
import { stripExports } from "../src/lib/portal/ask-runtime-transformer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoPath = (...p) => path.join(__dirname, "..", ...p);
const read = (...p) => readFileSync(repoPath(...p), "utf8");

// The proven canary path: pass the real, stripped runtime module sources.
const RUNTIME_SOURCES = {
  liveSessionJs: stripExports(read("src", "lib", "portal", "live-session.mjs")),
  annoInputJs: stripExports(read("src", "lib", "portal", "anno-input.mjs")),
};

const FIX_210 = read("tests", "fixtures", "builder-2.1.0.sanitized.html");
const FIX_220 = read("tests", "fixtures", "builder-2.2.0.sanitized.html");
const FIX_ACCENT = "#2563eb";
const FIX_HUD = "#0f172a";

const count = (hay, needle) => hay.split(needle).length - 1;

// Independent re-derivation of the nine mutation regions (NOT reusing the
// patcher's internals) so byte-preservation is checked by the test too.
function deriveRegions(html) {
  const insp = inspectPresentationHtml(html);
  const regions = [];
  for (const s of insp.sentinels.spans) {
    const nl = html.lastIndexOf("\n", s.beginStart - 1);
    const lineStart = nl + 1;
    assert.match(html.slice(lineStart, s.beginStart), /^[ \t]*$/, `span ${s.name} lead ws`);
    regions.push({ kind: `span:${s.name}`, start: lineStart, end: s.endEnd });
  }
  for (const name of F3D_META_NAMES) {
    const head = `<meta name="${name}" content="`;
    const re = new RegExp(head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + `([^"]*)" \\/>`, "g");
    const m = re.exec(html);
    assert.ok(m, `meta ${name} present`);
    const start = m.index + head.length;
    regions.push({ kind: `meta:${name}`, start, end: start + m[1].length });
  }
  return regions.sort((a, b) => a.start - b.start);
}

function untouchedSegments(html, regions) {
  const segs = [];
  let c = 0;
  for (const r of regions) {
    segs.push(html.slice(c, r.start));
    c = r.end;
  }
  segs.push(html.slice(c));
  return segs;
}

// ── A. Realistic end-to-end (the primary proof) ─────────────────────────

for (const [version, fixture] of [["2.1.0", FIX_210], ["2.2.0", FIX_220]]) {
  test(`realistic Builder ${version} → patched, validates as current ${ATLAS_RUNTIME_VERSION}`, () => {
    const r = patchPresentationHtml(fixture, RUNTIME_SOURCES);
    assert.equal(r.outcome, PATCH_OUTCOMES.PATCHED, JSON.stringify(r.reasons));
    assert.equal(r.code, null);
    assert.equal(r.inspection.outcome, "patchable");
    assert.equal(r.inspection.runtimeVersion, version);
    assert.equal(r.postInspection.outcome, "already_current");
    assert.equal(r.postInspection.runtimeVersion, ATLAS_RUNTIME_VERSION);
    assert.equal(r.postInspection.sentinels.valid, true);
    assert.deepEqual(r.branding, { accentColor: FIX_ACCENT, hudBgColor: FIX_HUD });
    assert.ok(typeof r.html === "string" && r.html.length > 0);
  });

  test(`realistic Builder ${version}: output spans are byte-identical to the canonical builders`, () => {
    const r = patchPresentationHtml(fixture, RUNTIME_SOURCES);
    const expected = {
      css: buildBuilderCssSpan({ accentColor: FIX_ACCENT, hudBgColor: FIX_HUD }),
      "dep:peerjs": BUILDER_DEP_PEERJS_SPAN,
      markup: BUILDER_MARKUP_SPAN,
      "js:kernel": buildBuilderJsKernelSpan(RUNTIME_SOURCES),
      "js:glue": BUILDER_JS_GLUE_SPAN,
    };
    for (const name of BUILDER_RUNTIME_SPANS) {
      assert.equal(count(r.html, expected[name]), 1, `output must contain the canonical ${name} span exactly once`);
    }
    // And the four f3d metas now read the current contract.
    assert.equal(count(r.html, `<meta name="f3d-runtime" content="${ATLAS_RUNTIME_VERSION}" />`), 1);
    assert.equal(count(r.html, `<meta name="f3d-package-schema" content="${ATLAS_PACKAGE_SCHEMA}" />`), 1);
    assert.equal(count(r.html, `<meta name="f3d-capabilities" content="" />`), 1);
    assert.equal(count(r.html, `<meta name="f3d-package-family" content="builder" />`), 1);
  });

  test(`realistic Builder ${version}: every byte outside the nine regions is preserved`, () => {
    const r = patchPresentationHtml(fixture, RUNTIME_SOURCES);
    const inSegs = untouchedSegments(fixture, deriveRegions(fixture));
    const outSegs = untouchedSegments(r.html, deriveRegions(r.html));
    assert.equal(inSegs.length, outSegs.length);
    for (let i = 0; i < inSegs.length; i++) {
      assert.equal(outSegs[i], inSegs[i], `untouched segment #${i} must survive byte-identical`);
    }
    // Spot-check load-bearing preserved content explicitly.
    for (const tok of [
      'id="matterport-frame"',
      "window.__PREAMBLE__=",
      "window.__CONFIG__=",
      "window.__PRESENTATION_TOKEN__=",
      "window.__SAVED_MODEL_ID__=",
      ".gate-btn-primary{",
      "#powered-by{",
    ]) {
      assert.equal(count(r.html, tok), count(fixture, tok), `preserved token ${tok}`);
    }
  });

  test(`realistic Builder ${version}: idempotent and deterministic; input never mutated`, () => {
    const before = fixture;
    const r1 = patchPresentationHtml(fixture, RUNTIME_SOURCES);
    const r2 = patchPresentationHtml(fixture, RUNTIME_SOURCES);
    assert.equal(r1.html, r2.html, "deterministic: identical output bytes");
    const again = patchPresentationHtml(r1.html, RUNTIME_SOURCES);
    assert.equal(again.outcome, PATCH_OUTCOMES.NOOP_ALREADY_CURRENT, "re-patch is a no-op");
    assert.equal(again.html, r1.html, "re-patch returns byte-identical html");
    assert.equal(fixture, before, "input string is never mutated");
  });
}

// ── A2. sourceHtml binds a result to its exact input ────────────────────

test("patched and noop results carry sourceHtml === the exact input; rejected is null", () => {
  const patched = patchPresentationHtml(FIX_210, RUNTIME_SOURCES);
  assert.equal(patched.outcome, PATCH_OUTCOMES.PATCHED);
  assert.equal(patched.sourceHtml, FIX_210, "patched.sourceHtml must be the exact input");

  const noop = patchPresentationHtml(patched.html, RUNTIME_SOURCES);
  assert.equal(noop.outcome, PATCH_OUTCOMES.NOOP_ALREADY_CURRENT);
  assert.equal(noop.sourceHtml, patched.html, "noop.sourceHtml must be the exact input");
  assert.equal(noop.html, patched.html, "noop echoes its input");

  // A string-input rejection carries sourceHtml === the input (so its outcome
  // can never be reported against a different file's bytes).
  const rejected = patchPresentationHtml("<h1>nope</h1>", RUNTIME_SOURCES);
  assert.equal(rejected.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(rejected.sourceHtml, "<h1>nope</h1>", "string rejection binds sourceHtml to the input");

  // Only a NON-string input yields sourceHtml === null.
  const notString = patchPresentationHtml(null, RUNTIME_SOURCES);
  assert.equal(notString.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(notString.code, REJECTION_CODES.NOT_A_STRING);
  assert.equal(notString.sourceHtml, null, "non-string input → sourceHtml null");
});

// ── B. Exactly nine mutation regions ────────────────────────────────────

test("exactly nine recognized mutation regions (5 spans + 4 metas)", () => {
  assert.equal(EXPECTED_MUTATION_REGION_COUNT, 9);
  assert.equal(BUILDER_RUNTIME_SPANS.length + F3D_META_NAMES.length, 9);
  assert.equal(deriveRegions(FIX_210).length, 9);
});

// ── C. No-downgrade + current no-op ─────────────────────────────────────

test("future runtime → rejected future_version, no html, no mutation", () => {
  const fut = FIX_210.replace(
    '<meta name="f3d-runtime" content="2.1.0" />',
    '<meta name="f3d-runtime" content="9.9.9" />',
  );
  const r = patchPresentationHtml(fut, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.FUTURE_VERSION);
  assert.equal(r.html, null);
  assert.equal(r.branding, null);
});

test("future schema → rejected future_version, no html", () => {
  const fut = FIX_220.replace(
    '<meta name="f3d-package-schema" content="2" />',
    '<meta name="f3d-package-schema" content="3" />',
  );
  const r = patchPresentationHtml(fut, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.FUTURE_VERSION);
  assert.equal(r.html, null);
});

test("current package → noop_already_current, byte-identical echo, no building", () => {
  const r0 = patchPresentationHtml(FIX_210, RUNTIME_SOURCES);
  const current = r0.html; // a real current package
  const r = patchPresentationHtml(current, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.NOOP_ALREADY_CURRENT);
  assert.equal(r.code, null);
  assert.equal(r.html, current, "noop echoes the input byte-for-byte");
  assert.equal(r.branding, null, "noop performs no branding extraction");
  assert.equal(r.postInspection, null, "noop performs no post-build validation");
});

// ── D. Branding adversarial (transform the realistic fixture) ────────────

test("missing anchor → rejected branding_not_recoverable (names the anchor)", () => {
  // Drop the .hud-contact-btn rule (anchor A2) entirely.
  const broken = FIX_210.replace(
    /\.hud-contact-btn\{[^}]*\}\n/,
    "",
  );
  assert.notEqual(broken, FIX_210, "transform must remove the A2 rule");
  const r = patchPresentationHtml(broken, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.BRANDING_NOT_RECOVERABLE);
  assert.equal(r.html, null);
  assert.ok(r.reasons.some((x) => x.includes("A2")), `reasons should name A2: ${r.reasons.join(";")}`);
});

test("conflicting accent anchors → rejected branding_not_recoverable", () => {
  // Change ONLY the A1 (.gate-btn-primary) accent to a different valid hex.
  const conflict = FIX_210.replace(
    ".gate-btn-primary{padding:13px 28px;font-size:15px;font-weight:600;border:none;border-radius:10px;cursor:pointer;background:#2563eb;color:#fff",
    ".gate-btn-primary{padding:13px 28px;font-size:15px;font-weight:600;border:none;border-radius:10px;cursor:pointer;background:#aa00aa;color:#fff",
  );
  assert.notEqual(conflict, FIX_210);
  const r = patchPresentationHtml(conflict, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.BRANDING_NOT_RECOVERABLE);
  assert.equal(r.html, null);
  assert.ok(r.reasons.some((x) => x.includes("accent anchors disagree")));
});

test("malformed anchor color (5-digit hex) → rejected branding_not_recoverable", () => {
  const malformed = FIX_210.replace(
    "#gate-password-input:focus{border-color:#2563eb}",
    "#gate-password-input:focus{border-color:#12345}",
  );
  assert.notEqual(malformed, FIX_210);
  const r = patchPresentationHtml(malformed, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.BRANDING_NOT_RECOVERABLE);
  assert.ok(r.reasons.some((x) => x.includes("A4")));
});

test("consistent #RGB shorthand → patched with normalized #rrggbb", () => {
  // Rewrite every brand color to shorthand, consistently.
  const short = FIX_210.split(FIX_ACCENT).join("#abc").split(FIX_HUD).join("#135");
  const r = patchPresentationHtml(short, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.PATCHED, JSON.stringify(r.reasons));
  assert.deepEqual(r.branding, { accentColor: "#aabbcc", hudBgColor: "#113355" });
  // Output css span uses the normalized colors (byte-identical to the builder).
  assert.equal(
    count(r.html, buildBuilderCssSpan({ accentColor: "#aabbcc", hudBgColor: "#113355" })),
    1,
  );
});

test("decoy color inside a runtime span cannot influence branding (spans removed first)", () => {
  // Inject an A1-shaped anchor with a DIFFERENT color INSIDE the js:glue span.
  const decoyRule =
    ".gate-btn-primary{padding:13px 28px;font-size:15px;font-weight:600;border:none;border-radius:10px;cursor:pointer;background:#ff0000;color:#fff;transition:none}";
  const decoyed = FIX_210.replace(
    "  var session = createLiveSession();",
    `  var session = createLiveSession();\n  var decoy = "${decoyRule}";`,
  );
  assert.notEqual(decoyed, FIX_210, "decoy must be injected");
  // Meta-assertion: in the FULL input the A1 prefix now appears twice (real +
  // decoy). If the patcher searched the full input, A1 would be "ambiguous"
  // (duplicate) and rejected — so a "patched" result proves the span was
  // removed before matching.
  const a1Prefix =
    ".gate-btn-primary{padding:13px 28px;font-size:15px;font-weight:600;border:none;border-radius:10px;cursor:pointer;background:";
  assert.equal(count(decoyed, a1Prefix), 2, "decoy adds a second A1 occurrence in the full input");
  const r = patchPresentationHtml(decoyed, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.PATCHED, JSON.stringify(r.reasons));
  assert.deepEqual(
    r.branding,
    { accentColor: FIX_ACCENT, hudBgColor: FIX_HUD },
    "branding comes from preserved chrome, never the span decoy",
  );
});

// ── E. Protected presentations ──────────────────────────────────────────

test("protected presentation → patched without touching the protected blob", () => {
  const blob =
    'window.__PROTECTED__=true;window.__PROTECTED_BLOB__={"salt":"c2FuaXRpemVk","iv":"c2FuaXRpemVk","ciphertext":"c2FuaXRpemVkLWNpcGhlcnRleHQ="};';
  const prot = FIX_210.replace(
    'window.__PREAMBLE__="eyJzYW5pdGl6ZWQiOiJwcmVhbWJsZSJ9";',
    `window.__PREAMBLE__="eyJzYW5pdGl6ZWQiOiJwcmVhbWJsZSJ9";\n${blob}`,
  );
  assert.notEqual(prot, FIX_210);
  const r = patchPresentationHtml(prot, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.PATCHED, JSON.stringify(r.reasons));
  assert.equal(r.inspection.protected, true);
  assert.equal(count(r.html, blob), 1, "the protected blob survives byte-identical");
  assert.deepEqual(r.branding, { accentColor: FIX_ACCENT, hudBgColor: FIX_HUD });
});

// ── F. Malformed / routing rejections ───────────────────────────────────

test("broken sentinel → rejected invalid, no html", () => {
  // Remove the js:glue END marker entirely (token count drops, END missing).
  const broken = FIX_210.replace(BUILDER_SENTINEL_LITERALS["js:glue"].end, "// closed glue block");
  assert.notEqual(broken, FIX_210);
  assert.equal(inspectPresentationHtml(broken).outcome, "invalid", "inspector must reject the break");
  const r = patchPresentationHtml(broken, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.INVALID);
  assert.equal(r.html, null);
});

test("duplicate f3d meta → rejected invalid, no html", () => {
  const dup = FIX_220.replace(
    '<meta name="f3d-runtime" content="2.2.0" />',
    '<meta name="f3d-runtime" content="2.2.0" />\n<meta name="f3d-runtime" content="2.2.0" />',
  );
  const r = patchPresentationHtml(dup, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.INVALID);
  assert.equal(r.html, null);
});

test("Atlas package → rejected atlas_managed, no html", () => {
  const atlas = `<!doctype html>
<html><head>
<meta name="f3d-package-schema" content="2" />
<meta name="f3d-runtime" content="2.1.0" />
<meta name="f3d-capabilities" content="" />
<meta name="f3d-package-family" content="atlas" />
</head><body>
<!-- f3d:runtime-markup:stage BEGIN v=1 family=atlas -->
<canvas id="anno-canvas"></canvas>
<!-- f3d:runtime-markup:stage END -->
</body></html>`;
  const r = patchPresentationHtml(atlas, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.ATLAS_MANAGED);
  assert.equal(r.html, null);
});

test("synthetic pre-marker legacy → rejected legacy_unsupported, no html", () => {
  const legacy = `<!doctype html>
<html><head><title>Legacy</title></head><body>
<script>
window.__QA_DATABASE__="UExBQ0VIT0xERVI=";
window.__PRESENTATION_TOKEN__="UExBQ0VIT0xERVI=";
</script>
<img src="assets/media/placeholder.jpg" />
</body></html>`;
  const r = patchPresentationHtml(legacy, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.LEGACY_UNSUPPORTED);
  assert.equal(r.html, null);
});

test("not a 3DPS presentation → rejected invalid, no html", () => {
  const r = patchPresentationHtml("<!doctype html><html><body><h1>hello</h1></body></html>", RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.INVALID);
  assert.equal(r.html, null);
});

test("non-string input → rejected not_a_string", () => {
  const r = patchPresentationHtml(null, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.code, REJECTION_CODES.NOT_A_STRING);
  assert.equal(r.html, null);
});

test("real legacy sample (Chaska root file) → rejected, never patched", (t) => {
  const legacyPath = repoPath("Chaska_Commons_Coworking_2026-04-27 (2).html");
  if (!existsSync(legacyPath)) {
    t.skip("legacy sample not present");
    return;
  }
  const r = patchPresentationHtml(readFileSync(legacyPath, "utf8"), RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(r.html, null);
  assert.ok([REJECTION_CODES.LEGACY_UNSUPPORTED, REJECTION_CODES.INVALID].includes(r.code));
});

// ── G. Structured result shape (UI-facing) ──────────────────────────────

test("rejection codes + messages are frozen and complete", () => {
  assert.ok(Object.isFrozen(PATCH_OUTCOMES));
  assert.ok(Object.isFrozen(REJECTION_CODES));
  assert.ok(Object.isFrozen(REJECTION_MESSAGES));
  for (const code of Object.values(REJECTION_CODES)) {
    assert.equal(typeof REJECTION_MESSAGES[code], "string");
    assert.ok(REJECTION_MESSAGES[code].length > 0, `message for ${code}`);
  }
});

test("every rejection carries a code + human message and no html", () => {
  const future = FIX_210.replace(
    '<meta name="f3d-runtime" content="2.1.0" />',
    '<meta name="f3d-runtime" content="9.9.9" />',
  );
  for (const bad of [null, "<h1>nope</h1>", future]) {
    const r = patchPresentationHtml(bad, RUNTIME_SOURCES);
    assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
    assert.ok(Object.values(REJECTION_CODES).includes(r.code));
    assert.equal(typeof r.message, "string");
    assert.equal(r.html, null);
  }
});

test("patched result exposes branding, output html, and post-inspection", () => {
  const r = patchPresentationHtml(FIX_210, RUNTIME_SOURCES);
  assert.equal(r.outcome, PATCH_OUTCOMES.PATCHED);
  assert.equal(typeof r.message, "string");
  assert.ok(r.branding && r.branding.accentColor && r.branding.hudBgColor);
  assert.ok(typeof r.html === "string");
  assert.ok(r.postInspection && r.postInspection.outcome === "already_current");
});

// ── H. normalizeHexColor unit coverage ──────────────────────────────────

test("normalizeHexColor accepts #RGB/#RRGGBB only", () => {
  assert.equal(normalizeHexColor("#abc"), "#aabbcc");
  assert.equal(normalizeHexColor("#AABBCC"), "#aabbcc");
  assert.equal(normalizeHexColor("#2563eb"), "#2563eb");
  assert.equal(normalizeHexColor("#1234"), null);
  assert.equal(normalizeHexColor("#12345"), null);
  assert.equal(normalizeHexColor("#12345678"), null);
  assert.equal(normalizeHexColor("rgb(0,0,0)"), null);
  assert.equal(normalizeHexColor("red"), null);
  assert.equal(normalizeHexColor(""), null);
});

// ── J. Trusted runtime-source validation (fail-closed) ──────────────────

// Intentionally-malformed runtimeSources for a PATCHABLE package: every one
// must be a structured runtime_sources_invalid rejection with html:null and
// NO throw. (Cast to any-ish via a local so the .mjs stays honest about the
// declared required shape while still exercising the runtime guard.)
const BAD_SOURCES = [
  ["omitted", undefined],
  ["null", null],
  ["empty object", {}],
  ["empty strings", { liveSessionJs: "", annoInputJs: "" }],
  ["whitespace-only liveSessionJs", { liveSessionJs: "  \n\t", annoInputJs: "ok" }],
  ["numeric", 5],
  ["array", ["a", "b"]],
  ["missing annoInputJs", { liveSessionJs: "ok" }],
  ["null annoInputJs", { liveSessionJs: "ok", annoInputJs: null }],
];

for (const [label, sources] of BAD_SOURCES) {
  test(`patchable + ${label} runtime sources → rejected runtime_sources_invalid, no html, no throw`, () => {
    let r;
    assert.doesNotThrow(() => {
      r = patchPresentationHtml(FIX_210, sources);
    });
    assert.equal(r.outcome, PATCH_OUTCOMES.REJECTED);
    assert.equal(r.code, REJECTION_CODES.RUNTIME_SOURCES_INVALID);
    assert.equal(r.html, null);
    assert.equal(r.branding, null);
    assert.ok(r.reasons.length > 0);
  });
}

test("runtime-source rejection names the offending field without echoing contents", () => {
  const r = patchPresentationHtml(FIX_210, { liveSessionJs: "ok" });
  assert.equal(r.code, REJECTION_CODES.RUNTIME_SOURCES_INVALID);
  assert.ok(r.reasons.some((x) => x.includes("annoInputJs")), "names the missing field");
});

test("runtime-source validation runs ONLY after inspector eligibility (order preserved)", () => {
  // A non-patchable package with bad sources must keep its inspector code,
  // never runtime_sources_invalid.
  const future = FIX_210.replace(
    '<meta name="f3d-runtime" content="2.1.0" />',
    '<meta name="f3d-runtime" content="9.9.9" />',
  );
  assert.equal(patchPresentationHtml(future, undefined).code, REJECTION_CODES.FUTURE_VERSION);
  assert.equal(patchPresentationHtml("<h1>x</h1>", {}).code, REJECTION_CODES.INVALID);
  assert.equal(patchPresentationHtml(null, {}).code, REJECTION_CODES.NOT_A_STRING);
});

test("already-current noop does not require runtime sources (noop precedes source validation)", () => {
  const current = patchPresentationHtml(FIX_210, RUNTIME_SOURCES).html;
  const r = patchPresentationHtml(current, undefined);
  assert.equal(r.outcome, PATCH_OUTCOMES.NOOP_ALREADY_CURRENT);
  assert.equal(r.html, current);
});

test("runtime_sources_invalid is a registered code with a message", () => {
  assert.equal(REJECTION_CODES.RUNTIME_SOURCES_INVALID, "runtime_sources_invalid");
  assert.equal(typeof REJECTION_MESSAGES[REJECTION_CODES.RUNTIME_SOURCES_INVALID], "string");
  assert.ok(REJECTION_MESSAGES[REJECTION_CODES.RUNTIME_SOURCES_INVALID].length > 0);
});

// ── I. Generator parity — anchors stay locked to portal.functions.ts ─────

test("every branding anchor matches the generator source exactly once", () => {
  const portal = read("src", "lib", "portal.functions.ts");
  for (const a of BRANDING_ANCHORS) {
    const literal = a.prefix + ANCHOR_CHANNEL_TOKEN[a.channel] + a.suffix;
    assert.equal(
      count(portal, literal),
      1,
      `anchor ${a.id} (${a.channel}) must appear exactly once in portal.functions.ts — chrome drift requires a deliberate re-pin`,
    );
  }
  assert.equal(BRANDING_ANCHORS.filter((a) => a.channel === "accent").length, 4);
  assert.equal(BRANDING_ANCHORS.filter((a) => a.channel === "hudBg").length, 3);
});
