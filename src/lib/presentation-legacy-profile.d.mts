// Type declarations for presentation-legacy-profile.mjs.

export interface LegacyProfileRegion {
  key: string;
  op: "replace" | "rewrite" | "insert";
  start: number;
  end: number;
}

export interface LegacyProfileReport {
  profileId: string;
  recognized: boolean;
  supported: boolean;
  confidence: number;
  reasons: string[];
  capabilities: string[];
  branding: { accentColor: string; hudBgColor: string } | null;
  protected: boolean;
  regions: LegacyProfileRegion[] | null;
}

export declare const LEGACY_PROFILE_ID: string;
export declare const META_INSERT_ANCHOR: string;
export declare const PEERJS_TAG: string;
export declare const IFRAME_MP: string;
export declare const IFRAME_MP_GHOST: string;
export declare const REQUIRED_CHROME_IDS: readonly string[];
export declare const REQUIRED_WINDOW_HELPERS: readonly string[];
export declare const REGION_ANCHORS: Readonly<Record<string, Readonly<Record<string, string>>>>;
export declare const BRANDING: Readonly<Record<string, { prefix: string; suffix: string }>>;

/** Pure, inert recognition of the exact builder-may2026-f8f68f0 profile. */
export declare function inspectLegacyProfile(html: unknown): LegacyProfileReport;
