// Presentation Upgrade Inspector (U1 / P1) — pure, read-only classification
// of a SINGLE uploaded `index.html` for the Presentation Upgrade Center.
//
// SCOPE (v1, approved 2026-06-11):
//   - Input is ONE file: the presentation's index.html, handled strictly as
//     INERT TEXT. This module never renders, executes, DOM-parses, iframes,
//     srcdoc-loads, or imports anything from the upload — string scans only.
//   - The only packages the future patcher may upgrade are Builder
//     packages at EXACTLY one of V1_PATCH_SOURCE_VERSIONS, carrying all
//     five `v=1 family=builder` runtime sentinels. Everything else fails
//     safely into a non-patchable outcome.
//   - A sibling `atlas-manifest.json` (when the package was downloaded as a
//     .zip) is OUTSIDE this single-file workflow: it is not required, not
//     parsed, and never claimed to be updated. Every report carries
//     MANIFEST_SCOPE_NOTE so the operator can see that limitation.
//
// The version/family single source of truth is atlas-runtime-version.mjs;
// this module must never hardcode a current version. Sentinel literals are
// pinned EXACTLY as portal.functions.ts emits them and are parity-tested
// against the generator source so the two can never skew.

import {
  ATLAS_PACKAGE_SCHEMA,
  ATLAS_RUNTIME_VERSION,
  ATLAS_RUNTIME_CAPABILITIES,
  ATLAS_KNOWN_CAPABILITIES,
} from "./atlas-runtime-version.mjs";

// ── Outcomes ──────────────────────────────────────────────────────────────
// patchable          — exact Builder V1_PATCH_SOURCE_VERSIONS package, all
//                      five sentinels valid → eligible for the P3 patcher.
// already_current    — valid Builder package already at the current runtime.
// future_version     — advertises a runtime/schema NEWER than this build
//                      understands; never downgrade, never guess.
// atlas_managed      — Atlas curated showcase; upgraded via its GitHub
//                      source repo + Netlify redeploy, never file-patched.
// legacy_unsupported — recognizably a 3DPS presentation, but from a
//                      generation v1 cannot deterministically patch
//                      (pre-marker, pre-family, or an older runtime
//                      outside the supported patch-source set) →
//                      regenerate from the Builder instead.
// invalid            — malformed, ambiguous, conflicting, tampered, or not
//                      a 3DPS presentation at all. Never patched.
const INSPECTION_OUTCOMES = [
  "patchable",
  "already_current",
  "future_version",
  "atlas_managed",
  "legacy_unsupported",
  "invalid",
];

// The ONLY runtime versions v1 accepts as a patch SOURCE. 2.1.0 and
// 2.2.0 share the identical five-span v=1 family=builder sentinel layout
// (and both shipped an empty capability set), so the same deterministic
// span replacement upgrades either to the current runtime. Anything
// older is legacy_unsupported (regenerate); anything newer than the
// current build is future_version.
const V1_PATCH_SOURCE_VERSIONS = Object.freeze(["2.1.0", "2.2.0"]);

// ── Mutation allowlist (contract for the future P3 patcher) ─────────────
// A patch may rewrite ONLY: the content between each of these five sentinel
// pairs (sentinel lines included), and the content attribute of these four
// <meta> markers. Every other byte of the document must survive the patch
// byte-identical — presentation config blocks (window.__PREAMBLE__ /
// __CONFIG__ / __PROPERTY_EXTRACTIONS__ / __QA_DATABASE__ /
// __PRESENTATION_TOKEN__ / __SAVED_MODEL_ID__ / __PROTECTED_*), branding
// chrome, gate markup, and all relative assets/… references included.
const BUILDER_RUNTIME_SPANS = ["css", "dep:peerjs", "markup", "js:kernel", "js:glue"];
const F3D_META_NAMES = [
  "f3d-package-schema",
  "f3d-runtime",
  "f3d-capabilities",
  "f3d-package-family",
];
const PATCH_MUTATION_ALLOWLIST = Object.freeze({
  spans: Object.freeze(BUILDER_RUNTIME_SPANS.slice()),
  metaNames: Object.freeze(F3D_META_NAMES.slice()),
});

const MANIFEST_SCOPE_NOTE =
  "Single-file workflow: only index.html is inspected/patched. If this " +
  "package was downloaded as a .zip it may carry a sibling " +
  "atlas-manifest.json; that file is outside this workflow and will keep " +
  "advertising the pre-patch runtime_version until the package is " +
  "regenerated.";

// ── Sentinel literals — EXACTLY as portal.functions.ts emits them ───────
// (parity-tested against the generator source; wrappers differ per span:
// CSS comment, HTML comment, JS line comment).
const BUILDER_SENTINEL_LITERALS = {
  css: {
    begin: "/* f3d:runtime-css BEGIN v=1 family=builder */",
    end: "/* f3d:runtime-css END */",
  },
  "dep:peerjs": {
    begin: "<!-- f3d:runtime-dep:peerjs BEGIN v=1 family=builder -->",
    end: "<!-- f3d:runtime-dep:peerjs END -->",
  },
  markup: {
    begin: "<!-- f3d:runtime-markup BEGIN v=1 family=builder -->",
    end: "<!-- f3d:runtime-markup END -->",
  },
  "js:kernel": {
    begin: "// f3d:runtime-js:kernel BEGIN v=1 family=builder",
    end: "// f3d:runtime-js:kernel END",
  },
  "js:glue": {
    begin: "// f3d:runtime-js:glue BEGIN v=1 family=builder",
    end: "// f3d:runtime-js:glue END",
  },
};
const SENTINEL_TOKEN = "f3d:runtime-";
// 5 BEGIN + 5 END — any other f3d:runtime- occurrence is foreign/tampered.
const EXPECTED_SENTINEL_TOKEN_COUNT = 10;

// Pre-marker 3DPS signatures: globals/ids every real legacy export carries.
// Two or more → recognizably ours (legacy_unsupported); fewer → not a 3DPS
// presentation (invalid). Signature presence is a plain substring scan.
const LEGACY_3DPS_SIGNATURES = [
  "window.__PREAMBLE__",
  "window.__CONFIG__",
  "window.__PROPERTY_EXTRACTIONS__",
  "window.__QA_DATABASE__",
  "window.__PRESENTATION_TOKEN__",
  "window.__SAVED_MODEL_ID__",
  "window.__SYNTHESIS_URL__",
  'id="matterport-frame"',
];

// ── Tiny strict helpers ──────────────────────────────────────────────────

function isStrictSemver(v) {
  return typeof v === "string" && /^\d+\.\d+\.\d+$/.test(v);
}

// -1 / 0 / 1 for strict x.y.z numeric comparison.
function semverCompare(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) return -1;
    if (pa[i] > pb[i]) return 1;
  }
  return 0;
}

function countOccurrences(haystack, needle) {
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

// Parse one f3d meta marker, STRICTLY in the format buildRuntimeMetaTags
// emits: <meta name="NAME" content="VALUE" />. Returns
// { values: string[], looseCount } — looseCount counts ANY appearance of
// the marker name so a reformatted/tampered marker is detected instead of
// silently ignored.
function parseMetaMarker(html, name) {
  const strict = new RegExp(`<meta name="${name}" content="([^"]*)" \\/>`, "g");
  const values = [];
  let m;
  while ((m = strict.exec(html)) !== null) values.push(m[1]);
  const looseCount = countOccurrences(html, `name="${name}"`);
  return { values, looseCount };
}

// Best-effort plaintext scan of relative asset references for the audit
// report. References inside base64-encoded config blocks are invisible to
// this scan — by design those blocks are preserved byte-for-byte, so the
// scan exists for reporting, not for correctness.
function scanRelativeAssets(html) {
  const re = /assets\/[A-Za-z0-9][A-Za-z0-9._/-]*/g;
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    seen.add(m[0]);
    if (seen.size >= 500) break; // report cap; never a parse failure
  }
  return Array.from(seen).sort();
}

// Locate + validate the five builder sentinel spans. Returns
// { valid, issues: string[], spans: [{name, beginStart, beginEnd,
//   endStart, endEnd}] } with character offsets (begin/end lines included
// in the would-be mutation range).
function validateBuilderSentinels(html) {
  const issues = [];
  const spans = [];

  const tokenCount = countOccurrences(html, SENTINEL_TOKEN);
  if (tokenCount !== EXPECTED_SENTINEL_TOKEN_COUNT) {
    issues.push(
      `expected exactly ${EXPECTED_SENTINEL_TOKEN_COUNT} f3d:runtime- sentinel markers, found ${tokenCount}`,
    );
  }

  let prevEnd = -1;
  for (const name of BUILDER_RUNTIME_SPANS) {
    const lit = BUILDER_SENTINEL_LITERALS[name];
    const beginCount = countOccurrences(html, lit.begin);
    const endCount = countOccurrences(html, lit.end);
    if (beginCount !== 1 || endCount !== 1) {
      issues.push(
        `span ${name}: expected exactly one BEGIN and one END (v=1 family=builder), found BEGIN×${beginCount} END×${endCount}`,
      );
      continue;
    }
    const beginStart = html.indexOf(lit.begin);
    const endStart = html.indexOf(lit.end);
    const beginEnd = beginStart + lit.begin.length;
    const endEnd = endStart + lit.end.length;
    if (endStart < beginEnd) {
      issues.push(`span ${name}: END appears before BEGIN`);
      continue;
    }
    if (beginStart < prevEnd) {
      issues.push(`span ${name}: out of canonical order (${BUILDER_RUNTIME_SPANS.join(" → ")})`);
      continue;
    }
    prevEnd = endEnd;
    spans.push({ name, beginStart, beginEnd, endStart, endEnd });
  }

  return { valid: issues.length === 0 && spans.length === BUILDER_RUNTIME_SPANS.length, issues, spans };
}

// ── Inspector ────────────────────────────────────────────────────────────
// inspectPresentationHtml(html) → report. Pure and deterministic: same
// input, same report; no I/O, no DOM, no execution, no Date/random.
function inspectPresentationHtml(html) {
  const report = {
    outcome: "invalid",
    reasons: [],
    family: null,
    packageSchema: null,
    runtimeVersion: null,
    currentRuntimeVersion: ATLAS_RUNTIME_VERSION,
    v1PatchSourceVersions: V1_PATCH_SOURCE_VERSIONS.slice(),
    capabilities: null,
    protected: false,
    assets: [],
    sentinels: { valid: false, issues: [], spans: [] },
    manifestNote: MANIFEST_SCOPE_NOTE,
  };
  const fail = (reason) => {
    report.outcome = "invalid";
    report.reasons.push(reason);
    return report;
  };

  if (typeof html !== "string") return fail("input is not a string");
  if (html.trim().length === 0) return fail("input is empty");

  report.protected =
    html.includes("window.__PROTECTED__=true") || html.includes("window.__PROTECTED_BLOB__");
  report.assets = scanRelativeAssets(html);

  // 1. Meta markers — strict format, no duplicates, no malformed variants.
  const meta = {};
  for (const name of F3D_META_NAMES) {
    const { values, looseCount } = parseMetaMarker(html, name);
    if (values.length !== looseCount) {
      return fail(`marker ${name} present but not in the generated format (tampered or reformatted)`);
    }
    if (values.length > 1) {
      return fail(`marker ${name} appears ${values.length} times (ambiguous)`);
    }
    meta[name] = values.length === 1 ? values[0] : null;
  }
  const presentCount = F3D_META_NAMES.filter((n) => meta[n] !== null).length;

  // 2. No markers at all → pre-marker legacy vs not-ours.
  if (presentCount === 0) {
    if (countOccurrences(html, SENTINEL_TOKEN) > 0) {
      return fail("runtime sentinels present but all f3d meta markers are missing (markers stripped or tampered)");
    }
    const signatureHits = LEGACY_3DPS_SIGNATURES.filter((s) => html.includes(s)).length;
    if (signatureHits >= 2) {
      report.outcome = "legacy_unsupported";
      report.family = "legacy";
      report.reasons.push(
        "pre-marker 3DPS presentation (no f3d meta markers): no deterministic single-file upgrade exists — regenerate from the Builder",
      );
      return report;
    }
    return fail("not a recognizable 3DPS presentation (no f3d markers, no known 3DPS signatures)");
  }

  // 3. Partial marker sets. The family marker shipped LAST (additive), so
  //    schema+runtime+capabilities WITHOUT family is a real pre-family
  //    generation → regenerate. Any other subset is ambiguous.
  if (presentCount !== F3D_META_NAMES.length) {
    const preFamily =
      meta["f3d-package-schema"] !== null &&
      meta["f3d-runtime"] !== null &&
      meta["f3d-capabilities"] !== null &&
      meta["f3d-package-family"] === null;
    if (preFamily) {
      report.outcome = "legacy_unsupported";
      report.family = "legacy";
      report.runtimeVersion = isStrictSemver(meta["f3d-runtime"]) ? meta["f3d-runtime"] : null;
      report.reasons.push(
        "pre-family-marker generation (no f3d-package-family): v1 patches only fully marked Builder packages — regenerate from the Builder",
      );
      return report;
    }
    const missing = F3D_META_NAMES.filter((n) => meta[n] === null);
    return fail(`partial f3d marker set (missing: ${missing.join(", ")}) — ambiguous package`);
  }

  // 4. Generated-family value + strict schema/runtime FORMAT validation,
  //    for BOTH families, before anything else is decided. A package whose
  //    family/schema/runtime markers do not even parse is malformed —
  //    including for Atlas, which must never reach atlas_managed on
  //    malformed metadata.
  const family = meta["f3d-package-family"];
  if (family !== "builder" && family !== "atlas") {
    return fail(`f3d-package-family "${family}" is not a generated family (expected builder or atlas)`);
  }
  report.family = family;

  const schemaRaw = meta["f3d-package-schema"];
  if (!/^\d+$/.test(schemaRaw)) return fail(`f3d-package-schema "${schemaRaw}" is not an integer`);
  const schema = Number(schemaRaw);
  report.packageSchema = schema;

  const version = meta["f3d-runtime"];
  if (!isStrictSemver(version)) {
    return fail(`f3d-runtime "${version}" is not strict x.y.z semver`);
  }
  report.runtimeVersion = version;

  // 5. Future generations (either family): newer schema or newer runtime
  //    than this build. Decided BEFORE capability and sentinel validation —
  //    a legitimate future package may advertise capabilities this version
  //    does not recognize and carry sentinel layouts it cannot know.
  //    Never downgrade, never guess.
  if (schema > ATLAS_PACKAGE_SCHEMA || semverCompare(version, ATLAS_RUNTIME_VERSION) > 0) {
    report.outcome = "future_version";
    report.reasons.push(
      `${family} package advertises schema ${schema} / runtime ${version}, newer than this build (schema ${ATLAS_PACKAGE_SCHEMA} / runtime ${ATLAS_RUNTIME_VERSION}) — upgrade the tool, never downgrade the package`,
    );
    return report;
  }
  if (schema !== ATLAS_PACKAGE_SCHEMA) {
    return fail(`f3d-package-schema ${schema} predates the versioned contract (expected ${ATLAS_PACKAGE_SCHEMA})`);
  }

  // 6. Capabilities (non-future packages only — the registry is the full
  //    capability universe for every version up to the current one):
  //    every advertised capability must be registered, and a package
  //    claiming the CURRENT runtime must advertise EXACTLY the current
  //    capability set — a 2.2.0 marker with a retired mobile_* capability
  //    is internally inconsistent, not already_current.
  const capsRaw = meta["f3d-capabilities"];
  const caps = capsRaw === "" ? [] : capsRaw.split(",");
  for (const cap of caps) {
    if (!ATLAS_KNOWN_CAPABILITIES.includes(cap)) {
      return fail(`unknown capability "${cap}" in f3d-capabilities (not in the recognized registry)`);
    }
  }
  if (
    semverCompare(version, ATLAS_RUNTIME_VERSION) === 0 &&
    caps.join(",") !== ATLAS_RUNTIME_CAPABILITIES.join(",")
  ) {
    return fail(
      `runtime ${ATLAS_RUNTIME_VERSION} must advertise exactly the current capability set "${ATLAS_RUNTIME_CAPABILITIES.join(",")}" (found "${capsRaw}") — inconsistent contract`,
    );
  }
  report.capabilities = caps;

  // 7. Family↔sentinel conflict checks (current-format sentinel literals;
  //    future packages never reach this point), then Atlas routing: a
  //    valid, understood Atlas package is managed through its GitHub
  //    source repository, never by single-file patch.
  const builderSentinelHits = countOccurrences(html, "BEGIN v=1 family=builder");
  const atlasSentinelHits = countOccurrences(html, "BEGIN v=1 family=atlas");
  if (family === "atlas") {
    if (builderSentinelHits > 0) {
      return fail("family marker says atlas but builder-family sentinels are present (conflicting markers)");
    }
    report.outcome = "atlas_managed";
    report.reasons.push(
      "Atlas curated showcase: upgraded through its GitHub source repository and Netlify redeploy, never by single-file patch",
    );
    return report;
  }
  if (atlasSentinelHits > 0) {
    return fail("family marker says builder but atlas-family sentinels are present (conflicting markers)");
  }

  // 8. Older runtimes outside the supported patch-source set: real
  //    generations, but v1 only patches V1_PATCH_SOURCE_VERSIONS exactly.
  if (
    semverCompare(version, ATLAS_RUNTIME_VERSION) < 0 &&
    V1_PATCH_SOURCE_VERSIONS.indexOf(version) === -1
  ) {
    report.outcome = "legacy_unsupported";
    report.reasons.push(
      `runtime ${version} is not a supported v1 patch source (${V1_PATCH_SOURCE_VERSIONS.join(", ")} → ${ATLAS_RUNTIME_VERSION}) — regenerate from the Builder`,
    );
    return report;
  }

  // 9. Every v1 patch source shipped with the EXACT empty capability set —
  //    anything else is internally inconsistent.
  if (V1_PATCH_SOURCE_VERSIONS.indexOf(version) !== -1 && caps.length > 0) {
    return fail(
      `runtime ${version} cannot advertise capabilities (found "${capsRaw}") — inconsistent contract`,
    );
  }

  // 10. Sentinel integrity — required for BOTH remaining outcomes: a current
  //    package with broken sentinels is corrupt, and a 2.1.0 package is only
  //    patchable when every mutation boundary is intact.
  const sentinels = validateBuilderSentinels(html);
  report.sentinels = sentinels;
  if (!sentinels.valid) {
    report.reasons.push(...sentinels.issues);
    return fail("builder runtime sentinels failed validation (see reasons)");
  }

  if (semverCompare(version, ATLAS_RUNTIME_VERSION) === 0) {
    report.outcome = "already_current";
    report.reasons.push(`package already advertises the current runtime ${ATLAS_RUNTIME_VERSION}`);
    return report;
  }

  report.outcome = "patchable";
  report.reasons.push(
    `Builder ${version} package with all ${BUILDER_RUNTIME_SPANS.length} sentinels intact — eligible for the ${version} → ${ATLAS_RUNTIME_VERSION} single-file upgrade`,
  );
  return report;
}

export {
  INSPECTION_OUTCOMES,
  V1_PATCH_SOURCE_VERSIONS,
  BUILDER_RUNTIME_SPANS,
  F3D_META_NAMES,
  PATCH_MUTATION_ALLOWLIST,
  MANIFEST_SCOPE_NOTE,
  BUILDER_SENTINEL_LITERALS,
  LEGACY_3DPS_SIGNATURES,
  inspectPresentationHtml,
};
