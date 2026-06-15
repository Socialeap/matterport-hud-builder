// Type declarations for presentation-legacy-bootstrap.mjs.

import type { LegacyProfileReport } from "./presentation-legacy-profile.mjs";
import type { InspectionReport } from "./presentation-upgrade-patcher.mjs";

export type LegacyBootstrapOutcome = "bootstrapped" | "rejected";

export interface LegacyBootstrapResult {
  outcome: LegacyBootstrapOutcome;
  code: string | null;
  message: string;
  /** The exact immutable input (string), or null for non-string input. */
  sourceHtml: string | null;
  /** The bootstrapped current-contract HTML, or null when rejected. */
  html: string | null;
  profileId: string | null;
  branding: { accentColor: string; hudBgColor: string } | null;
  capabilities: string[];
  regions: Array<{ key: string; op: string; start: number; end: number }> | null;
  /** The legacy profile report this result was produced from. */
  inspection: LegacyProfileReport | null;
  /** Current-inspector reinspection of the output (already_current on success). */
  postInspection: InspectionReport | null;
}

export declare const LEGACY_BOOTSTRAP_OUTCOMES: Readonly<Record<string, LegacyBootstrapOutcome>>;
export declare const LEGACY_BOOTSTRAP_CODES: Readonly<Record<string, string>>;
export declare const CURRENT_IFRAME_MP: string;
export declare const CURRENT_IFRAME_MP_GHOST: string;

/**
 * Pure, deterministic bootstrap of the exact builder-may2026-f8f68f0 profile to
 * the current versioned contract. Replaces only the proven runtime regions with
 * the current canonical runtime (built from the trusted bundled sources) and
 * inserts the four f3d metas; preserves every other byte (protected blob, token,
 * QA, model ids, branding, analytics, assets). Fail-closed: any integrity check
 * failure → outcome "rejected", html null. Never executes/decrypts the input.
 */
export declare function bootstrapLegacyPresentation(
  html: unknown,
  runtimeSources: { liveSessionJs: string; annoInputJs: string },
): LegacyBootstrapResult;
