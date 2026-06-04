#!/usr/bin/env node

// Source-level guard for the Atlas "Explore Together" voice + Sync Your View
// permissions chain. The flow only works if the right Permissions-Policy
// features are delegated down two iframe hops:
//
//   Atlas page → modal iframe (curated showcase) → Matterport iframe
//
//   1. The modal iframe (src/routes/atlas.tsx) must grant the embedded
//      showcase microphone (getUserMedia voice) + clipboard-read/write
//      (Matterport "Copy to clipboard" → parent sync).
//   2. The nested Matterport iframe (src/lib/atlas-curation-server.ts) must
//      grant clipboard-write so its in-tour "Copy to clipboard" works.
//
// Asserted at source level because both iframes are produced inside React /
// template-literal code that the Vite "?raw" + "@/" alias pipeline makes
// awkward to import directly under node --test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const ATLAS_ROUTE = readFileSync(path.join(root, "src", "routes", "atlas.tsx"), "utf8");
const CURATION_SERVER = readFileSync(
  path.join(root, "src", "lib", "atlas-curation-server.ts"),
  "utf8",
);

// Pull every allow="..." value out of a source file.
function allowValues(src) {
  const re = /allow="([^"]*)"/g;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}
function tokens(value) {
  return value
    .split(";")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

test("Atlas modal iframe grants microphone + clipboard read/write for voice & sync", () => {
  const values = allowValues(ATLAS_ROUTE);
  assert.ok(values.length >= 1, "expected at least one allow= attribute in atlas.tsx");
  const found = values.find((v) => {
    const t = tokens(v);
    return (
      t.includes("microphone") &&
      t.includes("clipboard-read") &&
      t.includes("clipboard-write")
    );
  });
  assert.ok(
    found,
    `no Atlas iframe allow grants microphone + clipboard-read + clipboard-write; saw: ${JSON.stringify(values)}`,
  );
  const t = tokens(found);
  for (const needed of [
    "microphone",
    "clipboard-read",
    "clipboard-write",
    "autoplay",
    "fullscreen",
    "accelerometer",
    "gyroscope",
    "xr-spatial-tracking",
  ]) {
    assert.ok(t.includes(needed), `Atlas modal iframe allow missing: ${needed}`);
  }
});

test("curated Matterport iframe grants clipboard-write (Copy to clipboard sync)", () => {
  const values = allowValues(CURATION_SERVER);
  const found = values.find((v) => tokens(v).includes("clipboard-write"));
  assert.ok(
    found,
    `curated Matterport iframe allow must include clipboard-write; saw: ${JSON.stringify(values)}`,
  );
  const t = tokens(found);
  for (const needed of [
    "xr-spatial-tracking",
    "gyroscope",
    "accelerometer",
    "fullscreen",
    "autoplay",
    "clipboard-write",
  ]) {
    assert.ok(t.includes(needed), `curated Matterport iframe allow missing: ${needed}`);
  }
});
