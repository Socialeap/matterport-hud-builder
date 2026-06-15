// Type declarations for presentation-upgrade-session.mjs (same pattern as the
// other upgrade-engine modules' .d.mts files).

import type { InspectionReport } from "./presentation-upgrade-patcher.mjs";
import type { UpgradeReport, DownloadPayload } from "./presentation-upgrade-report.mjs";
import type { LegacyProfileReport } from "./presentation-legacy-profile.mjs";

// Re-exported for the admin route's single import surface.
export type { InspectionReport } from "./presentation-upgrade-patcher.mjs";
export type { UpgradeReport, DownloadPayload } from "./presentation-upgrade-report.mjs";
export type { LegacyProfileReport } from "./presentation-legacy-profile.mjs";

export interface UploadClassification {
  accepted: boolean;
  /** Empty when accepted; a user-facing reason when rejected. */
  message: string;
}

export type DispositionTone = "action" | "success" | "warning" | "info" | "error";

export interface DispositionDescriptor {
  /** Inspector outcome, or "legacy_recognized" for a matched bootstrap profile. */
  outcome: string;
  tone: DispositionTone;
  /** True for `patchable` and for a recognized legacy bootstrap profile only. */
  canUpgrade: boolean;
  headline: string;
  guidance: string;
  /** Present only for a recognized legacy profile. */
  legacy?: { profileId: string; capabilities: string[] };
}

/** Operator-facing report for a legacy bootstrap (distinct from UpgradeReport). */
export interface LegacyBootstrapReport {
  mode: "legacy";
  profileId: string | null;
  generationLabel: string;
  outcome: "bootstrapped" | "rejected";
  inspectionOutcome: "legacy_recognized";
  runtime: { from: string | null; to: string | null };
  schema: { from: number | null; to: number | null };
  family: { from: string | null; to: string | null };
  sha256: { before: string; after: string | null };
  branding: { accentColor: string; hudBgColor: string } | null;
  capabilities: string[];
  regions: Array<{ key: string; op: string }>;
  preservation: { verified: boolean; detail: string };
  manifestNote: string;
  warnings: string[];
  notes: string[];
  rejection: { code: string | null; message: string } | null;
  originalFilename: string | null;
  replacementFilename: string | null;
  download: { available: boolean };
}

export type UpgradeSessionKind = "patch" | "legacy" | "error";
export type UpgradeSessionOutcome =
  | "patched"
  | "noop_already_current"
  | "rejected"
  | "bootstrapped"
  | "error";

export interface UpgradeSessionResult {
  /** Which engine path produced this result. */
  kind: UpgradeSessionKind;
  outcome: UpgradeSessionOutcome;
  /** UpgradeReport for kind "patch", LegacyBootstrapReport for "legacy", null on error. */
  report: UpgradeReport | LegacyBootstrapReport | null;
  download: DownloadPayload | null;
  downloadable: boolean;
  error: string | null;
}

/** Classify a selected file as an accepted presentation HTML upload or not. */
export declare function classifyUpload(file: {
  name?: unknown;
  type?: unknown;
}): UploadClassification;

/**
 * Map an inspection report (and, for a legacy_unsupported file, an optional
 * legacy-profile report) to its canonical disposition descriptor.
 */
export declare function describeDisposition(
  inspection: InspectionReport | null | undefined,
  legacyProfile?: LegacyProfileReport | null,
): DispositionDescriptor;

/**
 * Orchestrate the upgrade. Routes a recognized legacy profile through the
 * bootstrap adapter, otherwise the versioned patcher. `runtimeSources` are
 * injected (never read from the upload). Never throws.
 */
export declare function runUpgradeSession(args: {
  filename?: string | null;
  html: string;
  runtimeSources: { liveSessionJs: string; annoInputJs: string };
}): Promise<UpgradeSessionResult>;

/** Re-export of the pure current inspector for a single import surface. */
export declare function inspectPresentationHtml(html: unknown): InspectionReport;

/** Re-export of the pure legacy profile inspector. */
export declare function inspectLegacyProfile(html: unknown): LegacyProfileReport;
