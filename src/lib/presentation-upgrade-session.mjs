// Presentation Upgrade Session (P5) — pure orchestration core for the admin
// Presentation Upgrade Center. It wires the approved engine together for the
// UI WITHOUT any DOM, React, file, or network access and WITHOUT importing the
// browser-only `?raw` runtime-source adapter:
//
//   inspect → describe disposition → (on a patchable package) patch → report →
//   authorize download.
//
// `runtimeSources` are INJECTED by the caller. The browser route supplies the
// bundled trusted sources via the client-bundle-safe adapter; tests supply the
// stripped runtime module sources. This module never accepts runtime JS from an
// uploaded file or user input, and never weakens the engine's own validation —
// it only composes inspector + patcher + report, all of which fail closed.
//
// Because it is pure (the only async step is SHA-256 inside the report layer)
// and DOM-free, the security-critical decision — when a download is authorized
// — is exercised directly under the repo's pure-Node test runner.

import { inspectPresentationHtml } from "./presentation-upgrade-inspector.mjs";
import {
  patchPresentationHtml,
  PATCH_OUTCOMES,
} from "./presentation-upgrade-patcher.mjs";
import {
  buildUpgradeReport,
  prepareUpgradeDownload,
} from "./presentation-upgrade-report.mjs";
import { ATLAS_RUNTIME_VERSION } from "./atlas-runtime-version.mjs";

// ── Upload classification (pure; no File/DOM access) ────────────────────────
// Accept a single presentation index.html by extension or text/html MIME type.
// ZIP packages are explicitly out of scope for P5 and get a specific message.
const ACCEPTED_HTML_EXTENSIONS = [".html", ".htm"];

function classifyUpload({ name, type } = {}) {
  const safeName = typeof name === "string" ? name : "";
  const lower = safeName.toLowerCase();
  const isHtmlExt = ACCEPTED_HTML_EXTENSIONS.some((ext) => lower.endsWith(ext));
  const isHtmlType = typeof type === "string" && type.toLowerCase() === "text/html";
  if (isHtmlExt || isHtmlType) {
    return { accepted: true, message: "" };
  }
  if (lower.endsWith(".zip")) {
    return {
      accepted: false,
      message:
        "ZIP packages aren't supported here — unzip it and select the presentation's index.html file.",
    };
  }
  return {
    accepted: false,
    message: "Select the presentation's index.html file (a single .html file).",
  };
}

// ── Disposition descriptor (pure; canonical operator-facing copy) ───────────
// One descriptor per inspector outcome, so every disposition renders an
// explicit state and exactly the actions it allows. `canUpgrade` is true ONLY
// for `patchable`; nothing else ever exposes the upgrade command.
function describeDisposition(inspection) {
  const outcome =
    inspection && typeof inspection.outcome === "string" ? inspection.outcome : "invalid";
  const from = inspection && inspection.runtimeVersion ? inspection.runtimeVersion : null;
  const target = ATLAS_RUNTIME_VERSION;

  switch (outcome) {
    case "patchable":
      return {
        outcome,
        tone: "action",
        canUpgrade: true,
        headline: `Upgrade available: ${from} → ${target}`,
        guidance: `This Builder presentation runs runtime ${from}. It can be upgraded in place to the current runtime ${target}.`,
      };
    case "already_current":
      return {
        outcome,
        tone: "success",
        canUpgrade: false,
        headline: `Already current (${target})`,
        guidance: `This presentation already runs the current runtime ${target}. No update is needed.`,
      };
    case "future_version":
      return {
        outcome,
        tone: "warning",
        canUpgrade: false,
        headline: "Newer than this tool",
        guidance: `This package advertises a runtime/schema newer than this build understands (current ${target}). Downgrading is prohibited — update the tool, never the package.`,
      };
    case "atlas_managed":
      return {
        outcome,
        tone: "info",
        canUpgrade: false,
        headline: "Atlas-managed showcase",
        guidance:
          "This is an Atlas curated showcase. Upgrade it by regenerating and republishing through Atlas curation (its GitHub source + redeploy), never by single-file patch.",
      };
    case "legacy_unsupported":
      return {
        outcome,
        tone: "warning",
        canUpgrade: false,
        headline: "Legacy package — regenerate",
        guidance:
          "This is a recognizable 3DPS presentation, but from a generation this tool can't deterministically patch. Regenerate it from the Builder to get the current runtime.",
      };
    case "invalid":
    default:
      return {
        outcome: "invalid",
        tone: "error",
        canUpgrade: false,
        headline: "Not a supported presentation",
        guidance:
          "This file isn't a supported Frontiers3D presentation (missing or tampered markers, or not a 3DPS export). It can't be upgraded.",
      };
  }
}

// ── Upgrade orchestration ───────────────────────────────────────────────────
// Run patch → report → download for a presentation. Returns a single UI-ready
// result. A download is authorized ONLY when the patch is a verified `patched`
// outcome AND the report independently authorizes it AND prepareUpgradeDownload
// returns a payload — every other path (rejected, no-op, contract/preservation
// failure, or an unexpected error) yields `downloadable: false` with a clear
// operator-facing reason. Never throws.
async function runUpgradeSession({ filename, html, runtimeSources } = {}) {
  try {
    if (typeof html !== "string") {
      return errorResult("No presentation HTML to upgrade.");
    }

    const patchResult = patchPresentationHtml(html, runtimeSources);
    const report = await buildUpgradeReport({
      originalFilename: filename ?? undefined,
      originalHtml: html,
      patchResult,
    });

    let download = null;
    if (
      patchResult.outcome === PATCH_OUTCOMES.PATCHED &&
      report.download &&
      report.download.available === true
    ) {
      download = await prepareUpgradeDownload(patchResult, report);
    }

    const downloadable = download !== null && report.download?.available === true;
    return {
      outcome: patchResult.outcome,
      report,
      download,
      downloadable,
      error: downloadable ? null : reasonNoDownload(patchResult, report),
    };
  } catch (err) {
    // Any validation / source-binding / hashing / contract failure surfaces as
    // a controlled error with the download suppressed.
    return errorResult(
      err && err.message ? String(err.message) : "Upgrade failed unexpectedly.",
    );
  }
}

function reasonNoDownload(patchResult, report) {
  if (patchResult.outcome === PATCH_OUTCOMES.REJECTED) {
    return (
      (report && report.rejection && report.rejection.message) ||
      "This presentation can't be upgraded."
    );
  }
  if (patchResult.outcome === PATCH_OUTCOMES.NOOP_ALREADY_CURRENT) {
    return "Already current — no upgrade needed.";
  }
  // A `patched` outcome that still isn't downloadable means a contract or
  // byte-preservation gate failed in the report layer; surface that warning.
  const warning =
    report && Array.isArray(report.warnings)
      ? report.warnings.find((w) => /preservation|suppress/i.test(w))
      : null;
  return warning || "Upgrade validation failed — download suppressed.";
}

function errorResult(message) {
  return {
    outcome: "error",
    report: null,
    download: null,
    downloadable: false,
    error: message,
  };
}

export {
  classifyUpload,
  describeDisposition,
  runUpgradeSession,
  // Re-exported so the route has a single import surface for inspect + upgrade.
  inspectPresentationHtml,
};
