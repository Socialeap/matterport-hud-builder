// Presentation package/runtime versioning — the single source of truth for
// ALL generated Frontiers3D packages (Atlas curated showcases AND Builder
// portal exports), their manifests, and the Upgrade Center's
// outdated-package detection + family routing.
//
// Kept on the historical `atlas-runtime-version.mjs` filename: the values
// are shared across families, not Atlas-specific, and the public builders
// below take a `family` argument. A rename to presentation-runtime-version
// .mjs would be a separate no-behavior-change commit (it churns the sibling
// .d.mts, the import-string test, and node:test imports for zero benefit).
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
// 2.0.3: emit `f3d:interaction-active` to the parent Atlas app on Draw /
// Focus Rope / pointer selection and on live-session connect, so the
// embedding modal can drop native Device fullscreen into Maximize on iPad
// (iPadOS swipe-exit collapses native fullscreen mid-draw). Parent half
// shipped in the app shell; this emit activates only after regeneration.
// 2.0.2: P0 iPad connect-crash hardening — wrapper gesture CSS made
// conditional on tool-active (Matterport navigation untouched
// otherwise); lazy annotation-canvas allocation (nothing allocated at
// PIN connect); iOS DPR cap 1.5 + backing-pixel budget; deferred voice
// on iOS (no auto getUserMedia/AudioContext/media call — explicit
// Enable voice gesture); sessionStorage diagnostic milestones.
// 2.0.1: iOS clipboard isolation — ambient readText() disabled on
// iOS/iPadOS WebKit (Paste-callout interruption fix) + stage-scoped
// WebKit gesture defenses.
const ATLAS_RUNTIME_VERSION = "2.0.3";

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

// Which generator/adapter produced a package. Travels as the
// `f3d-package-family` <meta> marker and the `package_family` manifest
// field so the Upgrade Center can route a package to the correct migration
// adapter from the HTML alone:
//   "atlas"   — curated showcase (atlas-curation-server + atlas-live-tour)
//   "builder" — portal presentation export (portal.functions.ts)
//   "legacy"  — recognized pre-marker package (assigned by the upgrader on
//               detection; never emitted by a current generator)
// Families a CURRENT generator may stamp into a package.
const GENERATED_FAMILIES = ["atlas", "builder"];
// Every family the Upgrade Center recognizes. "legacy" is a future U1
// INSPECTION classification for pre-marker packages — it is NEVER emitted by
// a generator, so the builders below reject it as an explicit argument.
const PRESENTATION_FAMILIES = ["atlas", "builder", "legacy"];
const F3D_PACKAGE_FAMILY_DEFAULT = "atlas";
// Fail closed. An OMITTED family defaults to atlas (back-compat with the
// zero-arg Atlas call sites). Any EXPLICIT value that is not a generated
// family — "", null, "legacy", or a typo — THROWS, so a generator can never
// silently stamp a bogus or non-generated family.
function _resolveGeneratedFamily(family) {
  if (family === undefined) return F3D_PACKAGE_FAMILY_DEFAULT;
  if (GENERATED_FAMILIES.indexOf(family) !== -1) return family;
  throw new Error(
    "f3d package family must be one of " +
      GENERATED_FAMILIES.join("|") +
      " (got " +
      JSON.stringify(family) +
      ")",
  );
}

// Manifest fields spliced into the package manifest by buildShowcaseFiles()
// (Atlas) and the Builder manifest object (portal.functions.ts).
function buildRuntimeManifestFields(family) {
  return {
    package_schema: ATLAS_PACKAGE_SCHEMA,
    runtime_version: ATLAS_RUNTIME_VERSION,
    capabilities: ATLAS_RUNTIME_CAPABILITIES.slice(),
    package_family: _resolveGeneratedFamily(family),
  };
}

// Self-identifying <meta> markers for the generated index.html <head>.
// Lets a package be classified (family + schema + runtime version +
// delivered capabilities) from the HTML alone, without its manifest — the
// single-file upgrader's primary detection input. The capabilities marker
// is emitted even while empty so its ABSENCE distinguishes pre-v2 packages
// from a v2 package with no capabilities yet; the family marker is appended
// last (additive — existing packages without it read as pre-family). All
// markers and the manifest derive from the same constants, so they can
// never skew.
function buildRuntimeMetaTags(family) {
  return (
    `<meta name="f3d-package-schema" content="${ATLAS_PACKAGE_SCHEMA}" />\n` +
    `<meta name="f3d-runtime" content="${ATLAS_RUNTIME_VERSION}" />\n` +
    `<meta name="f3d-capabilities" content="${ATLAS_RUNTIME_CAPABILITIES.join(",")}" />\n` +
    `<meta name="f3d-package-family" content="${_resolveGeneratedFamily(family)}" />`
  );
}

export {
  ATLAS_PACKAGE_SCHEMA,
  ATLAS_RUNTIME_VERSION,
  ATLAS_RUNTIME_CAPABILITIES,
  ATLAS_KNOWN_CAPABILITIES,
  GENERATED_FAMILIES,
  PRESENTATION_FAMILIES,
  F3D_PACKAGE_FAMILY_DEFAULT,
  buildRuntimeManifestFields,
  buildRuntimeMetaTags,
};
