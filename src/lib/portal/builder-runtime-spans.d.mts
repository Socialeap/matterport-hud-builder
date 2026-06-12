// Type declarations for builder-runtime-spans.mjs (same pattern as
// atlas-runtime-version.d.mts / ask-runtime-transformer.d.mts).

export declare function escapeHtml(str: string): string;

export declare const BUILDER_SPAN_CANONICAL_ORDER: readonly [
  "css",
  "dep:peerjs",
  "markup",
  "js:kernel",
  "js:glue",
];

export declare function buildBuilderCssSpan(branding: {
  accentColor: string;
  hudBgColor: string;
}): string;

export declare const BUILDER_DEP_PEERJS_SPAN: string;

export declare const BUILDER_MARKUP_SPAN: string;

export declare function buildBuilderJsKernelSpan(sources: {
  liveSessionJs: string;
  annoInputJs: string;
}): string;

export declare const BUILDER_JS_GLUE_SPAN: string;
