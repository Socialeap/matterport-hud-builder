#!/usr/bin/env node

// P5 — admin Presentation Upgrade Center. Pure-logic + static-source proofs for
// the orchestration core (presentation-upgrade-session.mjs), the dedicated
// HTML byte limit, and the admin route/navigation wiring. No DOM: the route
// component itself is verified by static source assertions (the repo's test
// runner is pure Node) plus a browser-level manual checklist in the PR.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  classifyUpload,
  describeDisposition,
  runUpgradeSession,
  inspectPresentationHtml,
} from "../src/lib/presentation-upgrade-session.mjs";
import {
  MAX_PRESENTATION_HTML_BYTES,
  checkPresentationHtmlSize,
} from "../src/lib/limits.ts";
import {
  ATLAS_RUNTIME_VERSION,
  ATLAS_PACKAGE_SCHEMA,
} from "../src/lib/atlas-runtime-version.mjs";
import { stripExports } from "../src/lib/portal/ask-runtime-transformer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoPath = (...p) => path.join(__dirname, "..", ...p);
const read = (...p) => readFileSync(repoPath(...p), "utf8");

// The proven canary path: the real, stripped runtime module sources — the same
// bytes the browser adapter supplies via getBundledRuntimeSources().
const RUNTIME_SOURCES = {
  liveSessionJs: stripExports(read("src", "lib", "portal", "live-session.mjs")),
  annoInputJs: stripExports(read("src", "lib", "portal", "anno-input.mjs")),
};

const FIX_210 = read("tests", "fixtures", "builder-2.1.0.sanitized.html");
const FIX_220 = read("tests", "fixtures", "builder-2.2.0.sanitized.html");

const ROUTE_SRC = read("src", "routes", "_authenticated.admin.presentation-updates.tsx");
const ADMIN_LAYOUT_SRC = read("src", "routes", "_authenticated.admin.tsx");
const ADAPTER_SRC = read("src", "lib", "portal", "upgrade-runtime-sources.ts");

// Strip comments so safety scans test actual CODE, not documentation that may
// legitimately NAME the things we avoid (e.g. portal.functions / createServerFn).
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const ROUTE_CODE = codeOnly(ROUTE_SRC);
const ADAPTER_CODE = codeOnly(ADAPTER_SRC);

async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Replace exactly the f3d-runtime meta VALUE (not the provenance comment).
function setRuntimeMeta(html, version) {
  return html.replace(
    /<meta name="f3d-runtime" content="[^"]*" \/>/,
    `<meta name="f3d-runtime" content="${version}" />`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// A. Dedicated HTML byte limit (P5-only; not the image/PDF/audio policy)
// ─────────────────────────────────────────────────────────────────────────────

test("A1 — MAX_PRESENTATION_HTML_BYTES is a sane dedicated ceiling (≥ canary, bounded)", () => {
  assert.equal(typeof MAX_PRESENTATION_HTML_BYTES, "number");
  // Comfortably above the ~153 KB single-property canary, and bounded so a
  // multi-hundred-MB file can never be read into the tab.
  assert.ok(MAX_PRESENTATION_HTML_BYTES >= 1 * 1024 * 1024);
  assert.ok(MAX_PRESENTATION_HTML_BYTES <= 64 * 1024 * 1024);
});

test("A2 — empty file is rejected before reading", () => {
  const r = checkPresentationHtmlSize(0);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "empty");
  assert.match(r.message, /empty/i);
});

test("A3 — oversize file is rejected", () => {
  const r = checkPresentationHtmlSize(MAX_PRESENTATION_HTML_BYTES + 1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "too_large");
  assert.match(r.message, /too large/i);
});

test("A4 — boundary: exactly the limit is accepted, limit+1 rejected", () => {
  assert.equal(checkPresentationHtmlSize(MAX_PRESENTATION_HTML_BYTES).ok, true);
  assert.equal(checkPresentationHtmlSize(MAX_PRESENTATION_HTML_BYTES + 1).ok, false);
});

test("A5 — a normal presentation size is accepted", () => {
  const r = checkPresentationHtmlSize(160 * 1024);
  assert.equal(r.ok, true);
  assert.equal(r.reason, null);
});

test("A6 — non-finite/negative sizes are treated as empty (fail closed)", () => {
  assert.equal(checkPresentationHtmlSize(Number.NaN).reason, "empty");
  assert.equal(checkPresentationHtmlSize(-5).reason, "empty");
});

// ─────────────────────────────────────────────────────────────────────────────
// B. Upload classification (file type / ZIP rejection)
// ─────────────────────────────────────────────────────────────────────────────

test("B1 — .html and .htm are accepted (any case)", () => {
  assert.equal(classifyUpload({ name: "index.html", type: "text/html" }).accepted, true);
  assert.equal(classifyUpload({ name: "INDEX.HTM", type: "" }).accepted, true);
  assert.equal(classifyUpload({ name: "tour.HtMl", type: "" }).accepted, true);
});

test("B2 — text/html MIME is accepted even with an odd name (drag-drop)", () => {
  assert.equal(classifyUpload({ name: "download", type: "text/html" }).accepted, true);
});

test("B3 — ZIP is rejected with a specific, helpful message", () => {
  const r = classifyUpload({ name: "package.zip", type: "application/zip" });
  assert.equal(r.accepted, false);
  assert.match(r.message, /zip/i);
  assert.match(r.message, /index\.html/i);
});

test("B4 — other types are rejected", () => {
  assert.equal(classifyUpload({ name: "doc.pdf", type: "application/pdf" }).accepted, false);
  assert.equal(classifyUpload({ name: "image.png", type: "image/png" }).accepted, false);
  assert.equal(classifyUpload({ name: "noext", type: "" }).accepted, false);
  assert.equal(classifyUpload({}).accepted, false);
});

test("B5 — a .zip is rejected with ZIP guidance even if MIME claims text/html", () => {
  const r = classifyUpload({ name: "package.zip", type: "text/html" });
  assert.equal(r.accepted, false);
  assert.match(r.message, /zip/i);
  assert.match(r.message, /index\.html/i);
});

test("B6 — a .pdf is rejected even if MIME claims text/html", () => {
  assert.equal(classifyUpload({ name: "document.pdf", type: "text/html" }).accepted, false);
});

test("B7 — known HTML extensions stay accepted regardless of MIME", () => {
  assert.equal(classifyUpload({ name: "index.html", type: "" }).accepted, true);
  assert.equal(classifyUpload({ name: "index.htm", type: "application/octet-stream" }).accepted, true);
});

test("B8 — an extensionless file is accepted ONLY with a genuine text/html MIME", () => {
  assert.equal(classifyUpload({ name: "index", type: "text/html" }).accepted, true);
  assert.equal(classifyUpload({ name: "index", type: "" }).accepted, false);
  assert.equal(classifyUpload({ name: "index", type: "application/octet-stream" }).accepted, false);
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Disposition mapping — every inspector outcome → correct state + actions
// ─────────────────────────────────────────────────────────────────────────────

// Build a real inspection per outcome so the mapping is exercised end-to-end.
const ATLAS_DOC = [
  "<!doctype html><html><head>",
  '<meta name="f3d-package-schema" content="2" />',
  '<meta name="f3d-runtime" content="2.1.0" />',
  '<meta name="f3d-capabilities" content="" />',
  '<meta name="f3d-package-family" content="atlas" />',
  "</head><body></body></html>",
].join("\n");
const LEGACY_DOC =
  "<!doctype html><html><body><script>window.__PREAMBLE__={};window.__CONFIG__={};</script></body></html>";

const DISPOSITION_CASES = [
  { outcome: "patchable", html: FIX_210, canUpgrade: true, tone: "action" },
  { outcome: "already_current", html: null /* derived below */, canUpgrade: false, tone: "success" },
  { outcome: "future_version", html: setRuntimeMeta(FIX_210, "9.9.9"), canUpgrade: false, tone: "warning" },
  { outcome: "atlas_managed", html: ATLAS_DOC, canUpgrade: false, tone: "info" },
  { outcome: "legacy_unsupported", html: LEGACY_DOC, canUpgrade: false, tone: "warning" },
  { outcome: "invalid", html: "this is not a presentation", canUpgrade: false, tone: "error" },
];

test("C0 — fixtures actually classify as patchable (precondition)", () => {
  assert.equal(inspectPresentationHtml(FIX_210).outcome, "patchable");
  assert.equal(inspectPresentationHtml(FIX_220).outcome, "patchable");
});

for (const c of DISPOSITION_CASES) {
  if (c.outcome === "already_current") continue; // derived async in D-block
  test(`C — disposition for ${c.outcome}`, () => {
    const insp = inspectPresentationHtml(c.html);
    assert.equal(insp.outcome, c.outcome, `inspector should classify ${c.outcome}`);
    const d = describeDisposition(insp);
    assert.equal(d.outcome, c.outcome);
    assert.equal(d.canUpgrade, c.canUpgrade);
    assert.equal(d.tone, c.tone);
    assert.ok(d.headline.length > 0);
    assert.ok(d.guidance.length > 0);
  });
}

test("C7 — canUpgrade is true ONLY for patchable", () => {
  for (const c of DISPOSITION_CASES) {
    if (!c.html) continue;
    const d = describeDisposition(inspectPresentationHtml(c.html));
    assert.equal(d.canUpgrade, c.outcome === "patchable");
  }
});

test("C8 — a null/garbage inspection degrades to invalid (never throws)", () => {
  assert.equal(describeDisposition(null).outcome, "invalid");
  assert.equal(describeDisposition({}).outcome, "invalid");
  assert.equal(describeDisposition({ outcome: 42 }).outcome, "invalid");
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Full flow: inspect → upgrade → report → validated download
// ─────────────────────────────────────────────────────────────────────────────

for (const [label, fixture] of [["2.1.0", FIX_210], ["2.2.0", FIX_220]]) {
  test(`D — ${label}: patchable completes to a validated, re-inspectable download`, async () => {
    const result = await runUpgradeSession({
      filename: "index.html",
      html: fixture,
      runtimeSources: RUNTIME_SOURCES,
    });

    assert.equal(result.outcome, "patched");
    assert.equal(result.downloadable, true);
    assert.ok(result.download, "a download payload must be present");
    assert.equal(result.error, null);

    // Report contract.
    assert.equal(result.report.outcome, "patched");
    assert.equal(result.report.download.available, true);
    assert.equal(result.report.runtime.to, ATLAS_RUNTIME_VERSION);
    assert.equal(result.report.schema.to, ATLAS_PACKAGE_SCHEMA);
    assert.equal(result.report.preservation.verified, true);
    assert.equal(result.report.mutations.spans.length, 5);
    assert.equal(result.report.mutations.metas.length, 4);

    // Download payload is the EXACT validated html, safely named.
    assert.equal(result.download.mimeType, "text/html");
    assert.match(result.download.filename, /\.upgraded-.*\.html$/);

    // ACCEPTANCE: the downloaded output re-inspects as already_current and its
    // SHA-256 equals the report's after-hash.
    const reInspect = inspectPresentationHtml(result.download.html);
    assert.equal(reInspect.outcome, "already_current");
    assert.equal(reInspect.runtimeVersion, ATLAS_RUNTIME_VERSION);
    assert.equal(await sha256Hex(result.download.html), result.report.sha256.after);
  });
}

test("D3 — re-uploading an upgraded file is a no-op (no download)", async () => {
  const first = await runUpgradeSession({
    filename: "index.html",
    html: FIX_210,
    runtimeSources: RUNTIME_SOURCES,
  });
  assert.equal(first.downloadable, true);

  // The already_current output now drives the disposition + a second run.
  const upgraded = first.download.html;
  assert.equal(describeDisposition(inspectPresentationHtml(upgraded)).outcome, "already_current");

  const second = await runUpgradeSession({
    filename: "index.upgraded.html",
    html: upgraded,
    runtimeSources: RUNTIME_SOURCES,
  });
  assert.equal(second.outcome, "noop_already_current");
  assert.equal(second.downloadable, false);
  assert.equal(second.download, null);
  assert.ok(second.error && second.error.length > 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Download is suppressed on every non-clean path
// ─────────────────────────────────────────────────────────────────────────────

test("E1 — rejected (future_version) suppresses the download", async () => {
  const result = await runUpgradeSession({
    filename: "index.html",
    html: setRuntimeMeta(FIX_210, "9.9.9"),
    runtimeSources: RUNTIME_SOURCES,
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.downloadable, false);
  assert.equal(result.download, null);
  assert.ok(result.report);
  assert.equal(result.report.download.available, false);
  assert.equal(result.report.rejection?.code, "future_version");
  assert.ok(result.error && result.error.length > 0);
});

test("E2 — invalid input suppresses the download", async () => {
  const result = await runUpgradeSession({
    filename: "x.html",
    html: "not a presentation at all",
    runtimeSources: RUNTIME_SOURCES,
  });
  assert.equal(result.outcome, "rejected");
  assert.equal(result.downloadable, false);
  assert.equal(result.download, null);
});

test("E3 — missing/garbage runtime sources fail closed (no download)", async () => {
  for (const bad of [undefined, {}, { liveSessionJs: "", annoInputJs: "" }, { liveSessionJs: 1, annoInputJs: 2 }]) {
    const result = await runUpgradeSession({
      filename: "index.html",
      html: FIX_210,
      runtimeSources: bad,
    });
    assert.equal(result.downloadable, false, `bad sources ${JSON.stringify(bad)} must not download`);
    assert.equal(result.download, null);
    assert.equal(result.outcome, "rejected");
    assert.equal(result.report?.rejection?.code, "runtime_sources_invalid");
  }
});

test("E4 — a non-string html is a controlled error (no throw, no download)", async () => {
  const result = await runUpgradeSession({ filename: "x.html", html: 12345, runtimeSources: RUNTIME_SOURCES });
  assert.equal(result.outcome, "error");
  assert.equal(result.downloadable, false);
  assert.equal(result.download, null);
  assert.equal(result.report, null);
  assert.ok(result.error && result.error.length > 0);
});

test("E5 — invariant: downloadable ⟺ a payload is present", async () => {
  const cases = [
    FIX_210,
    setRuntimeMeta(FIX_210, "9.9.9"),
    "garbage",
  ];
  for (const html of cases) {
    const r = await runUpgradeSession({ filename: "index.html", html, runtimeSources: RUNTIME_SOURCES });
    assert.equal(r.downloadable, r.download !== null);
    if (r.downloadable) assert.equal(r.report.download.available, true);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Admin route + navigation wiring (static, since the runner is DOM-free)
// ─────────────────────────────────────────────────────────────────────────────

test("F1 — route is registered under the authenticated admin layout", () => {
  assert.match(
    ROUTE_SRC,
    /createFileRoute\("\/_authenticated\/admin\/presentation-updates"\)/,
    "route must use the admin-layout file-route id",
  );
  // The generated tree must reference the new route (regenerated by the build).
  const tree = read("src", "routeTree.gen.ts");
  assert.match(tree, /presentation-updates/, "routeTree.gen.ts must include the new route");
});

test("F2 — navigation entry exists with a Lucide icon", () => {
  assert.match(ADMIN_LAYOUT_SRC, /to="\/admin\/presentation-updates"/);
  assert.match(ADMIN_LAYOUT_SRC, /Presentation Updates/);
  assert.match(ADMIN_LAYOUT_SRC, /RefreshCw/, "a Lucide icon should accompany the nav item");
});

test("F3 — the route does NOT create parallel auth logic (relies on the layout gate)", () => {
  assert.doesNotMatch(ROUTE_SRC, /user_roles/);
  assert.doesNotMatch(ROUTE_SRC, /roles\.includes/);
});

test("F4 — the route delegates async ops to the guarded controller", () => {
  assert.match(ROUTE_SRC, /createUpgradeController/);
  assert.match(ROUTE_SRC, /controller\.select\(/);
  assert.match(ROUTE_SRC, /controller\.upgrade\(/);
  assert.match(ROUTE_SRC, /controller\.clear\(\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// G. Safety: uploaded HTML is never rendered/executed; no server import
// ─────────────────────────────────────────────────────────────────────────────

test("G1 — the route never renders or executes the uploaded HTML", () => {
  const forbidden = [
    "dangerouslySetInnerHTML",
    "srcdoc",
    "<iframe",
    ".innerHTML",
    ".outerHTML",
    "insertAdjacentHTML",
    "document.write",
    "eval(",
    "new Function",
  ];
  for (const token of forbidden) {
    assert.ok(!ROUTE_CODE.includes(token), `route code must not contain ${token}`);
  }
});

test("G2 — runtime sources come from the trusted bundle adapter, never the upload", () => {
  assert.match(ROUTE_SRC, /getBundledRuntimeSources/);
  // No server-only generator import in the client route.
  assert.doesNotMatch(ROUTE_CODE, /portal\.functions/);
});

test("G3 — the adapter reuses the pure ?raw loaders and avoids server code", () => {
  assert.match(ADAPTER_SRC, /getLiveSessionRuntimeJS/);
  assert.match(ADAPTER_SRC, /getAnnoInputRuntimeJS/);
  assert.doesNotMatch(ADAPTER_CODE, /portal\.functions/);
  assert.doesNotMatch(ADAPTER_CODE, /createServerFn/);
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Reset / re-selection behaviors are wired (static)
// ─────────────────────────────────────────────────────────────────────────────

test("H1 — the route wires the dedicated size check into the controller", () => {
  assert.match(ROUTE_SRC, /checkSize:\s*checkPresentationHtmlSize/);
  // The size-guard-BEFORE-read ordering is proven behaviorally in the
  // controller suite (I7: an oversize file never reaches readFile).
});

test("H2 — reset clears the session and allows re-selecting the same file", () => {
  assert.match(ROUTE_SRC, /controller\.clear\(\)/);
  assert.match(ROUTE_SRC, /e\.target\.value = ""/, "input value reset enables same-file reselection");
});

test("H3 — the object URL is revoked after download", () => {
  assert.match(ROUTE_SRC, /createObjectURL/);
  assert.match(ROUTE_SRC, /revokeObjectURL/);
});

test("H4 — the route file exists where the file-based router expects it", () => {
  assert.ok(existsSync(repoPath("src", "routes", "_authenticated.admin.presentation-updates.tsx")));
});
