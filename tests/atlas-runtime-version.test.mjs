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
  GENERATED_FAMILIES,
  PRESENTATION_FAMILIES,
  F3D_PACKAGE_FAMILY_DEFAULT,
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

test("the recognized-historical registry keeps the retired mobile capability identifiers", () => {
  // Desktop-only decision (2026-06-09): these are never advertised again,
  // but the Upgrade Center inspector must still parse them out of older /
  // experimental packages, so they stay REGISTERED.
  assert.deepEqual(
    [...ATLAS_KNOWN_CAPABILITIES].sort(),
    ["mobile_annotations_v2", "mobile_view_sync_v2", "mobile_voice_v2"],
  );
});

test("desktop-only policy: runtime is >= 2.1.0 and no mobile capability is advertised", () => {
  const [maj, min] = ATLAS_RUNTIME_VERSION.split(".").map(Number);
  assert.ok(
    maj > 2 || (maj === 2 && min >= 1),
    "the desktop-only gate + lazy PeerJS shipped in 2.1.0 — the version must never regress below it",
  );
  assert.deepEqual(
    ATLAS_RUNTIME_CAPABILITIES,
    [],
    "current generators advertise no mobile collaboration capability",
  );
});

// ── 3. Manifest fields builder ───────────────────────────────────────────
test("buildRuntimeManifestFields returns the four fields with a defensive copy", () => {
  const fields = buildRuntimeManifestFields("atlas");
  assert.equal(fields.package_schema, ATLAS_PACKAGE_SCHEMA);
  assert.equal(fields.runtime_version, ATLAS_RUNTIME_VERSION);
  assert.equal(fields.package_family, "atlas");
  assert.deepEqual(fields.capabilities, ATLAS_RUNTIME_CAPABILITIES);
  fields.capabilities.push("mutated");
  assert.ok(
    !ATLAS_RUNTIME_CAPABILITIES.includes("mutated"),
    "mutating the returned array must not touch the source constant",
  );
});

// ── 3b. Family registry + normalization ──────────────────────────────────
test("the family registries are correct; legacy is recognized but NOT generated", () => {
  assert.deepEqual([...GENERATED_FAMILIES].sort(), ["atlas", "builder"]);
  assert.deepEqual([...PRESENTATION_FAMILIES].sort(), ["atlas", "builder", "legacy"]);
  assert.ok(GENERATED_FAMILIES.includes(F3D_PACKAGE_FAMILY_DEFAULT));
  assert.ok(!GENERATED_FAMILIES.includes("legacy"), "legacy is a U1 classification, not generated");
});

test("buildRuntimeManifestFields fails closed on explicit non-generated families", () => {
  assert.equal(buildRuntimeManifestFields("builder").package_family, "builder");
  assert.equal(buildRuntimeManifestFields().package_family, F3D_PACKAGE_FAMILY_DEFAULT); // omitted → atlas
  assert.throws(() => buildRuntimeManifestFields("legacy"), /must be one of atlas\|builder/);
  assert.throws(() => buildRuntimeManifestFields("bogus"));
  assert.throws(() => buildRuntimeManifestFields(""));
  assert.throws(() => buildRuntimeManifestFields(null));
});

// ── 4. HTML meta markers ─────────────────────────────────────────────────
test("buildRuntimeMetaTags emits all four self-identifying meta markers", () => {
  const tags = buildRuntimeMetaTags("atlas");
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
  assert.ok(
    tags.includes(`<meta name="f3d-package-family" content="atlas" />`),
    "package-family meta marker missing",
  );
});

test("the package-family marker reflects the family argument and fails closed", () => {
  assert.ok(
    buildRuntimeMetaTags("builder").includes(`<meta name="f3d-package-family" content="builder" />`),
    "builder family must emit family=builder",
  );
  // Omitted family (zero-arg Atlas call sites) defaults to atlas.
  assert.ok(
    buildRuntimeMetaTags().includes(`<meta name="f3d-package-family" content="atlas" />`),
    "omitted family must default to family=atlas (back-compat)",
  );
  // Any EXPLICIT non-generated family throws — no silent bogus marker, and
  // "legacy" is a U1 inspection classification, not a generated family.
  assert.throws(() => buildRuntimeMetaTags("legacy"), /must be one of atlas\|builder/);
  assert.throws(() => buildRuntimeMetaTags("bogus"));
  assert.throws(() => buildRuntimeMetaTags(""));
});

test("capabilities meta marker and manifest field can never skew", () => {
  const metaContent = buildRuntimeMetaTags("atlas").match(
    /<meta name="f3d-capabilities" content="([^"]*)" \/>/,
  );
  assert.ok(metaContent, "capabilities marker must parse from the head block");
  const manifestCaps = buildRuntimeManifestFields("atlas").capabilities;
  assert.equal(
    metaContent[1],
    manifestCaps.join(","),
    "HTML marker and manifest must derive from the same constant",
  );
});

test("package-family meta marker and manifest field can never skew", () => {
  for (const fam of ["atlas", "builder"]) {
    const meta = buildRuntimeMetaTags(fam).match(
      /<meta name="f3d-package-family" content="([^"]*)" \/>/,
    );
    assert.ok(meta, `family marker must parse for ${fam}`);
    assert.equal(
      meta[1],
      buildRuntimeManifestFields(fam).package_family,
      "HTML family marker and manifest family must derive from the same arg",
    );
  }
});

// ── 5. Splice-point wiring (text-level) ──────────────────────────────────
test("atlas-curation-server.ts splices the meta markers and manifest fields", () => {
  const src = read("src", "lib", "atlas-curation-server.ts");
  assert.ok(
    src.includes(`buildRuntimeMetaTags("atlas")`),
    'renderCuratedHtml must splice buildRuntimeMetaTags("atlas") into <head>',
  );
  assert.ok(
    src.includes(`...buildRuntimeManifestFields("atlas")`),
    'buildShowcaseFiles must spread buildRuntimeManifestFields("atlas") into the manifest',
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

test("both families ship the PeerJS dependency INERT (lazy desktop-only load)", () => {
  for (const file of [
    ["src", "lib", "atlas-live-tour.ts"],
    ["src", "lib", "portal.functions.ts"],
  ]) {
    const src = read(...file);
    const name = file[file.length - 1];
    assert.ok(
      src.includes('id="f3d-peerjs-loader"'),
      `${name}: dep span must carry the f3d-peerjs-loader config`,
    );
    assert.ok(
      src.includes('type="text/plain"'),
      `${name}: the loader config must be inert (type=text/plain)`,
    );
    assert.ok(
      !/<script[^>]*\ssrc="[^"]*peerjs/i.test(src),
      `${name}: no executable peerjs <script src> may exist (lazy-load only)`,
    );
  }
});
