// Type surface for atlas-runtime-version.mjs (same dual-import pattern
// as ask-runtime-transformer.d.mts).

export declare const ATLAS_PACKAGE_SCHEMA: number;
export declare const ATLAS_RUNTIME_VERSION: string;
export declare const ATLAS_RUNTIME_CAPABILITIES: string[];
export declare const ATLAS_KNOWN_CAPABILITIES: string[];

export interface AtlasRuntimeManifestFields {
  package_schema: number;
  runtime_version: string;
  capabilities: string[];
}

export declare function buildRuntimeManifestFields(): AtlasRuntimeManifestFields;
export declare function buildRuntimeMetaTags(): string;
