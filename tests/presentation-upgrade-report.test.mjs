#!/usr/bin/env node

// P4 — Presentation Upgrade Report + downloadable output layer. Pure layer
// AROUND the approved P3 patcher (patcher unchanged). Covers all seven
// approved review corrections.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { patchPresentationHtml, PATCH_OUTCOMES } from "../src/lib/presentation-upgrade-patcher.mjs";
import {
  buildUpgradeReport,
  prepareUpgradeDownload,
  replacementFilenameFor,
  sanitizeStem,
  UpgradeReportError,
  REPORT_SCHEMA_VERSION,
  DOWNLOAD_MIME_TYPE,
} from "../src/lib/presentation-upgrade-report.mjs";
import { BUILDER_MARKUP_SPAN, BUILDER_DEP_PEERJS_SPAN } from "../src/lib/portal/builder-runtime-spans.mjs";
import { ATLAS_RUNTIME_VERSION } from "../src/lib/atlas-runtime-version.mjs";
import { stripExports } from "../src/lib/portal/ask-runtime-transformer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(__dirname, "..", ...p), "utf8");

const RUNTIME_SOURCES = {
  liveSessionJs: stripExports(read("src", "lib", "portal", "live-session.mjs")),
  annoInputJs: stripExports(read("src", "lib", "portal", "anno-input.mjs")),
};
const FIX_210 = read("tests", "fixtures", "builder-2.1.0.sanitized.html");
const FIX_220 = read("tests", "fixtures", "builder-2.2.0.sanitized.html");
const utf8Len = (s) => new TextEncoder().encode(s).length;

const patch210 = () => patchPresentationHtml(FIX_210, RUNTIME_SOURCES);
const patch220 = () => patchPresentationHtml(FIX_220, RUNTIME_SOURCES);

// ── A. Realistic end-to-end report (primary proof) ──────────────────────

for (const [version, fixture] of [["2.1.0", FIX_210], ["2.2.0", FIX_220]]) {
  test(`report for realistic ${version} patch — fields + download binding`, async () => {
    const pr = patchPresentationHtml(fixture, RUNTIME_SOURCES);
    const rep = await buildUpgradeReport({
      originalFilename: `Maple Grove ${version}.html`,
      originalHtml: fixture,
      patchResult: pr,
    });
    assert.equal(rep.schemaVersion, REPORT_SCHEMA_VERSION);
    assert.equal(rep.outcome, PATCH_OUTCOMES.PATCHED);
    assert.equal(rep.inspectionOutcome, "patchable");
    assert.equal(rep.runtime.from, version);
    assert.equal(rep.runtime.to, ATLAS_RUNTIME_VERSION);
    assert.match(rep.sha256.before, /^[0-9a-f]{64}$/);
    assert.match(rep.sha256.after, /^[0-9a-f]{64}$/);
    assert.notEqual(rep.sha256.before, rep.sha256.after);
    assert.deepEqual(rep.branding, { accentColor: "#2563eb", hudBgColor: "#0f172a" });
    assert.equal(rep.preservation.verified, true);
    assert.equal(rep.preservation.untouchedSegmentCount, 10);
    assert.ok(rep.manifestNote && rep.manifestNote.includes("atlas-manifest.json"));
    assert.equal(rep.download.available, true);

    const dl = await prepareUpgradeDownload(pr, rep);
    assert.ok(dl, "download payload must be produced for a verified patch");
    assert.equal(dl.html, pr.html, "download html must be EXACTLY the validated result.html");
    assert.equal(dl.filename, rep.replacementFilename);
    assert.equal(dl.mimeType, DOWNLOAD_MIME_TYPE);
    assert.match(dl.filename, /\.upgraded-2\.2\.1\.html$/);
  });
}

// ── B. Correction 1 — span boundary matches P3 (indentation included) ────

test("span measurements use the P3 extended region (markup's leading indent included)", async () => {
  const pr = patch210();
  const rep = await buildUpgradeReport({ originalFilename: "x.html", originalHtml: FIX_210, patchResult: pr });
  const markup = rep.mutations.spans.find((s) => s.name === "markup");
  assert.ok(BUILDER_MARKUP_SPAN.startsWith("    "), "canonical markup span carries leading indent");
  // afterBytes must equal the FULL canonical span incl. its 4-space indent —
  // a token-only (beginStart→endEnd) measure would be 4 bytes short.
  assert.equal(markup.afterBytes, utf8Len(BUILDER_MARKUP_SPAN));
  assert.ok(markup.afterBytes > utf8Len(BUILDER_MARKUP_SPAN.trimStart()));
});

// ── C. Correction 2 — download is bound to THIS patch's html ─────────────

test("download is suppressed when the report is paired with different/modified html", async () => {
  const pr = patch210();
  const rep = await buildUpgradeReport({ originalFilename: "x.html", originalHtml: FIX_210, patchResult: pr });

  // (a) modified html — re-hash will not match report.sha256.after
  const tampered = { ...pr, html: pr.html + "\n<!-- tampered -->" };
  assert.equal(await prepareUpgradeDownload(tampered, rep), null);

  // (b) a DIFFERENT patch result (2.2.0) paired with the 2.1.0 report
  const otherPr = patch220();
  assert.equal(await prepareUpgradeDownload(otherPr, rep), null);

  // sanity: the correctly-paired result still downloads
  assert.ok(await prepareUpgradeDownload(pr, rep));
});

// ── D. Correction 3 — hashing fails closed (no placeholder, no download) ──

test("buildUpgradeReport throws UpgradeReportError when Web Crypto is unavailable", async () => {
  const pr = patch210();
  const desc = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    await assert.rejects(
      () => buildUpgradeReport({ originalFilename: "x.html", originalHtml: FIX_210, patchResult: pr }),
      UpgradeReportError,
    );
  } finally {
    Object.defineProperty(globalThis, "crypto", desc);
  }
});

test("prepareUpgradeDownload returns null (never throws) when Web Crypto is unavailable", async () => {
  const pr = patch210();
  const rep = await buildUpgradeReport({ originalFilename: "x.html", originalHtml: FIX_210, patchResult: pr });
  const desc = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
  try {
    assert.equal(await prepareUpgradeDownload(pr, rep), null);
  } finally {
    Object.defineProperty(globalThis, "crypto", desc);
  }
});

// ── E. Correction 4 — notes vs warnings vs rejection ─────────────────────

test("successful patch details are notes, not warnings; warnings carry the manifest limitation", async () => {
  const pr = patch210();
  const rep = await buildUpgradeReport({ originalFilename: "x.html", originalHtml: FIX_210, patchResult: pr });
  assert.ok(rep.notes.some((n) => /replaced .* runtime spans/.test(n)), "patch detail is a note");
  assert.ok(!rep.warnings.some((w) => /replaced .* runtime spans/.test(w)), "patch detail is NOT a warning");
  assert.ok(rep.warnings.some((w) => w.includes("atlas-manifest.json")), "manifest limitation is a warning");
  assert.equal(rep.rejection, null);
});

// ── F. Correction 5 — replaced/rewritten vs actual change ────────────────

test("every span is replaced:true and every meta rewritten:true (operation flags)", async () => {
  const pr = patch220();
  const rep = await buildUpgradeReport({ originalFilename: "x.html", originalHtml: FIX_220, patchResult: pr });
  assert.equal(rep.mutations.spans.length, 5);
  assert.equal(rep.mutations.metas.length, 4);
  assert.ok(rep.mutations.spans.every((s) => s.replaced === true));
  assert.ok(rep.mutations.metas.every((m) => m.rewritten === true));
});

test("meta change flags: only f3d-runtime changes value; schema/caps/family re-asserted", async () => {
  const pr = patch220();
  const rep = await buildUpgradeReport({ originalFilename: "x.html", originalHtml: FIX_220, patchResult: pr });
  const byName = Object.fromEntries(rep.mutations.metas.map((m) => [m.name, m]));
  assert.deepEqual(
    { from: byName["f3d-runtime"].from, to: byName["f3d-runtime"].to, changed: byName["f3d-runtime"].changed },
    { from: "2.2.0", to: ATLAS_RUNTIME_VERSION, changed: true },
  );
  assert.equal(byName["f3d-package-schema"].changed, false);
  assert.equal(byName["f3d-capabilities"].changed, false);
  assert.equal(byName["f3d-package-family"].changed, false);
});

test("span replaced-but-unchanged is distinguished from an actual byte change", async () => {
  // Force the dep:peerjs span to already equal the canonical builder, so the
  // patch replaces it with byte-identical content → replaced:true, changed:false.
  const begin = "<!-- f3d:runtime-dep:peerjs BEGIN v=1 family=builder -->";
  const end = "<!-- f3d:runtime-dep:peerjs END -->";
  const s = FIX_220.indexOf(begin);
  const e = FIX_220.indexOf(end) + end.length;
  const variant = FIX_220.slice(0, s) + BUILDER_DEP_PEERJS_SPAN + FIX_220.slice(e);
  const pr = patchPresentationHtml(variant, RUNTIME_SOURCES);
  assert.equal(pr.outcome, PATCH_OUTCOMES.PATCHED, JSON.stringify(pr.reasons));
  const rep = await buildUpgradeReport({ originalFilename: "x.html", originalHtml: variant, patchResult: pr });
  const dep = rep.mutations.spans.find((s2) => s2.name === "dep:peerjs");
  assert.equal(dep.replaced, true);
  assert.equal(dep.changed, false, "dep span was replaced with byte-identical content");
  assert.ok(rep.mutations.spans.find((s2) => s2.name === "js:glue").changed, "glue still actually changed");
});

// ── G. Correction 6 — filename safety ────────────────────────────────────

test("replacement filenames are safe across hostile inputs", () => {
  const cases = [
    ["../../etc/passwd", "passwd"],
    ["..\\..\\windows\\system32\\evil.html", "evil"],
    [".htaccess", "htaccess"],
    ["...", "presentation"],
    ["", "presentation"],
    [".", "presentation"],
    ["..", "presentation"],
    ["日本語", "presentation"],
    ["report.html.html", "report"],
    ["my file (v2).HTML", "my_file_v2"],
  ];
  for (const [input, expectedStem] of cases) {
    const fn = replacementFilenameFor(input);
    assert.equal(fn, `${expectedStem}.upgraded-${ATLAS_RUNTIME_VERSION}.html`, `input ${JSON.stringify(input)}`);
    assert.ok(!fn.includes("/") && !fn.includes("\\"), "no path separators");
    assert.ok(!fn.startsWith("."), "no leading dot");
    assert.ok(!/\.html\.html$/.test(fn), "no double .html");
  }
});

test("control characters and path separators cannot survive; length is capped with suffix intact", () => {
  const ctrl = replacementFilenameFor("ab" + String.fromCharCode(0, 7, 47, 46, 46, 92, 100) + ".html");
  assert.ok(!ctrl.includes("/") && !ctrl.includes(String.fromCharCode(92)), "no path separators");
  assert.ok(![...ctrl].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127), "no control characters");
  assert.ok(ctrl.endsWith(`.upgraded-${ATLAS_RUNTIME_VERSION}.html`));

  const long = replacementFilenameFor("z".repeat(5000) + ".html");
  assert.ok(long.length <= 120, `capped (${long.length})`);
  assert.ok(long.endsWith(`.upgraded-${ATLAS_RUNTIME_VERSION}.html`), "suffix intact after capping");
  assert.ok(long.startsWith("z"));

  assert.equal(sanitizeStem("///"), "presentation");
  assert.equal(sanitizeStem(undefined), "presentation");
});

// ── H. Correction 7 — malformed-result handling (no uncontrolled throw) ───

test("buildUpgradeReport throws a controlled UpgradeReportError on malformed input", async () => {
  await assert.rejects(() => buildUpgradeReport({ originalHtml: FIX_210, patchResult: null }), UpgradeReportError);
  await assert.rejects(() => buildUpgradeReport({ originalHtml: FIX_210, patchResult: {} }), UpgradeReportError);
  await assert.rejects(
    () => buildUpgradeReport({ originalHtml: FIX_210, patchResult: { outcome: "bogus" } }),
    UpgradeReportError,
  );
  await assert.rejects(
    () => buildUpgradeReport({ originalHtml: 123, patchResult: patch210() }),
    UpgradeReportError,
  );
  // patched-shaped but missing postInspection
  const broken = { ...patch210(), postInspection: null };
  await assert.rejects(() => buildUpgradeReport({ originalHtml: FIX_210, patchResult: broken }), UpgradeReportError);
});

test("prepareUpgradeDownload returns null (never throws) for malformed inputs", async () => {
  assert.equal(await prepareUpgradeDownload(null, null), null);
  assert.equal(await prepareUpgradeDownload({}, {}), null);
  assert.equal(await prepareUpgradeDownload(patch210(), { outcome: "patched" }), null);
});

// ── I. Rejected + noop reports ───────────────────────────────────────────

test("rejected result → rejection populated, no after-hash, no download", async () => {
  const future = FIX_210.replace(
    '<meta name="f3d-runtime" content="2.1.0" />',
    '<meta name="f3d-runtime" content="9.9.9" />',
  );
  const pr = patchPresentationHtml(future, RUNTIME_SOURCES);
  const rep = await buildUpgradeReport({ originalFilename: "x.html", originalHtml: future, patchResult: pr });
  assert.equal(rep.outcome, PATCH_OUTCOMES.REJECTED);
  assert.equal(rep.rejection.code, "future_version");
  assert.ok(typeof rep.rejection.message === "string" && rep.rejection.message.length > 0);
  assert.ok(Array.isArray(rep.rejection.reasons) && rep.rejection.reasons.length > 0);
  assert.equal(rep.sha256.after, null);
  assert.equal(rep.branding, null);
  assert.deepEqual(rep.mutations, { spans: [], metas: [] });
  assert.equal(rep.download.available, false);
  assert.equal(rep.replacementFilename, null);
  assert.equal(await prepareUpgradeDownload(pr, rep), null);
});

test("already-current noop → echo hash, no mutations, no download", async () => {
  const current = patch210().html; // a real current package
  const pr = patchPresentationHtml(current, RUNTIME_SOURCES);
  assert.equal(pr.outcome, PATCH_OUTCOMES.NOOP_ALREADY_CURRENT);
  const rep = await buildUpgradeReport({ originalFilename: "current.html", originalHtml: current, patchResult: pr });
  assert.equal(rep.outcome, PATCH_OUTCOMES.NOOP_ALREADY_CURRENT);
  assert.equal(rep.sha256.after, rep.sha256.before, "noop echoes the same bytes");
  assert.equal(rep.runtime.to, ATLAS_RUNTIME_VERSION);
  assert.deepEqual(rep.mutations, { spans: [], metas: [] });
  assert.equal(rep.download.available, false);
  assert.equal(await prepareUpgradeDownload(pr, rep), null);
});

// ── K. Source-binding integrity (Codex re-review corrections) ────────────

test("in-region tampering of the original is rejected (sourceHtml binding)", async () => {
  // P3 consumed FIX_210. Tamper the original with a SAME-LENGTH edit INSIDE the
  // js:glue span — the untouched segments stay identical, but sourceHtml differs.
  const pr = patch210();
  const tampered = FIX_210.replace("Desktop-only Live Tour glue", "Desktop-ONLY Live Tour glue");
  assert.notEqual(tampered, FIX_210);
  assert.equal(tampered.length, FIX_210.length, "tamper must be same-length (in-region)");
  await assert.rejects(
    () => buildUpgradeReport({ originalFilename: "evil.html", originalHtml: tampered, patchResult: pr }),
    UpgradeReportError,
  );
});

test("a report built from a different original never authorizes a download", async () => {
  const pr210 = patch210();
  const rep210 = await buildUpgradeReport({ originalFilename: "a.html", originalHtml: FIX_210, patchResult: pr210 });
  const pr220 = patch220();
  assert.equal(await prepareUpgradeDownload(pr220, rep210), null);
});

test("noop whose html differs from the original is rejected", async () => {
  const current = patch210().html;
  const noop = patchPresentationHtml(current, RUNTIME_SOURCES);
  assert.equal(noop.outcome, PATCH_OUTCOMES.NOOP_ALREADY_CURRENT);
  await assert.rejects(
    () => buildUpgradeReport({ originalFilename: "x.html", originalHtml: current + " ", patchResult: noop }),
    UpgradeReportError,
  );
});

test("tampered replacementFilename is rejected (recomputed safe name must match)", async () => {
  const pr = patch210();
  const rep = await buildUpgradeReport({ originalFilename: "a.html", originalHtml: FIX_210, patchResult: pr });
  const tampered = { ...rep, replacementFilename: "../../evil.html" };
  assert.equal(await prepareUpgradeDownload(pr, tampered), null);
});

test("tampered postInspection (outcome/runtime/schema/family/sentinels) is rejected", async () => {
  const pr = patch210();
  const rep = await buildUpgradeReport({ originalFilename: "a.html", originalHtml: FIX_210, patchResult: pr });
  const mutate = (patch) => ({ ...pr, postInspection: { ...pr.postInspection, ...patch } });
  assert.equal(await prepareUpgradeDownload(mutate({ outcome: "patchable" }), rep), null, "outcome");
  assert.equal(await prepareUpgradeDownload(mutate({ runtimeVersion: "9.9.9" }), rep), null, "runtime");
  assert.equal(await prepareUpgradeDownload(mutate({ packageSchema: 3 }), rep), null, "schema");
  assert.equal(await prepareUpgradeDownload(mutate({ family: "atlas" }), rep), null, "family");
  assert.equal(
    await prepareUpgradeDownload(
      { ...pr, postInspection: { ...pr.postInspection, sentinels: { ...pr.postInspection.sentinels, valid: false } } },
      rep,
    ),
    null,
    "sentinel validity",
  );
});

test("tampered report hashes (before/after) are rejected", async () => {
  const pr = patch210();
  const rep = await buildUpgradeReport({ originalFilename: "a.html", originalHtml: FIX_210, patchResult: pr });
  const badBefore = { ...rep, sha256: { ...rep.sha256, before: "f".repeat(64) } };
  const badAfter = { ...rep, sha256: { ...rep.sha256, after: "0".repeat(64) } };
  assert.equal(await prepareUpgradeDownload(pr, badBefore), null);
  assert.equal(await prepareUpgradeDownload(pr, badAfter), null);
});

test("a modified output (source intact) is rejected by the after-hash", async () => {
  const pr = patch210();
  const rep = await buildUpgradeReport({ originalFilename: "a.html", originalHtml: FIX_210, patchResult: pr });
  const modifiedOutput = { ...pr, html: pr.html + "\n<!-- tamper -->" };
  assert.equal(await prepareUpgradeDownload(modifiedOutput, rep), null);
});

test("a fully valid report/download still succeeds and returns the exact patched HTML", async () => {
  const pr = patch210();
  const rep = await buildUpgradeReport({ originalFilename: "Maple Grove.html", originalHtml: FIX_210, patchResult: pr });
  const dl = await prepareUpgradeDownload(pr, rep);
  assert.ok(dl, "valid download must be authorized");
  assert.equal(dl.html, pr.html, "returns the exact validated patched HTML");
  assert.equal(dl.filename, `Maple_Grove.upgraded-${ATLAS_RUNTIME_VERSION}.html`);
  assert.equal(dl.mimeType, DOWNLOAD_MIME_TYPE);
});

// ── J. Determinism ───────────────────────────────────────────────────────

test("report generation is deterministic for identical inputs", async () => {
  const pr = patch210();
  const a = await buildUpgradeReport({ originalFilename: "x.html", originalHtml: FIX_210, patchResult: pr });
  const b = await buildUpgradeReport({ originalFilename: "x.html", originalHtml: FIX_210, patchResult: pr });
  assert.deepEqual(a, b);
});
