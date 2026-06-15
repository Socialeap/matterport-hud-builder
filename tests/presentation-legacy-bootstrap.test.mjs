#!/usr/bin/env node

// Legacy Bootstrap (L1 profile inspector + L2/L3 adapter/contract) — exercised
// over the sanitized realistic May-2026 protected fixture and adversarial
// variants. The fixture carries the exact builder-may2026-f8f68f0 anchors,
// dependency-closure chrome, and protected mode; all secrets/PII are redacted.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";

import {
  inspectLegacyProfile,
  LEGACY_PROFILE_ID,
  PEERJS_TAG,
  REGION_ANCHORS,
  META_INSERT_ANCHOR,
  REQUIRED_WINDOW_HELPERS,
} from "../src/lib/presentation-legacy-profile.mjs";
import { findPhones } from "../scripts/lib/redact-phones.mjs";
import {
  bootstrapLegacyPresentation,
  CURRENT_IFRAME_MP,
  CURRENT_IFRAME_MP_GHOST,
} from "../src/lib/presentation-legacy-bootstrap.mjs";
import { inspectPresentationHtml } from "../src/lib/presentation-upgrade-inspector.mjs";
import { stripExports } from "../src/lib/portal/ask-runtime-transformer.mjs";
import {
  buildRuntimeMetaTags,
  ATLAS_RUNTIME_VERSION,
  ATLAS_PACKAGE_SCHEMA,
} from "../src/lib/atlas-runtime-version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(__dirname, "..", ...p), "utf8");
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

const FIX = read("tests", "fixtures", "legacy-builder-may2026.sanitized.html");
const FIX_210 = read("tests", "fixtures", "builder-2.1.0.sanitized.html");
const FIX_220 = read("tests", "fixtures", "builder-2.2.0.sanitized.html");
const RUNTIME_SOURCES = {
  liveSessionJs: stripExports(read("src", "lib", "portal", "live-session.mjs")),
  annoInputJs: stripExports(read("src", "lib", "portal", "anno-input.mjs")),
};
const boot = (html, rs = RUNTIME_SOURCES) => bootstrapLegacyPresentation(html, rs);

// ── A. Profile inspector (L1) ────────────────────────────────────────────────
test("A1 — fixture recognized as the exact supported profile (protected)", () => {
  const p = inspectLegacyProfile(FIX);
  assert.equal(p.recognized, true);
  assert.equal(p.supported, true);
  assert.equal(p.confidence, 1);
  assert.equal(p.profileId, LEGACY_PROFILE_ID);
  assert.equal(p.protected, true);
});

test("A2 — branding recovered from preserved chrome", () => {
  const p = inspectLegacyProfile(FIX);
  assert.deepEqual(p.branding, { accentColor: "#3B82F6", hudBgColor: "#1a1a2e" });
});

test("A3 — capability inventory", () => {
  const caps = inspectLegacyProfile(FIX).capabilities;
  for (const c of ["live_tour", "annotation", "ghost_iframe", "ask", "view_sync", "protected", "relative_assets"]) {
    assert.ok(caps.includes(c), `expected capability ${c}`);
  }
});

test("A4 — 8 mutation regions, canonical order, non-overlapping", () => {
  const regions = inspectLegacyProfile(FIX).regions;
  assert.equal(regions.length, 8);
  const sorted = regions.slice().sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i].start >= sorted[i - 1].end);
  assert.deepEqual(sorted.map((r) => r.key), [
    "meta", "css", "dep:peerjs", "iframe:matterport-frame",
    "iframe:matterport-frame-ghost", "markup", "js:kernel", "js:glue",
  ]);
});

// ── B. Bootstrap success (L2/L3) ─────────────────────────────────────────────
test("B1 — bootstraps to the current contract; reinspects already_current", () => {
  const r = boot(FIX);
  assert.equal(r.outcome, "bootstrapped");
  assert.equal(r.code, null);
  assert.equal(r.postInspection.outcome, "already_current");
  assert.equal(r.postInspection.runtimeVersion, ATLAS_RUNTIME_VERSION);
  assert.equal(r.postInspection.packageSchema, ATLAS_PACKAGE_SCHEMA);
  assert.equal(r.postInspection.family, "builder");
  assert.deepEqual(r.postInspection.capabilities, []);
});

test("B2 — output sentinels valid (5 spans) + source binding", () => {
  const r = boot(FIX);
  assert.equal(r.postInspection.sentinels.valid, true);
  assert.equal(r.postInspection.sentinels.spans.length, 5);
  assert.equal(r.sourceHtml, FIX);
  assert.notEqual(sha(r.html), sha(FIX));
});

// ── C. Output carries the current canonical runtime features ─────────────────
test("C1 — Eraser, lazy PeerJS, desktop-only collab, two-way sync present in output", () => {
  const out = boot(FIX).html;
  assert.ok(out.includes('data-tool="eraser"'), "Eraser");
  assert.ok(out.includes('id="f3d-peerjs-loader"') && out.includes('type="text/plain"'), "lazy PeerJS loader");
  assert.ok(out.includes("annoCollabEligible"), "desktop-only collaboration gate");
  assert.ok(out.includes("location_share"), "two-way view/location sync");
});

test("C2 — output carries the 4 canonical metas + current iframe allow", () => {
  const out = boot(FIX).html;
  for (const meta of buildRuntimeMetaTags("builder").split("\n")) assert.ok(out.includes(meta), meta);
  assert.ok(out.includes(CURRENT_IFRAME_MP), "current matterport-frame allow");
  assert.ok(out.includes(CURRENT_IFRAME_MP_GHOST), "current ghost allow");
});

// ── D. Preservation of presentation-specific content ─────────────────────────
test("D1 — relative assets + Live-Guide chrome + protected globals preserved byte-identical", () => {
  const out = boot(FIX).html;
  for (const asset of ["assets/branding/069c85f7.webp", "assets/branding/5bc702a3.webp"]) {
    assert.equal((FIX.split(asset).length - 1), (out.split(asset).length - 1), `asset ${asset} count preserved`);
  }
  assert.ok(out.includes('id="drawer-live-guide"'), "Live-Guide chrome preserved");
  assert.ok(out.includes("window.__PROTECTED_BLOB__"), "protected globals preserved");
  assert.ok(out.includes('id="lg-audio"') && out.includes('id="ltcd-live-guide-slot"'), "dependency chrome preserved");
});

test("D2 — preserved outer __configReady catch wrapper is byte-identical", () => {
  const out = boot(FIX).html;
  // The OUTER glue catch is the LAST `}).catch(...)` (an earlier one lives in
  // the preserved safety bootstrap before the mutated regions).
  const tail = (s) => s.slice(s.lastIndexOf("}).catch(function(err){"));
  assert.equal(tail(FIX), tail(out), "everything from the outer catch onward is preserved");
});

// ── E. Glue boundary + parse ─────────────────────────────────────────────────
test("E1 — exactly one initLiveGuide IIFE after bootstrap", () => {
  const out = boot(FIX).html;
  assert.equal(out.split("(function initLiveGuide(){").length - 1, 1);
});

test("E2 — glue END sentinel immediately precedes the preserved outer catch", () => {
  const out = boot(FIX).html;
  const end = "// f3d:runtime-js:glue END";
  const at = out.indexOf(end);
  assert.ok(at !== -1);
  assert.ok(out.startsWith("\n}).catch(function(err){", at + end.length), "outer wrapper intact after glue");
});

// ── F. Adversarial rejection (fail-closed) ───────────────────────────────────
test("F1 — missing anchor rejects", () => {
  const r = boot(FIX.replace(PEERJS_TAG, ""));
  assert.equal(r.outcome, "rejected");
  assert.equal(r.code, "legacy_profile_unmatched");
});

test("F2 — duplicate anchor rejects", () => {
  const r = boot(FIX.replace(PEERJS_TAG, PEERJS_TAG + "\n" + PEERJS_TAG));
  assert.equal(r.outcome, "rejected");
});

test("F3 — altered anchor rejects", () => {
  const r = boot(FIX.replace(REGION_ANCHORS.kernel.start, "// altered kernel banner"));
  assert.equal(r.outcome, "rejected");
});

test("F4 — reordered anchors reject (peerjs moved after markup)", () => {
  const noPeer = FIX.replace(PEERJS_TAG, "");
  const at = noPeer.indexOf(REGION_ANCHORS.markup.afterToken) + REGION_ANCHORS.markup.afterToken.length;
  const reordered = noPeer.slice(0, at) + "\n" + PEERJS_TAG + noPeer.slice(at);
  const r = boot(reordered);
  assert.equal(r.outcome, "rejected");
});

test("F5 — ambiguous (duplicated css start) rejects", () => {
  const r = boot(FIX.replace(REGION_ANCHORS.css.start, REGION_ANCHORS.css.start + "\n/* x */\n" + REGION_ANCHORS.css.start));
  assert.equal(r.outcome, "rejected");
});

test("F6 — a current (already-bootstrapped) package is NOT a legacy profile (no-op/reject)", () => {
  const out = boot(FIX).html;
  const r = boot(out);
  assert.equal(r.outcome, "rejected");
  assert.equal(r.code, "legacy_profile_unmatched");
});

test("F7 — versioned 2.1.0 / 2.2.0 packages are not the legacy profile", () => {
  assert.equal(boot(FIX_210).outcome, "rejected");
  assert.equal(boot(FIX_220).outcome, "rejected");
  // and the current inspector still classifies them as patchable (no regression)
  assert.equal(inspectPresentationHtml(FIX_210).outcome, "patchable");
});

test("F8 — random / invalid input rejects", () => {
  assert.equal(boot("<html>not a presentation</html>").outcome, "rejected");
  assert.equal(boot("").outcome, "rejected");
});

test("F9 — non-string input is a controlled rejection", () => {
  const r = boot(12345);
  assert.equal(r.outcome, "rejected");
  assert.equal(r.code, "not_a_string");
  assert.equal(r.html, null);
});

test("F10 — missing/invalid runtime sources fail closed", () => {
  // Call the adapter directly (the `boot` helper defaults undefined → valid).
  for (const bad of [undefined, {}, { liveSessionJs: "", annoInputJs: "" }, { liveSessionJs: 1, annoInputJs: 2 }]) {
    const r = bootstrapLegacyPresentation(FIX, bad);
    assert.equal(r.outcome, "rejected");
    assert.equal(r.code, "runtime_sources_invalid");
    assert.equal(r.html, null);
  }
});

// ── G/H. Determinism + idempotency ───────────────────────────────────────────
test("G1 — deterministic: identical output across runs", () => {
  assert.equal(sha(boot(FIX).html), sha(boot(FIX).html));
});

test("H1 — re-bootstrapping the output is a no-op (rejected: already current)", () => {
  const once = boot(FIX).html;
  const twice = boot(once);
  assert.equal(twice.outcome, "rejected");
  // and the already-current output is a no-op under the normal current patcher path
  assert.equal(inspectPresentationHtml(once).outcome, "already_current");
});

// ── K. Parity (no drift from the generator) ──────────────────────────────────
test("K1 — bootstrap iframe tags match the current generator", () => {
  const gen = read("src", "lib", "portal.functions.ts");
  assert.ok(gen.includes(CURRENT_IFRAME_MP), "matterport-frame tag parity");
  assert.ok(gen.includes(CURRENT_IFRAME_MP_GHOST), "ghost tag parity");
});

test("K2 — inserted metas are exactly buildRuntimeMetaTags('builder')", () => {
  const out = boot(FIX).html;
  const block = "\n" + buildRuntimeMetaTags("builder");
  const anchorAt = out.indexOf(META_INSERT_ANCHOR);
  assert.ok(out.startsWith(block, anchorAt + META_INSERT_ANCHOR.length), "metas inserted verbatim at the head anchor");
});

// ── L. Dependency closure verifies DEFINITIONS in preserved regions ───────────
// (PR #172 review finding 3: must verify exact helper definitions in preserved
//  regions, not helper-name occurrences globally.)
test("L1 — a required helper present only as call sites (no preserved definition) rejects", () => {
  // Neutralize the single preserved-chrome assignment, leaving only call sites
  // (`window.__closeLiveTour(...)`). A global name count would still pass; the
  // definition check must reject.
  const broken = FIX.replace("window.__closeLiveTour=", "window.__closeLiveTour /*def removed*/ ");
  assert.notEqual(broken, FIX, "fixture must contain the preserved assignment");
  const p = inspectLegacyProfile(broken);
  assert.equal(p.supported, false);
  assert.ok(
    p.reasons.some((r) => r.includes("window.__closeLiveTour") && /DEFINED in preserved/.test(r)),
    "rejects with a preserved-definition reason",
  );
});

test("L2 — a definition that lives INSIDE a mutation region does not satisfy closure", () => {
  // Remove the preserved definition, then plant a fake one inside the js:kernel
  // region (which the bootstrap replaces). Global occurrence > 0, but no preserved
  // definition exists → must reject.
  let t = FIX.replace("window.__setHudVisible=", "window.__setHudVisible /*moved*/ ");
  t = t.replace(REGION_ANCHORS.kernel.start, REGION_ANCHORS.kernel.start + "\nwindow.__setHudVisible=function(){};");
  const p = inspectLegacyProfile(t);
  assert.equal(p.supported, false);
  assert.ok(p.reasons.some((r) => r.includes("window.__setHudVisible") && /DEFINED in preserved/.test(r)));
});

test("L3 — __lgOnPropertyChange is supplied by the replacement glue, not required of preserved chrome", () => {
  // The legacy file defines it INSIDE the js:glue region we replace; the new glue
  // defines it. It must NOT be a preserved-chrome requirement, and the output must
  // still define it (from the trusted runtime glue).
  assert.ok(!REQUIRED_WINDOW_HELPERS.includes("window.__lgOnPropertyChange"));
  assert.ok(/window\.__lgOnPropertyChange\s*=/.test(boot(FIX).html), "replacement glue defines it");
});

// ── P. Fixture privacy (no committed PII) ────────────────────────────────────
test("P1 — committed fixture carries no phone-shaped numbers on any surface", () => {
  // Structural assertion — never compares against a real value.
  assert.deepEqual(findPhones(FIX), []);
});
