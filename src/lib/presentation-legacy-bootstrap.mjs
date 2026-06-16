// Legacy Bootstrap Adapter (Legacy Bootstrap L2 + L3) — pure, deterministic
// conversion of ONE exact recognized legacy profile (builder-may2026-f8f68f0)
// into the current versioned Builder contract, by replacing ONLY its proven
// runtime regions with the current canonical runtime and inserting the four
// f3d metadata markers. Everything else — protected blob, token, preamble,
// QA data, model IDs, branding chrome, analytics, asset references — is
// preserved byte-for-byte. The protected configuration is treated as OPAQUE
// (never decrypted, parsed, transformed, or regenerated).
//
// Fail-closed integrity contract (L3): source binding; each anchor unique +
// canonical order; non-overlapping regions; all bytes outside the regions
// byte-identical; output carries the 4 metas + 5 balanced sentinels + current
// runtime; exactly one initLiveGuide IIFE; the preserved outer
// __configReady.then/.catch wrapper byte-identical; inline JS parses;
// reinspects as already_current; SHA-256 before/after. Any failure → rejected,
// html:null. Never executes/renders/iframes/DOM-loads/imports the input.

import { inspectLegacyProfile } from "./presentation-legacy-profile.mjs";
import {
  buildBuilderCssSpan,
  BUILDER_DEP_PEERJS_SPAN,
  BUILDER_MARKUP_SPAN,
  buildBuilderJsKernelSpan,
  BUILDER_JS_GLUE_SPAN,
} from "./portal/builder-runtime-spans.mjs";
import {
  buildRuntimeMetaTags,
  ATLAS_RUNTIME_VERSION,
  ATLAS_PACKAGE_SCHEMA,
} from "./atlas-runtime-version.mjs";
import {
  inspectPresentationHtml,
  BUILDER_SENTINEL_LITERALS,
} from "./presentation-upgrade-inspector.mjs";
import { META_INSERT_ANCHOR } from "./presentation-legacy-profile.mjs";

// Current canonical Matterport iframe tags (allow superset). Parity-tested
// against portal.functions.ts so this never drifts from the generator.
const CURRENT_IFRAME_MP =
  '<iframe id="matterport-frame" allowfullscreen allow="xr-spatial-tracking; gyroscope; accelerometer; fullscreen; autoplay; clipboard-write; web-share"></iframe>';
const CURRENT_IFRAME_MP_GHOST =
  '<iframe id="matterport-frame-ghost" allowfullscreen allow="xr-spatial-tracking; gyroscope; accelerometer; fullscreen; autoplay; clipboard-write; web-share" aria-hidden="true" tabindex="-1"></iframe>';

const OUTCOMES = Object.freeze({
  BOOTSTRAPPED: "bootstrapped",
  REJECTED: "rejected",
});

const CODES = Object.freeze({
  NOT_A_STRING: "not_a_string",
  RUNTIME_SOURCES_INVALID: "runtime_sources_invalid",
  LEGACY_PROFILE_UNMATCHED: "legacy_profile_unmatched",
  REGION_CONFLICT: "mutation_region_conflict",
  BYTE_PRESERVATION_VIOLATION: "byte_preservation_violation",
  GLUE_WRAPPER_VIOLATION: "glue_wrapper_violation",
  JS_PARSE_FAILED: "inline_js_parse_failed",
  POST_VALIDATION_FAILED: "post_validation_failed",
});

function lineStartOf(html, index) {
  return html.lastIndexOf("\n", index - 1) + 1;
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0 && v.trim().length > 0;
}

function validateRuntimeSources(rs) {
  return rs !== null && typeof rs === "object" &&
    isNonEmptyString(rs.liveSessionJs) && isNonEmptyString(rs.annoInputJs);
}

// Ordered untouched segments between a sorted region list [{start,end}].
function untouchedSegments(html, regions) {
  const segs = [];
  let cursor = 0;
  for (const r of regions) {
    segs.push(html.slice(cursor, r.start));
    cursor = r.end;
  }
  segs.push(html.slice(cursor));
  return segs;
}

// Locate the eight OUTPUT regions independently (current sentinels + f3d metas
// + current iframe tags), applying the same boundary convention used to build
// the output, so the untouched segments can be compared to the input's.
function deriveOutputRegions(out) {
  const insp = inspectPresentationHtml(out);
  if (!insp.sentinels || insp.sentinels.valid !== true) return null;
  const span = (name) => insp.sentinels.spans.find((s) => s.name === name) || null;
  const css = span("css");
  const dep = span("dep:peerjs");
  const markup = span("markup");
  const kernel = span("js:kernel");
  const glue = span("js:glue");
  if (!css || !dep || !markup || !kernel || !glue) return null;

  // f3d meta block (4 contiguous metas). The region is the inserted "\n"+metas
  // starting at the insertion point (immediately after the head anchor), so the
  // leading newline we inserted is part of the region, not the preceding segment.
  const metaRe = /<meta name="f3d-[a-z-]+" content="[^"]*" \/>/g;
  const metas = [];
  let m;
  while ((m = metaRe.exec(out)) !== null) metas.push({ start: m.index, end: m.index + m[0].length });
  if (metas.length !== 4) return null;
  const anchorAt = out.indexOf(META_INSERT_ANCHOR);
  if (anchorAt === -1) return null;
  const metaStart = anchorAt + META_INSERT_ANCHOR.length; // the insertion point
  const metaEnd = metas[3].end;
  if (metas[0].start !== metaStart + 1) return null; // metas must directly follow the inserted "\n"

  const mfStart = out.indexOf(CURRENT_IFRAME_MP);
  const ghostStart = out.indexOf(CURRENT_IFRAME_MP_GHOST);
  if (mfStart === -1 || ghostStart === -1) return null;

  // Boundary convention (mirrors the builder): css/kernel consumed the trailing
  // newline (we appended one) → +1; markup/glue/peerjs/iframes end at the token.
  const regions = [
    { key: "meta", start: metaStart, end: metaEnd },
    { key: "css", start: lineStartOf(out, css.beginStart), end: css.endEnd + 1 },
    { key: "dep:peerjs", start: lineStartOf(out, dep.beginStart), end: dep.endEnd },
    { key: "iframe:mp", start: mfStart, end: mfStart + CURRENT_IFRAME_MP.length },
    { key: "iframe:ghost", start: ghostStart, end: ghostStart + CURRENT_IFRAME_MP_GHOST.length },
    { key: "markup", start: lineStartOf(out, markup.beginStart), end: markup.endEnd },
    { key: "js:kernel", start: lineStartOf(out, kernel.beginStart), end: kernel.endEnd + 1 },
    { key: "js:glue", start: lineStartOf(out, glue.beginStart), end: glue.endEnd },
  ];
  regions.sort((a, b) => a.start - b.start);
  for (let i = 1; i < regions.length; i++) {
    if (regions[i].start < regions[i - 1].end) return null;
  }
  return regions;
}

// Inert "parses" check for the inline runtime IIFE: balanced sentinels already
// proven; here we compile (never run) the kernel+glue JS via the Function
// constructor, which throws on a syntax error. Pure: no execution, no DOM.
function inlineJsParses(out) {
  try {
    const k = BUILDER_SENTINEL_LITERALS["js:kernel"];
    const g = BUILDER_SENTINEL_LITERALS["js:glue"];
    const kStart = out.indexOf(k.begin);
    const gEnd = out.indexOf(g.end);
    if (kStart === -1 || gEnd === -1 || gEnd < kStart) return false;
    const js = out.slice(kStart, gEnd + g.end.length);
    new Function(js); // compiles (parses) without executing
    return true;
  } catch {
    return false;
  }
}

function bootstrapLegacyPresentation(html, runtimeSources) {
  const reject = (code, message, extra) => ({
    outcome: OUTCOMES.REJECTED,
    code,
    message,
    sourceHtml: typeof html === "string" ? html : null,
    html: null,
    profileId: null,
    branding: null,
    capabilities: [],
    regions: null,
    inspection: null,
    postInspection: null,
    ...(extra || {}),
  });

  if (typeof html !== "string") return reject(CODES.NOT_A_STRING, "input is not a string");
  if (!validateRuntimeSources(runtimeSources)) {
    return reject(CODES.RUNTIME_SOURCES_INVALID, "trusted runtime sources { liveSessionJs, annoInputJs } are required");
  }

  // 1. Exact-profile recognition (L1). Reject on any mismatch.
  const profile = inspectLegacyProfile(html);
  if (!profile.supported) {
    return reject(CODES.LEGACY_PROFILE_UNMATCHED,
      `not the supported legacy profile: ${profile.reasons[profile.reasons.length - 1] || "unmatched"}`,
      { inspection: profile });
  }

  const { accentColor, hudBgColor } = profile.branding;

  // 2. Build the per-region replacements (current canonical runtime + metas).
  //    css/kernel append a trailing newline (their region ends at the next
  //    line start); markup/glue/peerjs/iframes/meta do not.
  const replacementByKey = {
    css: buildBuilderCssSpan({ accentColor, hudBgColor }) + "\n",
    "dep:peerjs": BUILDER_DEP_PEERJS_SPAN,
    "iframe:matterport-frame": CURRENT_IFRAME_MP,
    "iframe:matterport-frame-ghost": CURRENT_IFRAME_MP_GHOST,
    markup: BUILDER_MARKUP_SPAN,
    "js:kernel": buildBuilderJsKernelSpan({
      liveSessionJs: runtimeSources.liveSessionJs,
      annoInputJs: runtimeSources.annoInputJs,
    }) + "\n",
    "js:glue": BUILDER_JS_GLUE_SPAN,
    meta: "\n" + buildRuntimeMetaTags("builder"),
  };

  const regions = profile.regions.map((r) => ({ ...r, replacement: replacementByKey[r.key] }));
  for (const r of regions) {
    if (typeof r.replacement !== "string") {
      return reject(CODES.REGION_CONFLICT, `no replacement for region ${r.key}`);
    }
  }

  // 3. Apply descending so earlier offsets stay valid. (Regions already
  //    validated unique, ordered, non-overlapping by the profile inspector.)
  const descending = regions.slice().sort((a, b) => b.start - a.start);
  let out = html;
  for (const r of descending) {
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  }

  // 4. INTEGRITY CONTRACT (fail-closed).
  // 4a. Byte-preservation: untouched segments outside the regions identical.
  const inputRegionsSorted = profile.regions.slice().sort((a, b) => a.start - b.start);
  const inputSegs = untouchedSegments(html, inputRegionsSorted);
  const outRegions = deriveOutputRegions(out);
  if (outRegions === null) {
    return reject(CODES.POST_VALIDATION_FAILED, "could not independently re-derive the output regions");
  }
  const outSegs = untouchedSegments(out, outRegions);
  if (inputSegs.length !== outSegs.length) {
    return reject(CODES.BYTE_PRESERVATION_VIOLATION, "untouched segment count differs");
  }
  for (let i = 0; i < inputSegs.length; i++) {
    if (inputSegs[i] !== outSegs[i]) {
      return reject(CODES.BYTE_PRESERVATION_VIOLATION, `untouched segment #${i} differs (a byte outside the mutation regions changed)`);
    }
  }

  // 4b. Exactly one initLiveGuide IIFE + the preserved outer wrapper intact.
  const initCount = out.split("(function initLiveGuide(){").length - 1;
  if (initCount !== 1) {
    return reject(CODES.GLUE_WRAPPER_VIOLATION, `expected exactly one initLiveGuide IIFE (found ${initCount})`);
  }
  // The glue END sentinel must be immediately followed by the preserved
  // outer catch wrapper (newline + "}).catch(function(err){").
  const glueEndLit = BUILDER_SENTINEL_LITERALS["js:glue"].end;
  const glueEndAt = out.indexOf(glueEndLit);
  if (glueEndAt === -1 || !out.startsWith("\n}).catch(function(err){", glueEndAt + glueEndLit.length)) {
    return reject(CODES.GLUE_WRAPPER_VIOLATION, "preserved outer __configReady catch wrapper not intact after the glue span");
  }

  // 4c. Inline runtime JS parses (compile-only).
  if (!inlineJsParses(out)) {
    return reject(CODES.JS_PARSE_FAILED, "inline runtime JavaScript failed to parse");
  }

  // 4d. Reinspect via the CURRENT inspector → must be already_current.
  const post = inspectPresentationHtml(out);
  if (post.outcome !== "already_current") {
    return reject(CODES.POST_VALIDATION_FAILED, `output reinspects as "${post.outcome}" (expected already_current)`, { postInspection: post });
  }
  if (!post.sentinels || post.sentinels.valid !== true) {
    return reject(CODES.POST_VALIDATION_FAILED, "output sentinels failed validation", { postInspection: post });
  }
  if (post.runtimeVersion !== ATLAS_RUNTIME_VERSION || post.packageSchema !== ATLAS_PACKAGE_SCHEMA || post.family !== "builder") {
    return reject(CODES.POST_VALIDATION_FAILED, "output runtime/schema/family does not match the current contract", { postInspection: post });
  }

  return {
    outcome: OUTCOMES.BOOTSTRAPPED,
    code: null,
    message: `bootstrapped ${profile.profileId} → runtime ${ATLAS_RUNTIME_VERSION}`,
    sourceHtml: html,
    html: out,
    profileId: profile.profileId,
    branding: { accentColor, hudBgColor },
    capabilities: profile.capabilities.slice(),
    regions: profile.regions.map((r) => ({ key: r.key, op: r.op, start: r.start, end: r.end })),
    inspection: profile,
    postInspection: post,
  };
}

export {
  OUTCOMES as LEGACY_BOOTSTRAP_OUTCOMES,
  CODES as LEGACY_BOOTSTRAP_CODES,
  CURRENT_IFRAME_MP,
  CURRENT_IFRAME_MP_GHOST,
  bootstrapLegacyPresentation,
};
