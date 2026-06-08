// Type surface for atlas-runtime-version.mjs (same dual-import pattern
// as ask-runtime-transformer.d.mts).

export declare const ATLAS_PACKAGE_SCHEMA: number;
export declare const ATLAS_RUNTIME_VERSION: string;
export declare const ATLAS_RUNTIME_CAPABILITIES: string[];
export declare const ATLAS_KNOWN_CAPABILITIES: string[];

/** Which generator/adapter produced a package. */
export type PresentationFamily = "atlas" | "builder" | "legacy";
export declare const PRESENTATION_FAMILIES: PresentationFamily[];
export declare const F3D_PACKAGE_FAMILY_DEFAULT: PresentationFamily;

export interface AtlasRuntimeManifestFields {
  package_schema: number;
  runtime_version: string;
  capabilities: string[];
  package_family: PresentationFamily;
}

export declare function buildRuntimeManifestFields(
  family?: PresentationFamily,
): AtlasRuntimeManifestFields;
export declare function buildRuntimeMetaTags(family?: PresentationFamily): string;
