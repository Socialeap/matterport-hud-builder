#!/usr/bin/env node
//
// Produce a sanitized, realistic `builder-may2026-f8f68f0` fixture from a real
// Builder export, for committed tests. Redacts ALL secrets / personal data by
// STRUCTURAL pattern (this committed script hardcodes NO real tokens, blobs,
// names, or model ids); additional literal redactions may be passed as argv
// (call-time only, never committed). The runtime regions the bootstrap replaces
// are left intact for realism — they are open runtime code, not secrets.
//
// Self-validating: the output must still match the legacy profile, bootstrap to
// already_current, and contain no residual secret patterns or provided literals.
//
// Usage:
//   node scripts/sanitize-legacy-fixture.mjs <input.html> <output.html> [literal-to-redact ...]
//
// The real input file is NEVER modified and its path is never committed.

import { readFileSync, writeFileSync } from "node:fs";
import { inspectLegacyProfile } from "../src/lib/presentation-legacy-profile.mjs";
import { bootstrapLegacyPresentation } from "../src/lib/presentation-legacy-bootstrap.mjs";
import { stripExports } from "../src/lib/portal/ask-runtime-transformer.mjs";
import { findPhones, redactPhones, PHONE_SENTINEL } from "./lib/redact-phones.mjs";
import { assertDistinctOutputPath } from "./lib/safe-output-path.mjs";

const [inPath, outPath, ...literals] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error("usage: node scripts/sanitize-legacy-fixture.mjs <input.html> <output.html> [literal ...]");
  process.exit(2);
}

// Source protection: never let the output alias the real input (same/normalized/
// resolved path, symlink, hardlink, symlinked parent) — validate before reading.
let safeOut;
try {
  safeOut = assertDistinctOutputPath(inPath, outPath);
} catch (err) {
  console.error(`SANITIZE FAILED: refusing output path (${err.code}): ${err.message}`);
  process.exit(2);
}

let h = readFileSync(inPath, "utf8");
const before = h.length;

// Placeholder preamble = base64 of a minimal, non-identifying config.
const PLACEHOLDER_PREAMBLE = Buffer.from(JSON.stringify({ brandName: "Demo Studio" }), "utf8").toString("base64");

// Structural redactions (no real values hardcoded).
const redactions = [
  // Inlined data scripts (whole-script bodies) → minimal placeholders.
  [/<script>window\.__QA_DATABASE__=[\s\S]*?<\/script>/g,
    '<script>window.__QA_DATABASE__=[{"id":"qa-0","question":"Demo question?","answer":"Demo answer.","embedding":[0,0,0]}];</script>'],
  // Any long base64 string literal (preamble / raw config / inlined blob, in
  // either the protected or unprotected bootstrap path) → placeholder.
  [/"[A-Za-z0-9+/]{120,}={0,2}"/g, `"${PLACEHOLDER_PREAMBLE}"`],
  [/window\.__PRESENTATION_TOKEN__="[^"]*"/g, 'window.__PRESENTATION_TOKEN__="demo-token.demo-signature"'],
  [/window\.__SAVED_MODEL_ID__="[^"]*"/g, 'window.__SAVED_MODEL_ID__="00000000-0000-0000-0000-000000000000"'],
  [/window\.__SYNTHESIS_URL__="[^"]*"/g, 'window.__SYNTHESIS_URL__="https://example.com/functions/v1/synth"'],
  [/window\.__PROPERTY_EXTRACTIONS__=\{[\s\S]*?\};/g, "window.__PROPERTY_EXTRACTIONS__={};"],
  [/window\.__CUSTOM_QAS__=\{[\s\S]*?\};/g, "window.__CUSTOM_QAS__={};"],
  // Analytics id.
  [/UA-\d{4,}-\d+/g, "UA-000000000-0"],
  // Emails. (Telephone numbers — visible text, JS/config values, attributes, and
  // tel: URLs — are handled structurally by redactPhones below.)
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "demo@example.com"],
  // External identifying hrefs in the social pills → example.com (relative asset refs kept).
  [/href="https?:\/\/[^"]*"([^>]*class="social-pill")/g, 'href="https://example.com/"$1'],
  // Free-text element PII (brand / agent / welcome / title).
  [/<title>[^<]*<\/title>/g, "<title>Demo Property</title>"],
  [/(<div id="hud-brand">)[^<]*(<\/div>)/g, "$1Demo Studio$2"],
  [/(<div id="ltcd-brand">)[^<]*(<\/div>)/g, "$1Demo Studio$2"],
  [/(<div id="hud-prop-loc">)[^<]*(<\/div>)/g, "$1$2"],
  [/(<div class="drawer-agent-name">)[^<]*(<\/div>)/g, "$1Demo Agent$2"],
  [/(<div class="drawer-agent-role">)[^<]*(<\/div>)/g, "$1Demo Role$2"],
  [/(<div class="drawer-welcome"><p>)[\s\S]*?(<\/p><\/div>)/g, "$1Welcome to this demo presentation.$2"],
  [/(<h1>)[^<]*(<\/h1>)/g, "$1Demo Studio$2"],
  [/(<div class="gate-subtitle">)[^<]*(<\/div>)/g, "$1Demo Property$2"],
];
for (const [re, rep] of redactions) h = h.replace(re, rep);
// Phone numbers everywhere (visible text, JS/config, attributes, tel: URLs).
h = redactPhones(h);
// Call-time literal redactions (PII strings passed by the operator; not committed).
for (const lit of literals) {
  if (lit && lit.length > 0) h = h.split(lit).join("REDACTED");
}

// ── Validation (fail-closed) ────────────────────────────────────────────────
const fail = (msg) => { console.error("SANITIZE FAILED:", msg); process.exit(1); };

// 1. Still the supported profile.
const prof = inspectLegacyProfile(h);
if (!prof.supported) fail("output no longer matches the legacy profile: " + prof.reasons.join(" || "));

// 2. Still bootstraps to already_current.
const rs = {
  liveSessionJs: stripExports(readFileSync("src/lib/portal/live-session.mjs", "utf8")),
  annoInputJs: stripExports(readFileSync("src/lib/portal/anno-input.mjs", "utf8")),
};
const boot = bootstrapLegacyPresentation(h, rs);
if (boot.outcome !== "bootstrapped" || boot.postInspection.outcome !== "already_current") {
  fail("output no longer bootstraps to already_current: " + boot.code + " " + boot.message);
}

// 3. No residual secret patterns.
const residual = [
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_-]{6,}/g, "token-like uuid.signature"],
  [/[A-Za-z0-9+/]{120,}={0,2}/g, "long base64 blob"],
  [/[a-z0-9]+\.supabase\.co/g, "supabase host"],
];
for (const [re, label] of residual) {
  const m = h.match(re);
  if (m) fail(`residual ${label} (${m.length}) e.g. ${JSON.stringify(m[0].slice(0, 24))}`);
}
// 4. None of the provided literals remain.
for (const lit of literals) {
  if (lit && lit.length > 0 && h.includes(lit)) fail(`provided literal still present: ${JSON.stringify(lit.slice(0, 24))}`);
}
// 5. Emails reduced to the placeholder only.
const emails = (h.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).filter((e) => e !== "demo@example.com");
if (emails.length) fail(`residual emails: ${emails.slice(0, 3).join(", ")}`);
// 6. No residual phone numbers anywhere (report counts only, never the values).
const phones = findPhones(h);
if (phones.length) fail(`residual phone-shaped runs: ${phones.length} (values withheld)`);

writeFileSync(safeOut, h);
console.log(`sanitized ${before} → ${h.length} bytes → ${outPath}`);
console.log(`profile: ${prof.profileId} | bootstrap: ${boot.outcome} → ${boot.postInspection.outcome} | caps: ${boot.capabilities.join(",")}`);
