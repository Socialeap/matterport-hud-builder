// Type declarations for presentation-upgrade-report.mjs (same pattern as the
// other upgrade-engine modules' .d.mts files).

import type { PatchResult } from "./presentation-upgrade-patcher.d.mts";

export type ReportOutcome = "patched" | "noop_already_current" | "rejected";

export interface SpanMutation {
  name: string;
  /** A patch always replaces all five spans. */
  replaced: true;
  /** Whether the replacement actually changed the bytes. */
  changed: boolean;
  beforeBytes: number;
  afterBytes: number;
}

export interface MetaMutation {
  name: string;
  /** A patch always rewrites all four f3d meta values. */
  rewritten: true;
  /** Whether the rewrite actually changed the value. */
  changed: boolean;
  from: string | null;
  to: string | null;
}

export interface PreservationResult {
  verified: boolean;
  untouchedSegmentCount: number;
  detail: string;
  applicable: boolean;
}

export interface UpgradeReport {
  schemaVersion: number;
  originalFilename: string | null;
  safeOriginalName: string;
  outcome: ReportOutcome;
  inspectionOutcome: string | null;
  runtime: { from: string | null; to: string | null };
  schema: { from: number | null; to: number | null };
  family: { from: string | null; to: string | null };
  sha256: { before: string; after: string | null };
  branding: { accentColor: string | null; hudBgColor: string | null } | null;
  mutations: { spans: SpanMutation[]; metas: MetaMutation[] };
  preservation: PreservationResult;
  manifestNote: string | null;
  /** Informational details of a successful patch (NOT warnings). */
  notes: string[];
  /** Manifest limitation, failed preservation, and other cautionary items. */
  warnings: string[];
  rejection: { code: string | null; message: string | null; reasons: string[] } | null;
  replacementFilename: string | null;
  download: { available: boolean };
}

export interface DownloadPayload {
  filename: string;
  html: string;
  mimeType: "text/html";
}

export declare const REPORT_SCHEMA_VERSION: number;
export declare const DOWNLOAD_MIME_TYPE: "text/html";

/** Documented report-layer error (malformed result or SHA-256 unavailable). */
export declare class UpgradeReportError extends Error {
  name: "UpgradeReportError";
}

/**
 * Build the audit report. Async because SHA-256 uses Web Crypto. Throws
 * UpgradeReportError on a malformed patchResult or when SHA-256 is
 * unavailable — never returns a placeholder hash.
 */
export declare function buildUpgradeReport(args: {
  originalFilename?: string;
  originalHtml: string;
  patchResult: PatchResult;
}): Promise<UpgradeReport>;

/**
 * Return the downloadable payload (the exact validated patchResult.html) only
 * when the result is a verified patch and the report is bound to that html
 * (re-hash equals report.sha256.after). Returns null for any rejected/noop/
 * inconsistent case. Never throws.
 */
export declare function prepareUpgradeDownload(
  patchResult: PatchResult,
  report: UpgradeReport,
): Promise<DownloadPayload | null>;

export declare function sanitizeStem(rawName: unknown): string;
export declare function replacementFilenameFor(rawName: unknown): string;
