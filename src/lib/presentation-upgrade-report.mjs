// Presentation Upgrade Report (P4) — pure audit/report + downloadable output
// layer AROUND the approved P3 patcher. It NEVER modifies the patcher and
// derives every field from `originalHtml` + the existing `patchResult` (which
// already carries inspection, postInspection, branding, html, reasons, code,
// message). No DOM, no admin route, no DB, no storage, no upload retention.
//
// Two entry points, both async (SHA-256 is computed with Web Crypto):
//   - buildUpgradeReport({ originalFilename, originalHtml, patchResult }) →
//     a structured UpgradeReport for display/logging. Throws the documented
//     UpgradeReportError on a malformed result or when SHA-256 is unavailable
//     (fail closed — never a placeholder hash).
//   - prepareUpgradeDownload(patchResult, report) → { filename, html,
//     mimeType } | null. Returns the EXACT validated `patchResult.html` only
//     when the result is a verified patch AND the report is bound to that
//     html (re-hash must equal report.sha256.after). Never exposes a download
//     for a rejected/noop result, and never throws.

import {
  ATLAS_PACKAGE_SCHEMA,
  ATLAS_RUNTIME_VERSION,
} from "./atlas-runtime-version.mjs";
import {
  PATCH_OUTCOMES,
} from "./presentation-upgrade-patcher.mjs";
import {
  F3D_META_NAMES,
  BUILDER_RUNTIME_SPANS,
} from "./presentation-upgrade-inspector.mjs";

const REPORT_SCHEMA_VERSION = 1;
const DOWNLOAD_MIME_TYPE = "text/html";
const HEX64 = /^[0-9a-f]{64}$/;

// Filename caps. The suffix is always kept intact; only the stem is trimmed.
const FILENAME_TOTAL_CAP = 120;
const REPLACEMENT_SUFFIX = `.upgraded-${ATLAS_RUNTIME_VERSION}.html`;
const FILENAME_FALLBACK_STEM = "presentation";

// Documented report-layer error. buildUpgradeReport throws this (rather than
// an uncontrolled TypeError or a placeholder result) for malformed input or
// missing crypto; prepareUpgradeDownload catches everything and returns null.
class UpgradeReportError extends Error {
  constructor(message) {
    super(message);
    this.name = "UpgradeReportError";
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Hashing (fail closed) ───────────────────────────────────────────────────
// SHA-256 of the in-memory HTML string encoded as UTF-8, hex-encoded. If
// Web Crypto (crypto.subtle) or TextEncoder is unavailable, throw — never
// manufacture a placeholder digest.
async function sha256HexUtf8(str) {
  if (typeof str !== "string") {
    throw new UpgradeReportError("cannot hash a non-string value");
  }
  if (typeof TextEncoder === "undefined") {
    throw new UpgradeReportError("SHA-256 unavailable: TextEncoder is missing in this environment");
  }
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle || typeof subtle.digest !== "function") {
    throw new UpgradeReportError("SHA-256 unavailable: Web Crypto (crypto.subtle) is missing in this environment");
  }
  const bytes = new TextEncoder().encode(str);
  const digest = await subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function utf8ByteLength(str) {
  return new TextEncoder().encode(str).length;
}

// ── Safe filenames ──────────────────────────────────────────────────────────
// Reduce any caller-supplied name to a safe basename stem: strip directory
// components (both separators), control characters, and path-hostile chars;
// drop trailing .htm/.html (repeatedly, so no double extension); strip leading
// dots (no dotfiles); fall back to a fixed stem for empty / "." / ".." /
// non-representable names. The stem is length-capped so the upgrade suffix
// always survives intact.
function sanitizeStem(rawName) {
  if (typeof rawName !== "string") return FILENAME_FALLBACK_STEM;
  // Basename: last segment after any / or \ (ignore trailing separators).
  const segments = rawName.split(/[/\\]+/).filter((s) => s.length > 0);
  let stem = segments.length > 0 ? segments[segments.length - 1] : "";
  // Remove ASCII control characters (incl. DEL) outright.
  stem = stem.replace(/[\x00-\x1f\x7f]/g, "");
  // Keep only a conservative, filesystem-safe set; collapse the rest to "_".
  stem = stem.replace(/[^A-Za-z0-9._-]/g, "_");
  // Drop trailing .htm/.html repeatedly so the suffix never doubles up.
  let prev;
  do {
    prev = stem;
    stem = stem.replace(/\.html?$/i, "");
  } while (stem !== prev);
  // No leading dots (avoid dotfiles); collapse leading separators/dots.
  stem = stem.replace(/^[.]+/, "");
  // Collapse runs of underscores produced by sanitization (cosmetic, safe).
  stem = stem.replace(/_{2,}/g, "_").replace(/^_+|_+$/g, "");
  if (stem === "" || stem === "." || stem === "..") return FILENAME_FALLBACK_STEM;
  // Length cap: keep the suffix intact, trim the stem.
  const maxStem = Math.max(1, FILENAME_TOTAL_CAP - REPLACEMENT_SUFFIX.length);
  if (stem.length > maxStem) stem = stem.slice(0, maxStem).replace(/[._-]+$/, "");
  if (stem === "") return FILENAME_FALLBACK_STEM;
  return stem;
}

function safeOriginalName(rawName) {
  // A display-only sanitized echo of the basename (keeps a single extension).
  const stem = sanitizeStem(rawName);
  return stem; // extension intentionally normalized away for display
}

function replacementFilenameFor(rawName) {
  return sanitizeStem(rawName) + REPLACEMENT_SUFFIX;
}

// ── Region derivation (matches P3's EXACT mutation boundaries) ──────────────
// Span mutation region = inspector sentinel offsets EXTENDED LEFT to the start
// of the BEGIN line (the canonical builder owns that leading indentation, e.g.
// markup's four spaces). The extended bytes must be whitespace only. Returns
// null if not (an inconsistent result).
function extendedSpanRange(html, span) {
  if (!span || typeof span.beginStart !== "number" || typeof span.endEnd !== "number") return null;
  const nl = html.lastIndexOf("\n", span.beginStart - 1);
  const lineStart = nl + 1;
  const lead = html.slice(lineStart, span.beginStart);
  if (!/^[ \t]*$/.test(lead)) return null;
  return { start: lineStart, end: span.endEnd };
}

// Byte range of each f3d meta's content VALUE in the strict generated format.
// Returns an ordered array or null if any meta is not present exactly once.
function metaValueRanges(html) {
  const ranges = [];
  for (const name of F3D_META_NAMES) {
    const head = `<meta name="${name}" content="`;
    const re = new RegExp(escapeRegExp(head) + `([^"]*)" \\/>`, "g");
    const found = [];
    let m;
    while ((m = re.exec(html)) !== null) found.push({ index: m.index, value: m[1] });
    if (found.length !== 1) return null;
    const start = found[0].index + head.length;
    ranges.push({ kind: `meta:${name}`, start, end: start + found[0].value.length });
  }
  return ranges;
}

// All nine mutation regions for an html given its inspector span list.
function nineRegions(html, spans) {
  if (!Array.isArray(spans) || spans.length !== BUILDER_RUNTIME_SPANS.length) return null;
  const regions = [];
  for (const span of spans) {
    const r = extendedSpanRange(html, span);
    if (r === null) return null;
    regions.push({ kind: `span:${span.name}`, start: r.start, end: r.end });
  }
  const metas = metaValueRanges(html);
  if (metas === null) return null;
  regions.push(...metas);
  regions.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < regions.length; i++) {
    if (regions[i].start < regions[i - 1].end) return null; // overlap → inconsistent
  }
  return regions;
}

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

// Independent byte-preservation re-verification: re-derive the nine regions on
// the original and patched html and compare the ordered untouched segments
// byte-for-byte (the same method the P3 patcher and tests use). Returns
// { verified, untouchedSegmentCount, detail }.
function verifyPreservation(originalHtml, inspection, resultHtml, postInspection) {
  const inRegions = nineRegions(originalHtml, inspection && inspection.sentinels && inspection.sentinels.spans);
  const outRegions = nineRegions(resultHtml, postInspection && postInspection.sentinels && postInspection.sentinels.spans);
  if (inRegions === null || outRegions === null) {
    return { verified: false, untouchedSegmentCount: 0, detail: "could not re-derive the nine mutation regions" };
  }
  const inKinds = inRegions.map((r) => r.kind).join("|");
  const outKinds = outRegions.map((r) => r.kind).join("|");
  if (inKinds !== outKinds) {
    return { verified: false, untouchedSegmentCount: 0, detail: "mutation-region order differs between input and output" };
  }
  const inSegs = untouchedSegments(originalHtml, inRegions);
  const outSegs = untouchedSegments(resultHtml, outRegions);
  if (inSegs.length !== outSegs.length) {
    return { verified: false, untouchedSegmentCount: 0, detail: "untouched segment count differs" };
  }
  for (let i = 0; i < inSegs.length; i++) {
    if (inSegs[i] !== outSegs[i]) {
      return { verified: false, untouchedSegmentCount: inSegs.length, detail: `untouched segment #${i} differs` };
    }
  }
  return { verified: true, untouchedSegmentCount: inSegs.length, detail: "all untouched byte segments identical" };
}

// ── Mutation detail ─────────────────────────────────────────────────────────
function spanByName(spans, name) {
  if (!Array.isArray(spans)) return null;
  return spans.find((s) => s && s.name === name) || null;
}

// Per-span: replaced (always true for a patch) + actual change (before vs after
// bytes over the EXTENDED region) + UTF-8 byte counts.
function buildSpanMutations(originalHtml, inspection, resultHtml, postInspection) {
  const out = [];
  for (const name of BUILDER_RUNTIME_SPANS) {
    const before = spanByName(inspection.sentinels.spans, name);
    const after = spanByName(postInspection.sentinels.spans, name);
    const beforeRange = before && extendedSpanRange(originalHtml, before);
    const afterRange = after && extendedSpanRange(resultHtml, after);
    if (!beforeRange || !afterRange) {
      throw new UpgradeReportError(`inconsistent patch result: cannot measure span "${name}"`);
    }
    const beforeContent = originalHtml.slice(beforeRange.start, beforeRange.end);
    const afterContent = resultHtml.slice(afterRange.start, afterRange.end);
    out.push({
      name,
      replaced: true,
      changed: beforeContent !== afterContent,
      beforeBytes: utf8ByteLength(beforeContent),
      afterBytes: utf8ByteLength(afterContent),
    });
  }
  return out;
}

// Per-meta: rewritten (always true for a patch) + actual value change + from/to.
function metaValueOf(inspection, name) {
  switch (name) {
    case "f3d-package-schema":
      return inspection.packageSchema === null || inspection.packageSchema === undefined
        ? null
        : String(inspection.packageSchema);
    case "f3d-runtime":
      return inspection.runtimeVersion ?? null;
    case "f3d-capabilities":
      return Array.isArray(inspection.capabilities) ? inspection.capabilities.join(",") : null;
    case "f3d-package-family":
      return inspection.family ?? null;
    default:
      return null;
  }
}

function buildMetaMutations(inspection, postInspection) {
  return F3D_META_NAMES.map((name) => {
    const from = metaValueOf(inspection, name);
    const to = metaValueOf(postInspection, name);
    return { name, rewritten: true, changed: from !== to, from, to };
  });
}

// ── Result-shape guards (fail safe, no uncontrolled TypeError) ──────────────
function isObject(v) {
  return v !== null && typeof v === "object";
}
function looksLikeInspection(i) {
  return isObject(i) && isObject(i.sentinels) && Array.isArray(i.sentinels.spans);
}

// ── buildUpgradeReport ──────────────────────────────────────────────────────
async function buildUpgradeReport({ originalFilename, originalHtml, patchResult } = {}) {
  if (typeof originalHtml !== "string") {
    throw new UpgradeReportError("originalHtml must be a string (the bytes the patcher processed)");
  }
  if (!isObject(patchResult) || typeof patchResult.outcome !== "string") {
    throw new UpgradeReportError("patchResult is malformed (missing a string outcome)");
  }
  const knownOutcomes = Object.values(PATCH_OUTCOMES);
  if (!knownOutcomes.includes(patchResult.outcome)) {
    throw new UpgradeReportError(`patchResult.outcome "${patchResult.outcome}" is not a recognized outcome`);
  }

  const inspection = patchResult.inspection ?? null;
  const manifestNote = isObject(inspection) && typeof inspection.manifestNote === "string"
    ? inspection.manifestNote
    : null;

  const beforeHash = await sha256HexUtf8(originalHtml);

  const base = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    originalFilename: typeof originalFilename === "string" ? originalFilename : null,
    safeOriginalName: safeOriginalName(originalFilename),
    outcome: patchResult.outcome,
    inspectionOutcome: isObject(inspection) ? inspection.outcome ?? null : null,
    runtime: {
      from: isObject(inspection) ? inspection.runtimeVersion ?? null : null,
      to: null,
    },
    schema: {
      from: isObject(inspection) ? inspection.packageSchema ?? null : null,
      to: null,
    },
    family: {
      from: isObject(inspection) ? inspection.family ?? null : null,
      to: null,
    },
    sha256: { before: beforeHash, after: null },
    branding: null,
    mutations: { spans: [], metas: [] },
    preservation: { verified: false, untouchedSegmentCount: 0, detail: "not applicable", applicable: false },
    manifestNote,
    notes: [],
    warnings: manifestNote ? [manifestNote] : [],
    rejection: null,
    replacementFilename: null,
    download: { available: false },
  };

  // ── Rejected ──────────────────────────────────────────────────────────
  if (patchResult.outcome === PATCH_OUTCOMES.REJECTED) {
    base.rejection = {
      code: patchResult.code ?? null,
      message: typeof patchResult.message === "string" ? patchResult.message : null,
      reasons: Array.isArray(patchResult.reasons) ? patchResult.reasons.slice() : [],
    };
    return base;
  }

  // ── Already-current no-op (byte-identical echo) ─────────────────────────
  if (patchResult.outcome === PATCH_OUTCOMES.NOOP_ALREADY_CURRENT) {
    if (typeof patchResult.html !== "string") {
      throw new UpgradeReportError("noop result is malformed (missing echoed html)");
    }
    // A noop is valid only when BOTH the bound source and the echoed output are
    // byte-identical to the original we were handed.
    if (patchResult.sourceHtml !== originalHtml || patchResult.html !== originalHtml) {
      throw new UpgradeReportError("noop result is not bound to this original (sourceHtml/html mismatch)");
    }
    base.sha256.after = await sha256HexUtf8(patchResult.html);
    base.runtime.to = base.runtime.from;
    base.schema.to = base.schema.from;
    base.family.to = base.family.from;
    base.notes = Array.isArray(patchResult.reasons) && patchResult.reasons.length
      ? patchResult.reasons.slice()
      : ["package already advertises the current runtime; no changes needed"];
    return base;
  }

  // ── Patched ─────────────────────────────────────────────────────────────
  const postInspection = patchResult.postInspection ?? null;
  if (
    typeof patchResult.html !== "string" ||
    typeof patchResult.sourceHtml !== "string" ||
    !looksLikeInspection(inspection) ||
    !looksLikeInspection(postInspection) ||
    !isObject(patchResult.branding)
  ) {
    throw new UpgradeReportError("patched result is malformed (missing sourceHtml, html, inspection, postInspection, or branding)");
  }
  // Bind the result to THIS original: the patcher must have consumed exactly the
  // bytes we were handed. This closes the in-region tampering gap — an edit
  // inside an allowed mutation region leaves the untouched segments identical,
  // but changes sourceHtml.
  if (patchResult.sourceHtml !== originalHtml) {
    throw new UpgradeReportError("patched result is not bound to this original (sourceHtml !== originalHtml)");
  }

  // before is the hash of the VERIFIED source (== originalHtml == sourceHtml).
  base.sha256.after = await sha256HexUtf8(patchResult.html);
  base.runtime.to = postInspection.runtimeVersion ?? null;
  base.schema.to = postInspection.packageSchema ?? null;
  base.family.to = postInspection.family ?? null;
  base.branding = {
    accentColor: patchResult.branding.accentColor ?? null,
    hudBgColor: patchResult.branding.hudBgColor ?? null,
  };
  base.mutations.spans = buildSpanMutations(originalHtml, inspection, patchResult.html, postInspection);
  base.mutations.metas = buildMetaMutations(inspection, postInspection);

  const preservation = verifyPreservation(originalHtml, inspection, patchResult.html, postInspection);
  base.preservation = { ...preservation, applicable: true };

  base.notes = Array.isArray(patchResult.reasons) ? patchResult.reasons.slice() : [];
  if (!preservation.verified) {
    base.warnings.push(`byte-preservation re-verification FAILED: ${preservation.detail} — download suppressed`);
  }

  base.replacementFilename = replacementFilenameFor(originalFilename);

  // Download is offered ONLY when the patch is internally consistent AND
  // preservation independently verified.
  base.download.available =
    preservation.verified &&
    base.runtime.to === ATLAS_RUNTIME_VERSION &&
    typeof base.replacementFilename === "string" &&
    base.replacementFilename.length > 0 &&
    typeof base.sha256.after === "string" &&
    HEX64.test(base.sha256.after);

  return base;
}

// ── prepareUpgradeDownload ──────────────────────────────────────────────────
// Authorize a download ONLY for a verified patch whose report is bound to it.
// Re-hashes BOTH patchResult.sourceHtml and patchResult.html and requires them
// to equal report.sha256.before / .after; re-verifies the full inspector /
// post-inspector / runtime / schema / family / preservation contract; and
// recomputes the safe filename rather than trusting report.replacementFilename.
// Any mismatch → null. Never throws.
async function prepareUpgradeDownload(patchResult, report) {
  try {
    if (!isObject(patchResult) || !isObject(report)) return null;

    // Outcomes.
    if (patchResult.outcome !== PATCH_OUTCOMES.PATCHED) return null;
    if (report.outcome !== PATCH_OUTCOMES.PATCHED) return null;
    if (report.download?.available !== true) return null;

    // Bound source + output must both be present strings.
    if (typeof patchResult.sourceHtml !== "string") return null;
    if (typeof patchResult.html !== "string") return null;

    // Inspector / post-inspector contract.
    const inspection = patchResult.inspection;
    const postInspection = patchResult.postInspection;
    if (!isObject(inspection) || inspection.outcome !== "patchable") return null;
    if (!isObject(postInspection) || postInspection.outcome !== "already_current") return null;
    if (!isObject(postInspection.sentinels) || postInspection.sentinels.valid !== true) return null;

    // Source/target metadata must agree with the report AND the current contract.
    if (!isObject(report.runtime) || !isObject(report.schema) || !isObject(report.family)) return null;
    if (report.runtime.from !== inspection.runtimeVersion) return null;
    if (report.runtime.to !== postInspection.runtimeVersion || report.runtime.to !== ATLAS_RUNTIME_VERSION) return null;
    if (report.schema.from !== inspection.packageSchema) return null;
    if (report.schema.to !== postInspection.packageSchema || report.schema.to !== ATLAS_PACKAGE_SCHEMA) return null;
    if (report.family.from !== inspection.family) return null;
    if (report.family.to !== postInspection.family || report.family.to !== "builder") return null;

    // Preservation must have independently verified.
    if (!isObject(report.preservation) || report.preservation.verified !== true) return null;

    // Both hashes must be well-formed and match a fresh re-hash of the bound
    // source AND output — a report built from a different original cannot match.
    if (!isObject(report.sha256)) return null;
    if (typeof report.sha256.before !== "string" || !HEX64.test(report.sha256.before)) return null;
    if (typeof report.sha256.after !== "string" || !HEX64.test(report.sha256.after)) return null;
    const beforeHash = await sha256HexUtf8(patchResult.sourceHtml);
    const afterHash = await sha256HexUtf8(patchResult.html);
    if (beforeHash !== report.sha256.before) return null;
    if (afterHash !== report.sha256.after) return null;

    // Never trust report.replacementFilename — recompute the safe name and
    // require the report's to match it exactly (rejects tampered names like
    // "../../evil.html"); return the freshly-computed safe name regardless.
    const safeFilename = replacementFilenameFor(report.originalFilename);
    if (report.replacementFilename !== safeFilename) return null;

    return {
      filename: safeFilename,
      html: patchResult.html,
      mimeType: DOWNLOAD_MIME_TYPE,
    };
  } catch {
    return null; // fail closed — never expose a download on any error
  }
}

export {
  REPORT_SCHEMA_VERSION,
  DOWNLOAD_MIME_TYPE,
  UpgradeReportError,
  buildUpgradeReport,
  prepareUpgradeDownload,
  // exported for focused tests / reuse:
  sanitizeStem,
  replacementFilenameFor,
};
