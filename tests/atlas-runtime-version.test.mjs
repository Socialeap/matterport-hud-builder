#!/usr/bin/env node

// Tests for the runtime/package versioning single source
// (src/lib/atlas-runtime-version.mjs) and its splice points: the curated
// showcase manifest + <head> markers, and the pinned PeerJS CDN tag.
// Wiring assertions are text-level against the TS generators (same
// pattern as tests/atlas-live-tour.test.mjs) because those modules pull
// in Vite-only `?raw` imports that node:test cannot resolve.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  ATLAS_PACKAGE_SCHEMA,
  ATLAS_RUNTIME_VERSION,
  ATLAS_RUNTIME_CAPABILITIES,
  ATLAS_KNOWN_CAPABILITIES,
  buildRuntimeManifestFields,
  buildRuntimeMetaTags,
} from "../src/lib/atlas-runtime-version.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(__dirname, "..", ...p), "utf8");

// ── 1. Version constants are well-formed ─────────────────────────────────
test("package schema is an integer >= 2 and runtime version is strict semver", () => {
  assert.ok(Number.isInteger(ATLAS_PACKAGE_SCHEMA), "schema must be an integer");
  assert.ok(ATLAS_PACKAGE_SCHEMA >= 2, "schema 2 introduced the versioned manifest");
  assert.match(
    ATLAS_RUNTIME_VERSION,
    /^\d+\.\d+\.\d+$/,
    "runtime_version must be plain x.y.z semver (the Upgrade Center compares it)",
  );
});

// ── 2. Capability acceptance-gating invariants ───────────────────────────
test("published capabilities are a subset of the known registry (no typo-minting)", () => {
  assert.ok(Array.isArray(ATLAS_RUNTIME_CAPABILITIES));
  for (const cap of ATLAS_RUNTIME_CAPABILITIES) {
    assert.ok(
      ATLAS_KNOWN_CAPABILITIES.includes(cap),
      `unknown capability published: ${cap}`,
    );
  }
  assert.equal(
    new Set(ATLAS_RUNTIME_CAPABILITIES).size,
    ATLAS_RUNTIME_CAPABILITIES.length,
    "capabilities must not contain duplicates",
  );
});

test("the known-capability registry covers exactly the three planned mobile capabilities", () => {
  assert.deepEqual(
    [...ATLAS_KNOWN_CAPABILITIES].sort(),
    ["mobile_annotations_v2", "mobile_view_sync_v2", "mobile_voice_v2"],
  );
});

// ── 3. Manifest fields builder ───────────────────────────────────────────
test("buildRuntimeManifestFields returns the three fields with a defensive copy", () => {
  const fields = buildRuntimeManifestFields();
  assert.equal(fields.package_schema, ATLAS_PACKAGE_SCHEMA);
  assert.equal(fields.runtime_version, ATLAS_RUNTIME_VERSION);
  assert.deepEqual(fields.capabilities, ATLAS_RUNTIME_CAPABILITIES);
  fields.capabilities.push("mutated");
  assert.ok(
    !ATLAS_RUNTIME_CAPABILITIES.includes("mutated"),
    "mutating the returned array must not touch the source constant",
  );
});

// ── 4. HTML meta markers ─────────────────────────────────────────────────
test("buildRuntimeMetaTags emits all three self-identifying meta markers", () => {
  const tags = buildRuntimeMetaTags();
  assert.ok(
    tags.includes(`<meta name="f3d-package-schema" content="${ATLAS_PACKAGE_SCHEMA}" />`),
    "schema meta marker missing",
  );
  assert.ok(
    tags.includes(`<meta name="f3d-runtime" content="${ATLAS_RUNTIME_VERSION}" />`),
    "runtime meta marker missing",
  );
  // Emitted even while empty: the single-file upgrader must distinguish
  // "v2 package, no capabilities yet" from a pre-v2 package by the
  // marker's PRESENCE, and read delivered capabilities from index.html
  // alone (no manifest available on upload).
  assert.ok(
    tags.includes(`<meta name="f3d-capabilities" content="${ATLAS_RUNTIME_CAPABILITIES.join(",")}" />`),
    "capabilities meta marker missing (must exist even when empty)",
  );
});

test("capabilities meta marker and manifest field can never skew", () => {
  const metaContent = buildRuntimeMetaTags().match(
    /<meta name="f3d-capabilities" content="([^"]*)" \/>/,
  );
  assert.ok(metaContent, "capabilities marker must parse from the head block");
  const manifestCaps = buildRuntimeManifestFields().capabilities;
  assert.equal(
    metaContent[1],
    manifestCaps.join(","),
    "HTML marker and manifest must derive from the same constant",
  );
});

// ── 5. Splice-point wiring (text-level) ──────────────────────────────────
test("atlas-curation-server.ts splices the meta markers and manifest fields", () => {
  const src = read("src", "lib", "atlas-curation-server.ts");
  assert.ok(
    src.includes("buildRuntimeMetaTags()"),
    "renderCuratedHtml must splice buildRuntimeMetaTags() into <head>",
  );
  assert.ok(
    src.includes("...buildRuntimeManifestFields()"),
    "buildShowcaseFiles must spread buildRuntimeManifestFields() into the manifest",
  );
  assert.ok(
    src.includes(`from "./atlas-runtime-version.mjs"`),
    "generator must import from the single version source",
  );
});

// ── 6. PeerJS CDN tag is pinned with SRI ─────────────────────────────────
test("the PeerJS tag is pinned to an exact version with an SRI integrity hash", () => {
  const src = read("src", "lib", "atlas-live-tour.ts");
  const tagMatch = src.match(
    /https:\/\/unpkg\.com\/peerjs@(\d+\.\d+\.\d+)\/dist\/peerjs\.min\.js/,
  );
  assert.ok(tagMatch, "PeerJS src must pin an exact x.y.z version (no floating @1.5)");
  assert.ok(
    !src.includes("peerjs@1.5/dist"),
    "floating @1.5 tag must be gone",
  );
  assert.match(
    src,
    /integrity="sha384-[A-Za-z0-9+/=]{64}"/,
    "PeerJS tag must carry a sha384 SRI hash",
  );
  assert.ok(
    src.includes('crossorigin="anonymous"'),
    "SRI requires crossorigin=anonymous on a CDN script",
  );
});
