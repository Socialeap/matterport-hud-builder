#!/usr/bin/env node
//
// Non-destructive local acceptance for the legacy bootstrap against a REAL
// presentation export. Reads the input read-only, runs the bootstrap entirely
// in memory, writes the result ONLY to a temporary path, re-inspects it,
// confirms the SHA-256 / already_current classification, and reports whether
// it is ready for manual browser testing. NEVER modifies the input.
//
// Usage:
//   node scripts/legacy-bootstrap-acceptance.mjs <input.html> [tempOut.html]
//
// The real input path is never committed.

import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { bootstrapLegacyPresentation } from "../src/lib/presentation-legacy-bootstrap.mjs";
import { inspectPresentationHtml } from "../src/lib/presentation-upgrade-inspector.mjs";
import { stripExports } from "../src/lib/portal/ask-runtime-transformer.mjs";
import { assertDistinctOutputPath } from "./lib/safe-output-path.mjs";

const inPath = process.argv[2];
const outPath = process.argv[3] || path.join(tmpdir(), "legacy-bootstrap-acceptance.html");
if (!inPath) {
  console.error("usage: node scripts/legacy-bootstrap-acceptance.mjs <input.html> [tempOut.html]");
  process.exit(2);
}

// Source protection: refuse any destination that could alias the input
// (same/normalized/resolved path, symlink, hardlink, or symlinked parent) BEFORE
// reading or writing — the real input is never overwritten.
let safeOut;
try {
  safeOut = assertDistinctOutputPath(inPath, outPath);
} catch (err) {
  console.error(`ACCEPTANCE: refusing output path (${err.code}): ${err.message}`);
  process.exit(2);
}

const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const input = readFileSync(inPath, "utf8"); // READ-ONLY

const runtimeSources = {
  liveSessionJs: stripExports(readFileSync("src/lib/portal/live-session.mjs", "utf8")),
  annoInputJs: stripExports(readFileSync("src/lib/portal/anno-input.mjs", "utf8")),
};

const result = bootstrapLegacyPresentation(input, runtimeSources);
console.log("profile:", result.profileId, "| outcome:", result.outcome, result.code ? `(${result.code})` : "");
console.log("message:", result.message);
if (result.outcome !== "bootstrapped") {
  console.error("ACCEPTANCE: bootstrap rejected — not ready.");
  process.exit(1);
}

const before = sha(input);
const after = sha(result.html);
console.log("branding:", JSON.stringify(result.branding));
console.log("capabilities:", result.capabilities.join(", "));
console.log("SHA-256 before:", before);
console.log("SHA-256 after :", after);

writeFileSync(safeOut, result.html); // TEMP output only — input untouched
const re = inspectPresentationHtml(readFileSync(safeOut, "utf8"));
const afterOnDisk = sha(readFileSync(safeOut, "utf8"));

const ok =
  re.outcome === "already_current" &&
  re.sentinels.valid === true &&
  re.runtimeVersion === result.postInspection.runtimeVersion &&
  afterOnDisk === after &&
  sha(readFileSync(inPath, "utf8")) === before; // input still identical

console.log("temp output:", safeOut);
console.log("re-inspect:", re.outcome, "| sentinels.valid:", re.sentinels.valid, "| runtime:", re.runtimeVersion);
console.log("temp-file sha matches in-memory after:", afterOnDisk === after);
console.log("input unchanged:", sha(readFileSync(inPath, "utf8")) === before);
console.log(ok ? "ACCEPTANCE: READY for manual browser testing (unlock + verify)." : "ACCEPTANCE: FAILED.");
process.exit(ok ? 0 : 1);
