// Type declarations for presentation-upgrade-patcher.mjs (same pattern as
// atlas-runtime-version.d.mts / builder-runtime-spans.d.mts).

export type PatchOutcome = "patched" | "noop_already_current" | "rejected";

export type RejectionCode =
  | "future_version"
  | "atlas_managed"
  | "legacy_unsupported"
  | "invalid"
  | "not_a_string"
  | "runtime_sources_invalid"
  | "branding_not_recoverable"
  | "mutation_region_conflict"
  | "post_validation_failed"
  | "byte_preservation_violation";

export interface InspectionReport {
  outcome: string;
  reasons: string[];
  family: string | null;
  packageSchema: number | null;
  runtimeVersion: string | null;
  currentRuntimeVersion: string;
  v1PatchSourceVersions: string[];
  capabilities: string[] | null;
  protected: boolean;
  assets: string[];
  sentinels: {
    valid: boolean;
    issues: string[];
    spans: Array<{
      name: string;
      beginStart: number;
      beginEnd: number;
      endStart: number;
      endEnd: number;
    }>;
  };
  manifestNote: string;
}

export interface PatchResult {
  outcome: PatchOutcome;
  code: RejectionCode | null;
  message: string;
  reasons: string[];
  inspection: InspectionReport | null;
  branding: { accentColor: string; hudBgColor: string } | null;
  html: string | null;
  postInspection: InspectionReport | null;
}

export interface BrandingAnchor {
  id: string;
  channel: "accent" | "hudBg";
  prefix: string;
  suffix: string;
}

export declare const PATCH_OUTCOMES: {
  readonly PATCHED: "patched";
  readonly NOOP_ALREADY_CURRENT: "noop_already_current";
  readonly REJECTED: "rejected";
};

export declare const REJECTION_CODES: Readonly<Record<string, RejectionCode>>;
export declare const REJECTION_MESSAGES: Readonly<Record<RejectionCode, string>>;
export declare const EXPECTED_MUTATION_REGION_COUNT: number;
export declare const BRANDING_ANCHORS: readonly BrandingAnchor[];
export declare const ANCHOR_CHANNEL_TOKEN: {
  readonly accent: string;
  readonly hudBg: string;
};

export declare function normalizeHexColor(raw: string): string | null;

// A successful patch requires the current Frontiers3D runtime sources, supplied
// by the trusted application bundle. Omitting them (or passing empty values) is
// a fail-closed `runtime_sources_invalid` rejection at runtime; the type makes
// the requirement explicit for callers.
export declare function patchPresentationHtml(
  html: string,
  runtimeSources: { liveSessionJs: string; annoInputJs: string },
): PatchResult;
