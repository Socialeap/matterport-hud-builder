// Type declarations for presentation-upgrade-session.mjs (same pattern as the
// other upgrade-engine modules' .d.mts files).

import type { InspectionReport } from "./presentation-upgrade-patcher.mjs";
import type { UpgradeReport, DownloadPayload } from "./presentation-upgrade-report.mjs";

// Re-exported for the admin route's single import surface.
export type { InspectionReport } from "./presentation-upgrade-patcher.mjs";
export type { UpgradeReport, DownloadPayload } from "./presentation-upgrade-report.mjs";

export interface UploadClassification {
  accepted: boolean;
  /** Empty when accepted; a user-facing reason when rejected. */
  message: string;
}

export type DispositionTone = "action" | "success" | "warning" | "info" | "error";

export interface DispositionDescriptor {
  /** One of the inspector outcomes (invalid for any unrecognized value). */
  outcome: string;
  tone: DispositionTone;
  /** True ONLY for the `patchable` outcome. */
  canUpgrade: boolean;
  headline: string;
  guidance: string;
}

export type UpgradeSessionOutcome =
  | "patched"
  | "noop_already_current"
  | "rejected"
  | "error";

export interface UpgradeSessionResult {
  outcome: UpgradeSessionOutcome;
  /** The audit report, or null only on an unexpected error. */
  report: UpgradeReport | null;
  /** The validated download payload, or null when not downloadable. */
  download: DownloadPayload | null;
  /** True iff a verified, report-authorized download payload is present. */
  downloadable: boolean;
  /** Operator-facing reason a download is unavailable, or null when downloadable. */
  error: string | null;
}

/** Classify a selected file as an accepted presentation HTML upload or not. */
export declare function classifyUpload(file: {
  name?: unknown;
  type?: unknown;
}): UploadClassification;

/** Map an inspection report to its canonical disposition descriptor. */
export declare function describeDisposition(
  inspection: InspectionReport | null | undefined,
): DispositionDescriptor;

/**
 * Orchestrate patch → report → download for a presentation. `runtimeSources`
 * are injected by the caller (never read from the upload). Never throws;
 * authorizes a download only for a verified, report-bound patch.
 */
export declare function runUpgradeSession(args: {
  filename?: string | null;
  html: string;
  runtimeSources: { liveSessionJs: string; annoInputJs: string };
}): Promise<UpgradeSessionResult>;

/** Re-export of the pure inspector for a single import surface. */
export declare function inspectPresentationHtml(html: unknown): InspectionReport;
