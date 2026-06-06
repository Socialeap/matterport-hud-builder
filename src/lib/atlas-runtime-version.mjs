// Atlas package/runtime versioning — the single source of truth for
// generated showcase packages, their manifests, and (later) the Upgrade
// Center's outdated-package detection.
//
// Plain .mjs on the same dual-import pattern as ask-runtime-transformer:
// imported as TS by the server-side generators via the sibling .d.mts,
// and imported directly by the node:test suites. It is NOT injected into
// generated HTML — only its VALUES travel (as manifest fields and <meta>
// markers), so normal module syntax is fine here.
//
// Bump rules:
//   ATLAS_PACKAGE_SCHEMA  — structural shape of the package folder
//     (file set, manifest layout). Bump only on breaking layout changes.
//   ATLAS_RUNTIME_VERSION — semver of the inlined live-tour runtime
//     (controller + glue + CSS). Bump on every behavior change; the
//     Upgrade Center compares this value to decide "outdated".
const ATLAS_PACKAGE_SCHEMA = 2;
const ATLAS_RUNTIME_VERSION = "2.0.0";

// Capability strings are ACCEPTANCE-GATED (decision 2026-06-06): a
// capability may be listed here only after its phase passes acceptance
// testing on real devices. Planned, in gating order:
//   "mobile_annotations_v2" — after Phase 1A (Atlas surface) passes on
//     real iPhone/iPad AND Phase 1B integrates the shared annotation
//     module into the standalone Builder generator (portal.functions.ts).
//     The capability describes presentations generally, so Atlas-only
//     hardening must not advertise it (Codex review, 2026-06-06).
//   "mobile_voice_v2"       — after Phase 2 passes
//   "mobile_view_sync_v2"   — only after a chosen sync implementation
//     passes real-device acceptance (the clipboard/manual fallback does
//     NOT qualify as seamless mobile view sync).
// Ships empty until then: generated packages must never advertise a
// capability that has not been delivered.
const ATLAS_RUNTIME_CAPABILITIES = [];

// Every capability string that may ever appear in ATLAS_RUNTIME_CAPABILITIES.
// Tests assert the published list stays a subset of this registry so a typo
// can't silently mint a new capability.
const ATLAS_KNOWN_CAPABILITIES = [
  "mobile_annotations_v2",
  "mobile_voice_v2",
  "mobile_view_sync_v2",
];

// Manifest fields spliced into atlas-manifest.json by buildShowcaseFiles().
function buildRuntimeManifestFields() {
  return {
    package_schema: ATLAS_PACKAGE_SCHEMA,
    runtime_version: ATLAS_RUNTIME_VERSION,
    capabilities: ATLAS_RUNTIME_CAPABILITIES.slice(),
  };
}

// Self-identifying <meta> markers for the generated index.html <head>.
// Lets a package be classified (schema + runtime version + delivered
// capabilities) from the HTML alone, without its manifest — the
// single-file upgrader's primary detection input. The capabilities
// marker is emitted even while empty so its ABSENCE distinguishes
// pre-v2 packages from a v2 package with no capabilities yet; marker
// and manifest derive from the same constant, so they can never skew.
function buildRuntimeMetaTags() {
  return (
    `<meta name="f3d-package-schema" content="${ATLAS_PACKAGE_SCHEMA}" />\n` +
    `<meta name="f3d-runtime" content="${ATLAS_RUNTIME_VERSION}" />\n` +
    `<meta name="f3d-capabilities" content="${ATLAS_RUNTIME_CAPABILITIES.join(",")}" />`
  );
}

export {
  ATLAS_PACKAGE_SCHEMA,
  ATLAS_RUNTIME_VERSION,
  ATLAS_RUNTIME_CAPABILITIES,
  ATLAS_KNOWN_CAPABILITIES,
  buildRuntimeManifestFields,
  buildRuntimeMetaTags,
};
