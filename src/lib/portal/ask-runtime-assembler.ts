// Server-only assembler that composes the Ask AI runtime JS string for
// embedding in the generated HTML.
//
// Single source of truth: the three .mjs modules are read verbatim via
// Vite's `?raw` import (inlined at build time, works on both Node dev
// and Cloudflare Workers prod). The pure transformer lives in
// ./ask-runtime-transformer.mjs so the same logic runs under Vite AND
// under the Node build guard (scripts/verify-portal-html.mjs) — no
// duplicated code, no drift.

import askIntentsSource from "./ask-intents.mjs?raw";
import propertyBrainSource from "./property-brain.mjs?raw";
import askRuntimeLogicSource from "./ask-runtime-logic.mjs?raw";
import {
  assembleFromSources,
  findForbiddenTokens,
  stripExports,
} from "./ask-runtime-transformer.mjs";

let _cached: string | null = null;

/**
 * Build the Ask AI runtime JS blob once per process. The result is the
 * concatenation of the three .mjs sources with their single final
 * `export { ... }` block stripped. Callers interpolate the output into
 * the outer IIFE of the generated HTML — all symbols become locals.
 */
export function assembleAskRuntimeJS(): string {
  if (_cached !== null) return _cached;
  const out = assembleFromSources(
    askIntentsSource,
    propertyBrainSource,
    askRuntimeLogicSource,
  );
  _cached = out;
  return out;
}

// Re-exports for the Node build guard — lets the verify script use the
// same stripper and scanner without a second copy.
export { assembleFromSources, findForbiddenTokens, stripExports };
