// Type surface for atlas-runtime-version.mjs (same dual-import pattern
// as ask-runtime-transformer.d.mts).

export declare const ATLAS_PACKAGE_SCHEMA: number;
export declare const ATLAS_RUNTIME_VERSION: string;
export declare const ATLAS_RUNTIME_CAPABILITIES: string[];
export declare const ATLAS_KNOWN_CAPABILITIES: string[];

/** Families a current generator may stamp into a package. */
export type GeneratedFamily = "atlas" | "builder";
/** All families the Upgrade Center recognizes ("legacy" = a future U1
 *  inspection classification for pre-marker packages, never generated). */
export type PresentationFamily = GeneratedFamily | "legacy";
export declare const GENERATED_FAMILIES: GeneratedFamily[];
export declare const PRESENTATION_FAMILIES: PresentationFamily[];
export declare const F3D_PACKAGE_FAMILY_DEFAULT: GeneratedFamily;

export interface AtlasRuntimeManifestFields {
  package_schema: number;
  runtime_version: string;
  capabilities: string[];
  package_family: GeneratedFamily;
}

/** Omit `family` for atlas (back-compat). An explicit value that is not a
 *  generated family ("", "legacy", or a typo) throws. */
export declare function buildRuntimeManifestFields(
  family?: GeneratedFamily,
): AtlasRuntimeManifestFields;
export declare function buildRuntimeMetaTags(family?: GeneratedFamily): string;
