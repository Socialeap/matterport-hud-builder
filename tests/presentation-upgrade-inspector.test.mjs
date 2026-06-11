#!/usr/bin/env node

// Presentation Upgrade Inspector (U1 / P1) — classification tests.
//
// Fixtures are SYNTHETIC and SANITIZED by construction: placeholder base64
// ("UExBQ0VIT0xERVI=" = "PLACEHOLDER"), the nil-pattern UUID, no real
// presentation tokens, no protected blobs, no client data, no full customer
// presentation. Uploaded HTML is treated as inert text by the module under
// test; these tests only ever pass strings.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  ATLAS_RUNTIME_VERSION,
  ATLAS_PACKAGE_SCHEMA,
  buildRuntimeMetaTags,
} from "../src/lib/atlas-runtime-version.mjs";
import {
  INSPECTION_OUTCOMES,
  V1_PATCH_SOURCE_VERSION,
  BUILDER_RUNTIME_SPANS,
  F3D_META_NAMES,
  PATCH_MUTATION_ALLOWLIST,
  MANIFEST_SCOPE_NOTE,
  BUILDER_SENTINEL_LITERALS,
  inspectPresentationHtml,
} from "../src/lib/presentation-upgrade-inspector.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoPath = (...p) => path.join(__dirname, "..", ...p);

// ── Sanitized fixture builders ───────────────────────────────────────────

function metaBlock({ schema = "2", version = "2.1.0", caps = "", family = "builder", omit = [] } = {}) {
  const lines = [];
  if (!omit.includes("f3d-package-schema")) lines.push(`<meta name="f3d-package-schema" content="${schema}" />`);
  if (!omit.includes("f3d-runtime")) lines.push(`<meta name="f3d-runtime" content="${version}" />`);
  if (!omit.includes("f3d-capabilities")) lines.push(`<meta name="f3d-capabilities" content="${caps}" />`);
  if (!omit.includes("f3d-package-family")) lines.push(`<meta name="f3d-package-family" content="${family}" />`);
  return lines.join("\n");
}

// Minimal Builder-shaped document: 4 metas + the 5 sentinel spans in
// canonical order + sanitized placeholder config blocks + one relative
// asset reference. `transform` mutates the final string for negative cases.
function makeBuilderHtml(opts = {}) {
  const { withProtected = false, transform } = opts;
  const html = `<!doctype html>
<html><head>
<meta charset="utf-8" />
${metaBlock(opts)}
<title>Fixture</title>
<style>
${BUILDER_SENTINEL_LITERALS.css.begin}
.anno-tool-btn.active{background:#3B82F6;border-color:#3B82F6;color:#fff}
${BUILDER_SENTINEL_LITERALS.css.end}
</style>
</head><body>
<h1>PLACEHOLDER BRAND</h1>
<iframe id="matterport-frame" src="about:blank"></iframe>
<img src="assets/branding/placeholder-logo.png" alt="" />
${BUILDER_SENTINEL_LITERALS["dep:peerjs"].begin}
<script type="text/plain" id="f3d-peerjs-loader">{"url":"placeholder"}</script>
${BUILDER_SENTINEL_LITERALS["dep:peerjs"].end}
${BUILDER_SENTINEL_LITERALS.markup.begin}
<canvas id="anno-canvas"></canvas>
${BUILDER_SENTINEL_LITERALS.markup.end}
<script>
window.__PREAMBLE__="UExBQ0VIT0xERVI=";
window.__CONFIG__="UExBQ0VIT0xERVI=";
window.__SAVED_MODEL_ID__="00000000-0000-4000-8000-000000000000";
${withProtected ? 'window.__PROTECTED__=true;window.__PROTECTED_BLOB__={"salt":"UExBQ0VIT0xERVI="};' : ""}
${BUILDER_SENTINEL_LITERALS["js:kernel"].begin}
function createLiveSession(){return {}}
${BUILDER_SENTINEL_LITERALS["js:kernel"].end}
${BUILDER_SENTINEL_LITERALS["js:glue"].begin}
function setToolMode(){}
${BUILDER_SENTINEL_LITERALS["js:glue"].end}
</script>
</body></html>`;
  return transform ? transform(html) : html;
}

// Minimal Atlas-shaped document (atlas metas + atlas-family sentinels).
function makeAtlasHtml(opts = {}) {
  return `<!doctype html>
<html><head>
${metaBlock({ family: "atlas", version: opts.version || "2.1.0" })}
</head><body>
<!-- f3d:runtime-markup:stage BEGIN v=1 family=atlas -->
<canvas id="anno-canvas"></canvas>
<!-- f3d:runtime-markup:stage END -->
</body></html>`;
}

// Pre-marker legacy 3DPS document (no metas, recognizable signatures).
const LEGACY_HTML = `<!doctype html>
<html><head><title>Legacy Fixture</title></head><body>
<script>
window.__QA_DATABASE__="UExBQ0VIT0xERVI=";
window.__SYNTHESIS_URL__="https://example.invalid/functions/v1/synthesize-answer";
window.__PRESENTATION_TOKEN__="UExBQ0VIT0xERVI=";
</script>
<img src="assets/media/placeholder.jpg" />
</body></html>`;

// ── Positive classifications ─────────────────────────────────────────────

test("valid Builder 2.1.0 with all five sentinels → patchable", () => {
  const r = inspectPresentationHtml(makeBuilderHtml());
  assert.equal(r.outcome, "patchable");
  assert.equal(r.family, "builder");
  assert.equal(r.packageSchema, 2);
  assert.equal(r.runtimeVersion, "2.1.0");
  assert.deepEqual(r.capabilities, []);
  assert.equal(r.protected, false);
  assert.ok(r.sentinels.valid);
  assert.equal(r.sentinels.spans.length, 5);
  assert.ok(r.assets.includes("assets/branding/placeholder-logo.png"));
});

test("sentinel spans are reported with monotonic character offsets in canonical order", () => {
  const r = inspectPresentationHtml(makeBuilderHtml());
  assert.deepEqual(r.sentinels.spans.map((s) => s.name), [...BUILDER_RUNTIME_SPANS]);
  let prev = -1;
  for (const s of r.sentinels.spans) {
    assert.ok(s.beginStart > prev, `${s.name}: beginStart must advance`);
    assert.ok(s.beginStart < s.beginEnd, `${s.name}: begin range`);
    assert.ok(s.beginEnd <= s.endStart, `${s.name}: content range`);
    assert.ok(s.endStart < s.endEnd, `${s.name}: end range`);
    prev = s.endEnd;
  }
});

test("password-protected Builder 2.1.0 stays patchable and reports protected=true", () => {
  const r = inspectPresentationHtml(makeBuilderHtml({ withProtected: true }));
  assert.equal(r.outcome, "patchable");
  assert.equal(r.protected, true);
});

test("Builder package already at the current runtime → already_current", () => {
  const r = inspectPresentationHtml(makeBuilderHtml({ version: ATLAS_RUNTIME_VERSION }));
  assert.equal(r.outcome, "already_current");
  assert.equal(r.runtimeVersion, ATLAS_RUNTIME_VERSION);
});

test("Atlas package → atlas_managed (single-file patch never applies)", () => {
  const r = inspectPresentationHtml(makeAtlasHtml());
  assert.equal(r.outcome, "atlas_managed");
  assert.equal(r.family, "atlas");
  assert.match(r.reasons.join(" "), /GitHub source repository/);
});

test("pre-marker legacy 3DPS presentation → legacy_unsupported", () => {
  const r = inspectPresentationHtml(LEGACY_HTML);
  assert.equal(r.outcome, "legacy_unsupported");
  assert.equal(r.family, "legacy");
  assert.match(r.reasons.join(" "), /regenerate/i);
});

test("pre-family generation (three metas, family missing) → legacy_unsupported", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({ version: "2.0.3", caps: "mobile_voice_v2", omit: ["f3d-package-family"] }),
  );
  assert.equal(r.outcome, "legacy_unsupported");
  assert.equal(r.runtimeVersion, "2.0.3");
});

test("fully marked Builder 2.0.3 (registered historical capability) → legacy_unsupported, not invalid", () => {
  const r = inspectPresentationHtml(makeBuilderHtml({ version: "2.0.3", caps: "mobile_voice_v2" }));
  assert.equal(r.outcome, "legacy_unsupported");
  assert.match(r.reasons.join(" "), new RegExp(V1_PATCH_SOURCE_VERSION.replace(/\./g, "\\.")));
});

// ── Future versions: never downgrade, never guess ────────────────────────

test("future runtime versions → future_version", () => {
  for (const version of ["2.3.0", "3.0.0", "10.0.0"]) {
    const r = inspectPresentationHtml(makeBuilderHtml({ version }));
    assert.equal(r.outcome, "future_version", `runtime ${version}`);
    assert.match(r.reasons.join(" "), /never downgrade/);
  }
});

test("future package schema → future_version", () => {
  const r = inspectPresentationHtml(makeBuilderHtml({ schema: "3", version: ATLAS_RUNTIME_VERSION }));
  assert.equal(r.outcome, "future_version");
});

test("future_version wins even when the (unknown future) sentinel layout looks broken", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({
      version: "2.9.0",
      transform: (h) => h.replace(BUILDER_SENTINEL_LITERALS["js:glue"].end, ""),
    }),
  );
  assert.equal(r.outcome, "future_version");
});

// ── Sentinel integrity failures → invalid ────────────────────────────────

test("duplicated sentinel span → invalid", () => {
  const dup = `${BUILDER_SENTINEL_LITERALS.css.begin}\n.x{}\n${BUILDER_SENTINEL_LITERALS.css.end}`;
  const r = inspectPresentationHtml(
    makeBuilderHtml({ transform: (h) => h.replace("</body>", `<style>${dup}</style></body>`) }),
  );
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /sentinel/i);
});

test("missing sentinel span (js:glue removed) → invalid", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({
      transform: (h) =>
        h
          .replace(BUILDER_SENTINEL_LITERALS["js:glue"].begin, "")
          .replace(BUILDER_SENTINEL_LITERALS["js:glue"].end, ""),
    }),
  );
  assert.equal(r.outcome, "invalid");
});

test("truncated span (END marker lost) → invalid", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({ transform: (h) => h.replace(BUILDER_SENTINEL_LITERALS.markup.end, "") }),
  );
  assert.equal(r.outcome, "invalid");
});

test("reordered sentinel spans → invalid", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({
      transform: (h) => {
        // Swap the dep:peerjs and markup blocks (canonical order violated).
        const dep = h.slice(
          h.indexOf(BUILDER_SENTINEL_LITERALS["dep:peerjs"].begin),
          h.indexOf(BUILDER_SENTINEL_LITERALS["dep:peerjs"].end) +
            BUILDER_SENTINEL_LITERALS["dep:peerjs"].end.length,
        );
        const markup = h.slice(
          h.indexOf(BUILDER_SENTINEL_LITERALS.markup.begin),
          h.indexOf(BUILDER_SENTINEL_LITERALS.markup.end) + BUILDER_SENTINEL_LITERALS.markup.end.length,
        );
        return h.replace(dep, "@@DEP@@").replace(markup, dep).replace("@@DEP@@", markup);
      },
    }),
  );
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /order|sentinel/i);
});

test("current-version package with broken sentinels is corrupt → invalid, not already_current", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({
      version: ATLAS_RUNTIME_VERSION,
      transform: (h) => h.replace(BUILDER_SENTINEL_LITERALS.css.begin, ""),
    }),
  );
  assert.equal(r.outcome, "invalid");
});

// ── Conflicting / tampered markers → invalid ─────────────────────────────

test("duplicate f3d-runtime metas with different values → invalid (ambiguous)", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({
      transform: (h) =>
        h.replace("<title>", '<meta name="f3d-runtime" content="9.9.9" />\n<title>'),
    }),
  );
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /f3d-runtime.*2 times|ambiguous/);
});

test("builder family meta + atlas-family sentinel → invalid (conflicting markers)", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({
      transform: (h) =>
        h.replace("</body>", "<!-- f3d:runtime-markup:stage BEGIN v=1 family=atlas -->x<!-- f3d:runtime-markup:stage END --></body>"),
    }),
  );
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /conflicting/);
});

test("atlas family meta + builder sentinels → invalid (conflicting markers)", () => {
  const r = inspectPresentationHtml(makeBuilderHtml({ family: "atlas" }));
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /conflicting/);
});

test('non-generated family values ("legacy", typo) → invalid', () => {
  for (const family of ["legacy", "bulider", ""]) {
    const r = inspectPresentationHtml(makeAtlasHtml().replace('content="atlas"', `content="${family}"`));
    assert.equal(r.outcome, "invalid", `family=${JSON.stringify(family)}`);
  }
});

test("marker present but reformatted (not the generated format) → invalid", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({
      transform: (h) =>
        h.replace('<meta name="f3d-runtime" content="2.1.0" />', '<meta name="f3d-runtime" content="2.1.0"/>'),
    }),
  );
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /tampered|reformatted/);
});

test("partial marker subset (only runtime marker) → invalid (ambiguous)", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({ omit: ["f3d-package-schema", "f3d-capabilities", "f3d-package-family"] }),
  );
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /partial f3d marker set/);
});

test("sentinels present but every meta stripped → invalid (tampered), not legacy", () => {
  const r = inspectPresentationHtml(
    makeBuilderHtml({
      omit: ["f3d-package-schema", "f3d-runtime", "f3d-capabilities", "f3d-package-family"],
    }),
  );
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /stripped or tampered/);
});

// ── Strictness: semver, schema, capabilities ─────────────────────────────

test("non-strict semver values → invalid", () => {
  for (const version of ["2.1", "v2.1.0", "2.1.0-beta", "2.1.0.0", "current"]) {
    const r = inspectPresentationHtml(makeBuilderHtml({ version }));
    assert.equal(r.outcome, "invalid", `version=${version}`);
  }
});

test("non-integer schema → invalid", () => {
  const r = inspectPresentationHtml(makeBuilderHtml({ schema: "two" }));
  assert.equal(r.outcome, "invalid");
});

test("unknown capability string → invalid (not in the recognized registry)", () => {
  const r = inspectPresentationHtml(makeBuilderHtml({ caps: "teleport_v9" }));
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /unknown capability/);
});

test("2.1.0 advertising capabilities is internally inconsistent → invalid", () => {
  const r = inspectPresentationHtml(makeBuilderHtml({ caps: "mobile_voice_v2" }));
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /inconsistent/);
});

// ── Malformed / non-3DPS input → invalid ─────────────────────────────────

test("non-string, empty, and whitespace inputs → invalid", () => {
  for (const input of [null, undefined, 42, {}, "", "   \n  "]) {
    const r = inspectPresentationHtml(input);
    assert.equal(r.outcome, "invalid", `input=${String(input)}`);
  }
});

test("arbitrary non-3DPS HTML → invalid, never legacy", () => {
  const r = inspectPresentationHtml("<!doctype html><html><body><p>hello world</p></body></html>");
  assert.equal(r.outcome, "invalid");
  assert.match(r.reasons.join(" "), /not a recognizable 3DPS/);
});

// ── Report contract ──────────────────────────────────────────────────────

test("every report carries the external-manifest scope note and a known outcome", () => {
  const samples = [
    makeBuilderHtml(),
    makeBuilderHtml({ version: ATLAS_RUNTIME_VERSION }),
    makeAtlasHtml(),
    LEGACY_HTML,
    "<html></html>",
  ];
  for (const html of samples) {
    const r = inspectPresentationHtml(html);
    assert.equal(r.manifestNote, MANIFEST_SCOPE_NOTE);
    assert.match(r.manifestNote, /atlas-manifest\.json/);
    assert.match(r.manifestNote, /outside this workflow/);
    assert.ok(INSPECTION_OUTCOMES.includes(r.outcome), `unknown outcome ${r.outcome}`);
    assert.ok(r.reasons.length > 0, "every report explains itself");
  }
});

test("the inspector is pure: identical input yields an identical report", () => {
  const html = makeBuilderHtml();
  assert.deepEqual(inspectPresentationHtml(html), inspectPresentationHtml(html));
});

test("mutation allowlist contract: exactly the five spans + four meta names, frozen", () => {
  assert.deepEqual([...PATCH_MUTATION_ALLOWLIST.spans], ["css", "dep:peerjs", "markup", "js:kernel", "js:glue"]);
  assert.deepEqual(
    [...PATCH_MUTATION_ALLOWLIST.metaNames],
    ["f3d-package-schema", "f3d-runtime", "f3d-capabilities", "f3d-package-family"],
  );
  assert.ok(Object.isFrozen(PATCH_MUTATION_ALLOWLIST));
  assert.ok(Object.isFrozen(PATCH_MUTATION_ALLOWLIST.spans));
  assert.ok(Object.isFrozen(PATCH_MUTATION_ALLOWLIST.metaNames));
  assert.deepEqual([...F3D_META_NAMES], [...PATCH_MUTATION_ALLOWLIST.metaNames]);
});

// ── Parity with the real generator (inspector ↔ generator can't skew) ────

test("portal.functions.ts carries each pinned sentinel literal exactly once (10 markers total)", () => {
  const src = readFileSync(repoPath("src", "lib", "portal.functions.ts"), "utf8");
  const count = (needle) => src.split(needle).length - 1;
  for (const name of BUILDER_RUNTIME_SPANS) {
    assert.equal(count(BUILDER_SENTINEL_LITERALS[name].begin), 1, `BEGIN ${name}`);
    assert.equal(count(BUILDER_SENTINEL_LITERALS[name].end), 1, `END ${name}`);
  }
  assert.equal(count("f3d:runtime-"), 10, "exactly 10 sentinel marker occurrences in the generator");
});

test("buildRuntimeMetaTags('builder') output parses through the inspector's strict meta format", () => {
  // Wrap the real generator meta block in a minimal patchable fixture: if
  // the generator's marker format ever drifts, this fails here first.
  const html = makeBuilderHtml({ version: "ignored" }).replace(
    metaBlock({ version: "ignored" }),
    buildRuntimeMetaTags("builder"),
  );
  const r = inspectPresentationHtml(html);
  assert.equal(r.outcome, "already_current");
  assert.equal(r.family, "builder");
  assert.equal(r.packageSchema, ATLAS_PACKAGE_SCHEMA);
  assert.equal(r.runtimeVersion, ATLAS_RUNTIME_VERSION);
  assert.deepEqual(r.capabilities, []);
});

test("v1 source/current versions stay coherent with the version registry", () => {
  assert.equal(V1_PATCH_SOURCE_VERSION, "2.1.0");
  assert.notEqual(ATLAS_RUNTIME_VERSION, V1_PATCH_SOURCE_VERSION, "current must be ahead of the v1 source");
});

// Real-world legacy sample already tracked at the repo root (not copied into
// fixtures; skipped automatically if the artifact is ever relocated).
test("repo-root legacy sample (pre-marker era) classifies as legacy_unsupported", (t) => {
  const legacyPath = repoPath("Chaska_Commons_Coworking_2026-04-27 (2).html");
  if (!existsSync(legacyPath)) {
    t.skip("legacy sample not present");
    return;
  }
  const r = inspectPresentationHtml(readFileSync(legacyPath, "utf8"));
  assert.equal(r.outcome, "legacy_unsupported");
  assert.equal(r.family, "legacy");
});
