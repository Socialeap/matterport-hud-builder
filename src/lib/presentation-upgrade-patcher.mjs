// Presentation Upgrade Patcher (P3) — pure, deterministic single-file
// upgrade of ONE Builder `index.html` from a supported v1 patch source
// (2.1.0 / 2.2.0) to the current runtime. Read-the-bytes / write-the-bytes
// only: no DOM, no execution, no Date/random, no I/O. The upload stays inert
// text exactly as the inspector treats it.
//
// CONTRACT (approved 2026-06-13):
//   - The inspector is the SOLE eligibility gate. The patcher builds or
//     mutates NOTHING unless inspectPresentationHtml() returns "patchable".
//     already_current → byte-identical no-op. Every other outcome → rejected
//     with a structured code, before any branding extraction or span build.
//   - EXACTLY nine mutation regions may change, and nothing else:
//       • the five sentinel-INCLUSIVE runtime spans (offsets from the
//         inspector's validated report), and
//       • the content value of the four f3d <meta> markers.
//     Byte preservation is PROVEN, not assumed: the ordered untouched byte
//     segments BETWEEN the nine regions must be identical before and after,
//     derived independently from fresh post-patch offsets (never from masks
//     or stale offsets).
//   - Branding is recovered ONLY from stable preserved chrome-CSS anchors,
//     searched against a representation of the input with all five validated
//     runtime spans REMOVED — span bytes can never influence matching,
//     consensus, or rejection. Multiple independent anchors per channel must
//     agree on a normalized #rrggbb value; missing / duplicated / malformed /
//     conflicting → rejected. No defaults, no guessing. Anchors are plaintext
//     gate/HUD chrome, so recovery never touches protected config or tokens.
//   - Replacement spans come from the P2 canonical builders
//     (builder-runtime-spans.mjs), so a patched file is byte-identical to a
//     freshly generated current package for the recovered branding. The patch
//     is verified by RE-INSPECTING the output → must be already_current with
//     valid sentinels.

import {
  ATLAS_PACKAGE_SCHEMA,
  ATLAS_RUNTIME_VERSION,
  ATLAS_RUNTIME_CAPABILITIES,
} from "./atlas-runtime-version.mjs";
import {
  inspectPresentationHtml,
  F3D_META_NAMES,
  BUILDER_RUNTIME_SPANS,
} from "./presentation-upgrade-inspector.mjs";
import {
  buildBuilderCssSpan,
  buildBuilderJsKernelSpan,
  BUILDER_DEP_PEERJS_SPAN,
  BUILDER_MARKUP_SPAN,
  BUILDER_JS_GLUE_SPAN,
} from "./portal/builder-runtime-spans.mjs";

// ── Outcomes + structured rejection codes (stable, UI-facing) ──────────────
const PATCH_OUTCOMES = Object.freeze({
  PATCHED: "patched",
  NOOP_ALREADY_CURRENT: "noop_already_current",
  REJECTED: "rejected",
});

// Machine-readable rejection codes. The four inspector-mapped codes mirror
// the non-patchable inspector outcomes; the rest are patcher-internal
// fail-closed guards. Every code ships with a human-readable message.
const REJECTION_CODES = Object.freeze({
  FUTURE_VERSION: "future_version",
  ATLAS_MANAGED: "atlas_managed",
  LEGACY_UNSUPPORTED: "legacy_unsupported",
  INVALID: "invalid",
  NOT_A_STRING: "not_a_string",
  RUNTIME_SOURCES_INVALID: "runtime_sources_invalid",
  BRANDING_NOT_RECOVERABLE: "branding_not_recoverable",
  MUTATION_REGION_CONFLICT: "mutation_region_conflict",
  POST_VALIDATION_FAILED: "post_validation_failed",
  BYTE_PRESERVATION_VIOLATION: "byte_preservation_violation",
});

const REJECTION_MESSAGES = Object.freeze({
  [REJECTION_CODES.FUTURE_VERSION]:
    "This package is newer than the upgrade tool. Update the tool; never downgrade the package.",
  [REJECTION_CODES.ATLAS_MANAGED]:
    "Atlas curated showcases are upgraded through their source repository and redeploy, not by single-file patch.",
  [REJECTION_CODES.LEGACY_UNSUPPORTED]:
    "This presentation predates the supported single-file upgrade path. Regenerate it from the Builder.",
  [REJECTION_CODES.INVALID]:
    "This file is not a valid, unambiguous Builder presentation and cannot be patched.",
  [REJECTION_CODES.NOT_A_STRING]: "Input is not an HTML string.",
  [REJECTION_CODES.RUNTIME_SOURCES_INVALID]:
    "The current Frontiers3D runtime components were unavailable, so no upgraded file was produced. This is an internal configuration problem, not a problem with the uploaded presentation.",
  [REJECTION_CODES.BRANDING_NOT_RECOVERABLE]:
    "Could not confidently recover the presentation's brand colors from its preserved styling. Regenerate from the Builder.",
  [REJECTION_CODES.MUTATION_REGION_CONFLICT]:
    "The upgrade regions overlap or could not be located unambiguously — refusing to patch.",
  [REJECTION_CODES.POST_VALIDATION_FAILED]:
    "The patched output did not validate as a current package — no file was produced.",
  [REJECTION_CODES.BYTE_PRESERVATION_VIOLATION]:
    "The patch would have altered bytes outside the allowed upgrade regions — no file was produced.",
});

// Map a non-patchable / non-current inspector outcome → rejection code.
const INSPECTOR_OUTCOME_TO_CODE = Object.freeze({
  future_version: REJECTION_CODES.FUTURE_VERSION,
  atlas_managed: REJECTION_CODES.ATLAS_MANAGED,
  legacy_unsupported: REJECTION_CODES.LEGACY_UNSUPPORTED,
  invalid: REJECTION_CODES.INVALID,
});

// Exactly nine mutation regions: 5 spans + 4 meta values. Pinned so callers
// and tests can assert the count without recomputing it.
const EXPECTED_MUTATION_REGION_COUNT = BUILDER_RUNTIME_SPANS.length + F3D_META_NAMES.length;

// ── Branding anchors ───────────────────────────────────────────────────────
// Each anchor is an EXACT slice of preserved chrome CSS that surrounds one
// brand-color interpolation in portal.functions.ts, OUTSIDE all five runtime
// spans. `prefix` ends immediately before the `#color`; `suffix` begins
// immediately after it. The generator emits `${escapeHtml(accentColor)}` /
// `${escapeHtml(hudBgColor)}` at that exact spot — pinned by the
// generator-parity test so any chrome edit fails loudly and forces a
// deliberate re-pin. Four independent accent anchors + three hudBg anchors;
// all must agree.
const BRANDING_ANCHORS = Object.freeze([
  {
    id: "A1",
    channel: "accent",
    prefix:
      ".gate-btn-primary{padding:13px 28px;font-size:15px;font-weight:600;border:none;border-radius:10px;cursor:pointer;background:",
    suffix: ";color:#fff;transition:",
  },
  {
    id: "A2",
    channel: "accent",
    prefix:
      ".hud-contact-btn{padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;border:none;color:#fff;cursor:pointer;background:",
    suffix: ";transition:opacity 0.2s}",
  },
  {
    id: "A3",
    channel: "accent",
    prefix:
      ".agent-avatar-init{width:48px;height:48px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;flex-shrink:0;background:",
    suffix: ";border:1px solid rgba(255,255,255,0.18)}",
  },
  {
    id: "A4",
    channel: "accent",
    prefix: "#gate-password-input:focus{border-color:",
    suffix: "}",
  },
  {
    id: "H1",
    channel: "hudBg",
    prefix:
      "#gate{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;z-index:3000;background:",
    suffix: "40;backdrop-filter:blur(8px)",
  },
  {
    id: "H2",
    channel: "hudBg",
    prefix:
      "#hud-inner{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 12px;padding:10px 16px 10px 16px;padding-right:48px;background:",
    suffix: "99;backdrop-filter:blur(20px)",
  },
  {
    id: "H3",
    channel: "hudBg",
    prefix:
      "#agent-drawer{position:fixed;top:0;right:0;width:min(300px,88vw);height:100%;z-index:2000;overflow-y:auto;transform:translateX(100%);transition:transform 0.3s ease;background:",
    suffix: "cc;backdrop-filter:blur(24px)",
  },
]);

// The interpolation token the generator emits at each anchor's color slot,
// by channel — used ONLY by the generator-parity test to keep the anchors
// in lockstep with portal.functions.ts.
const ANCHOR_CHANNEL_TOKEN = Object.freeze({
  accent: "${escapeHtml(accentColor)}",
  hudBg: "${escapeHtml(hudBgColor)}",
});

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Normalize a CSS hex color to lowercase #rrggbb. Accepts ONLY #RGB or
// #RRGGBB (case-insensitive); #RGBA / #RRGGBBAA / rgb()/named/etc. → null.
function normalizeHexColor(raw) {
  if (typeof raw !== "string") return null;
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(raw);
  if (!m) return null;
  let hex = m[1].toLowerCase();
  if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  return "#" + hex;
}

// ── Trusted runtime sources (fail-closed) ──────────────────────────────────
// liveSessionJs / annoInputJs are the CURRENT Frontiers3D runtime module
// sources, supplied by the trusted application bundle (never from the upload
// or user input). The inspector and byte-preservation guards prove package
// structure and preserved bytes, NOT that the kernel JS is complete — so the
// patcher must refuse to build a kernel from missing/empty sources rather than
// emit a structurally-valid package with a broken (or literal "undefined")
// runtime. Reasons name the offending field WITHOUT echoing its contents.
function validateRuntimeSources(runtimeSources) {
  if (runtimeSources === null || typeof runtimeSources !== "object" || Array.isArray(runtimeSources)) {
    return {
      ok: false,
      reasons: ["runtime sources must be a non-null object carrying liveSessionJs and annoInputJs"],
    };
  }
  const reasons = [];
  for (const field of ["liveSessionJs", "annoInputJs"]) {
    const value = runtimeSources[field];
    if (typeof value !== "string") {
      const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      reasons.push(`runtime source "${field}" is missing or not a string (got ${kind})`);
    } else if (value.trim().length === 0) {
      reasons.push(`runtime source "${field}" is empty or whitespace-only`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

// ── Span-removed representation (for branding recovery only) ────────────────
// Concatenate the byte ranges OUTSIDE the five sentinel-inclusive spans, so
// nothing inside any runtime span can be matched as a branding anchor.
function buildSpanRemovedRepresentation(html, spans) {
  const ranges = spans
    .map((s) => ({ start: s.beginStart, end: s.endEnd }))
    .sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const r of ranges) {
    out += html.slice(cursor, r.start);
    cursor = r.end;
  }
  out += html.slice(cursor);
  return out;
}

// Recover { accentColor, hudBgColor } from the span-removed representation.
// Returns { ok: true, accentColor, hudBgColor } or { ok: false, reasons }.
function recoverBranding(spanRemovedHtml) {
  const reasons = [];
  const byChannel = { accent: [], hudBg: [] };

  for (const anchor of BRANDING_ANCHORS) {
    const re = new RegExp(
      escapeRegExp(anchor.prefix) + "(#[0-9a-fA-F]+)" + escapeRegExp(anchor.suffix),
      "g",
    );
    const matches = [];
    let m;
    while ((m = re.exec(spanRemovedHtml)) !== null) matches.push(m[1]);

    if (matches.length === 0) {
      reasons.push(`anchor ${anchor.id} (${anchor.channel}): not found in preserved chrome`);
      continue;
    }
    if (matches.length > 1) {
      reasons.push(`anchor ${anchor.id} (${anchor.channel}): found ${matches.length} times (ambiguous)`);
      continue;
    }
    const normalized = normalizeHexColor(matches[0]);
    if (normalized === null) {
      reasons.push(`anchor ${anchor.id} (${anchor.channel}): "${matches[0]}" is not a #RGB/#RRGGBB color`);
      continue;
    }
    byChannel[anchor.channel].push({ id: anchor.id, value: normalized });
  }

  const consensus = (channel, expectedCount) => {
    const found = byChannel[channel];
    if (found.length !== expectedCount) {
      // Specific per-anchor reasons were already pushed above.
      return null;
    }
    const distinct = Array.from(new Set(found.map((f) => f.value)));
    if (distinct.length !== 1) {
      reasons.push(
        `${channel} anchors disagree: ${found.map((f) => `${f.id}=${f.value}`).join(", ")}`,
      );
      return null;
    }
    return distinct[0];
  };

  const accentCount = BRANDING_ANCHORS.filter((a) => a.channel === "accent").length;
  const hudBgCount = BRANDING_ANCHORS.filter((a) => a.channel === "hudBg").length;
  const accentColor = consensus("accent", accentCount);
  const hudBgColor = consensus("hudBg", hudBgCount);

  if (accentColor === null || hudBgColor === null) {
    return { ok: false, reasons };
  }
  return { ok: true, accentColor, hudBgColor };
}

// ── Meta value regions ─────────────────────────────────────────────────────
// Locate the [start,end) byte range of each f3d meta's content VALUE (between
// the quotes), strictly in the generated format. The inspector has already
// guaranteed exactly one strict, well-formed occurrence per name for any
// package it routes here; we re-derive defensively and fail closed on any
// surprise. `valueBuilder(name)` yields the replacement value.
function locateMetaValueRegions(html, valueBuilder) {
  const regions = [];
  for (const name of F3D_META_NAMES) {
    const head = `<meta name="${name}" content="`;
    const re = new RegExp(escapeRegExp(head) + `([^"]*)" \\/>`, "g");
    const found = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      found.push({ index: m.index, value: m[1] });
    }
    if (found.length !== 1) {
      return { ok: false, reason: `f3d meta "${name}" appears ${found.length} times in strict format (expected 1)` };
    }
    const start = found[0].index + head.length;
    const end = start + found[0].value.length;
    regions.push({ kind: "meta", name, start, end, replacement: valueBuilder(name) });
  }
  return { ok: true, regions };
}

// Replacement value for each f3d meta = the current canonical contract.
function currentMetaValue(name) {
  switch (name) {
    case "f3d-package-schema":
      return String(ATLAS_PACKAGE_SCHEMA);
    case "f3d-runtime":
      return ATLAS_RUNTIME_VERSION;
    case "f3d-capabilities":
      return ATLAS_RUNTIME_CAPABILITIES.join(",");
    case "f3d-package-family":
      return "builder";
    default:
      throw new Error(`unknown f3d meta name: ${name}`);
  }
}

// ── Region helpers ─────────────────────────────────────────────────────────
// A span's canonical builder bytes may include the BEGIN line's leading
// indentation (markup carries 4 spaces; the generator emits it at column 0).
// The inspector anchors span offsets at the sentinel TOKEN, excluding that
// indent — so the patcher's span mutation region must extend left to the
// start of the BEGIN line. The extended bytes must be whitespace only (the
// sentinel is on its own line); anything else is tampering → fail closed.
// Applied IDENTICALLY to input and output so the byte-preservation segment
// comparison aligns on the same boundaries.
function spanMutationRange(html, span) {
  const nl = html.lastIndexOf("\n", span.beginStart - 1);
  const lineStart = nl + 1;
  const lead = html.slice(lineStart, span.beginStart);
  if (!/^[ \t]*$/.test(lead)) return null;
  return { kind: "span", name: span.name, start: lineStart, end: span.endEnd };
}

// Validate that regions are non-overlapping (zero-length regions allowed but
// must not sit strictly inside another). Returns sorted-ascending or an error.
function validateNonOverlap(regions) {
  const sorted = [...regions].sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      return { ok: false, reason: `regions overlap near offset ${sorted[i].start}` };
    }
  }
  return { ok: true, sorted };
}

// The ordered untouched byte segments BETWEEN the regions (10 segments for 9
// regions): everything that the patch must leave byte-identical.
function untouchedSegments(html, sortedRegions) {
  const segs = [];
  let cursor = 0;
  for (const r of sortedRegions) {
    segs.push(html.slice(cursor, r.start));
    cursor = r.end;
  }
  segs.push(html.slice(cursor));
  return segs;
}

// Apply replacements in descending start order so earlier offsets stay valid.
function applyReplacements(html, regions) {
  const descending = [...regions].sort((a, b) => b.start - a.start);
  let out = html;
  for (const r of descending) {
    out = out.slice(0, r.start) + r.replacement + out.slice(r.end);
  }
  return out;
}

// ── Patcher ────────────────────────────────────────────────────────────────
function patchPresentationHtml(html, runtimeSources) {
  const reject = (code, extraReasons = [], inspection = null) => ({
    outcome: PATCH_OUTCOMES.REJECTED,
    code,
    message: REJECTION_MESSAGES[code],
    reasons: extraReasons,
    inspection,
    branding: null,
    // sourceHtml binds a result to the EXACT input it was produced from (the
    // report layer requires sourceHtml === originalHtml before authorizing a
    // download). Null on rejection — no download is ever offered there.
    sourceHtml: null,
    html: null,
    postInspection: null,
  });

  if (typeof html !== "string") {
    return reject(REJECTION_CODES.NOT_A_STRING, ["input is not a string"]);
  }

  // 1. Inspector is the sole eligibility gate. Nothing is built or mutated
  //    until it returns "patchable".
  const inspection = inspectPresentationHtml(html);

  if (inspection.outcome === "already_current") {
    return {
      outcome: PATCH_OUTCOMES.NOOP_ALREADY_CURRENT,
      code: null,
      message: `Already at the current runtime ${ATLAS_RUNTIME_VERSION}; nothing to upgrade.`,
      reasons: inspection.reasons.slice(),
      inspection,
      branding: null,
      sourceHtml: html, // the exact immutable input
      html, // byte-identical echo — no building, no mutation
      postInspection: null,
    };
  }

  if (inspection.outcome !== "patchable") {
    const code = INSPECTOR_OUTCOME_TO_CODE[inspection.outcome] ?? REJECTION_CODES.INVALID;
    return reject(code, inspection.reasons.slice(), inspection);
  }

  // 2. Eligible. Validate the trusted runtime sources fail-closed BEFORE any
  //    branding recovery or span construction — a future/atlas/legacy/invalid
  //    package is never reached here, so it can never be mislabeled.
  const sources = validateRuntimeSources(runtimeSources);
  if (!sources.ok) {
    return reject(REJECTION_CODES.RUNTIME_SOURCES_INVALID, sources.reasons, inspection);
  }

  // 3. Recover branding from the span-removed representation ONLY.
  const spanRemoved = buildSpanRemovedRepresentation(html, inspection.sentinels.spans);
  const branding = recoverBranding(spanRemoved);
  if (!branding.ok) {
    return reject(REJECTION_CODES.BRANDING_NOT_RECOVERABLE, branding.reasons, inspection);
  }

  // 4. Build the nine mutation regions (5 spans + 4 metas). Span replacements
  //    come from the P2 canonical builders; meta replacements are the current
  //    contract values.
  const spanReplacements = {
    css: () => buildBuilderCssSpan({ accentColor: branding.accentColor, hudBgColor: branding.hudBgColor }),
    "dep:peerjs": () => BUILDER_DEP_PEERJS_SPAN,
    markup: () => BUILDER_MARKUP_SPAN,
    "js:kernel": () =>
      buildBuilderJsKernelSpan({
        liveSessionJs: runtimeSources.liveSessionJs,
        annoInputJs: runtimeSources.annoInputJs,
      }),
    "js:glue": () => BUILDER_JS_GLUE_SPAN,
  };
  const spanRegions = [];
  for (const s of inspection.sentinels.spans) {
    const range = spanMutationRange(html, s);
    if (range === null) {
      return reject(
        REJECTION_CODES.MUTATION_REGION_CONFLICT,
        [`span ${s.name}: non-whitespace precedes the BEGIN sentinel on its line`],
        inspection,
      );
    }
    spanRegions.push({ ...range, replacement: spanReplacements[s.name]() });
  }

  const metaResult = locateMetaValueRegions(html, currentMetaValue);
  if (!metaResult.ok) {
    return reject(REJECTION_CODES.MUTATION_REGION_CONFLICT, [metaResult.reason], inspection);
  }

  const inputRegions = [...spanRegions, ...metaResult.regions];
  if (inputRegions.length !== EXPECTED_MUTATION_REGION_COUNT) {
    return reject(
      REJECTION_CODES.MUTATION_REGION_CONFLICT,
      [`expected ${EXPECTED_MUTATION_REGION_COUNT} mutation regions, built ${inputRegions.length}`],
      inspection,
    );
  }
  const inputOrder = validateNonOverlap(inputRegions);
  if (!inputOrder.ok) {
    return reject(REJECTION_CODES.MUTATION_REGION_CONFLICT, [inputOrder.reason], inspection);
  }

  // 5. Splice descending so offsets stay valid.
  const output = applyReplacements(html, inputRegions);

  // 6. Re-inspect the output: it must validate as the current package.
  const postInspection = inspectPresentationHtml(output);
  if (postInspection.outcome !== "already_current" || !postInspection.sentinels.valid) {
    return reject(
      REJECTION_CODES.POST_VALIDATION_FAILED,
      [
        `post-patch inspection outcome was "${postInspection.outcome}" (expected already_current)`,
        ...postInspection.reasons,
      ],
      inspection,
    );
  }

  // 7. Prove byte preservation from FRESH output offsets — never from masks
  //    or the original (now-stale) offsets. Build the output's nine regions
  //    independently, then compare the ordered untouched segments.
  const outputSpanRegions = [];
  for (const s of postInspection.sentinels.spans) {
    const range = spanMutationRange(output, s);
    if (range === null) {
      return reject(
        REJECTION_CODES.BYTE_PRESERVATION_VIOLATION,
        [`output span ${s.name}: non-whitespace precedes the BEGIN sentinel on its line`],
        inspection,
      );
    }
    outputSpanRegions.push(range);
  }
  const outputMetaResult = locateMetaValueRegions(output, () => "");
  if (!outputMetaResult.ok) {
    return reject(REJECTION_CODES.BYTE_PRESERVATION_VIOLATION, [outputMetaResult.reason], inspection);
  }
  const outputRegions = [...outputSpanRegions, ...outputMetaResult.regions];
  const outputOrder = validateNonOverlap(outputRegions);
  if (!outputOrder.ok) {
    return reject(REJECTION_CODES.BYTE_PRESERVATION_VIOLATION, [outputOrder.reason], inspection);
  }

  const inSegs = untouchedSegments(html, inputOrder.sorted);
  const outSegs = untouchedSegments(output, outputOrder.sorted);
  if (inSegs.length !== outSegs.length) {
    return reject(
      REJECTION_CODES.BYTE_PRESERVATION_VIOLATION,
      [`untouched segment count changed (${inSegs.length} → ${outSegs.length})`],
      inspection,
    );
  }
  // The region KIND/name order between input and output must also match, so a
  // segment-for-segment comparison aligns the same boundaries.
  const inKinds = inputOrder.sorted.map((r) => `${r.kind}:${r.name}`).join("|");
  const outKinds = outputOrder.sorted.map((r) => `${r.kind}:${r.name}`).join("|");
  if (inKinds !== outKinds) {
    return reject(
      REJECTION_CODES.BYTE_PRESERVATION_VIOLATION,
      [`mutation-region order changed (${inKinds} → ${outKinds})`],
      inspection,
    );
  }
  for (let i = 0; i < inSegs.length; i++) {
    if (inSegs[i] !== outSegs[i]) {
      return reject(
        REJECTION_CODES.BYTE_PRESERVATION_VIOLATION,
        [`untouched segment #${i} changed between input and output`],
        inspection,
      );
    }
  }

  // 8. Success.
  return {
    outcome: PATCH_OUTCOMES.PATCHED,
    code: null,
    message: `Upgraded Builder runtime ${inspection.runtimeVersion} → ${ATLAS_RUNTIME_VERSION}.`,
    reasons: [
      `replaced ${spanRegions.length} runtime spans and rewrote ${metaResult.regions.length} f3d meta values`,
      `recovered branding accent ${branding.accentColor} / hud ${branding.hudBgColor} from ${BRANDING_ANCHORS.length} preserved chrome anchors`,
    ],
    inspection,
    branding: { accentColor: branding.accentColor, hudBgColor: branding.hudBgColor },
    sourceHtml: html, // the exact immutable input this output was produced from
    html: output,
    postInspection,
  };
}

export {
  PATCH_OUTCOMES,
  REJECTION_CODES,
  REJECTION_MESSAGES,
  EXPECTED_MUTATION_REGION_COUNT,
  BRANDING_ANCHORS,
  ANCHOR_CHANNEL_TOKEN,
  normalizeHexColor,
  patchPresentationHtml,
};
