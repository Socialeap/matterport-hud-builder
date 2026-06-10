// Server-side loader for the shared mobile-input annotation kernel.
//
// Reads `anno-input.mjs` verbatim via Vite's `?raw` import (inlined at
// build time, works on both Node dev and Cloudflare Workers prod), strips
// its single trailing `export { ... }` block, and hands the result to
// portal.functions.ts which interpolates it into the outer IIFE of the
// generated standalone HTML — the same pattern as ./live-session-source.ts
// and the Ask AI runtime in ./ask-runtime-assembler.ts.
//
// The injected helpers (createAnnoPointerGuard, annoCollectPoints,
// annoClampDpr, annoBudgetDpr, annoIsIosWebKit, annoIsCoarsePointer,
// annoCollabEligible, annoBindViewportEvents) become plain locals inside
// that IIFE so the Builder annotation glue can call them directly. This is the SAME module
// the Atlas live-tour runtime consumes, so the input state machine never
// forks between the two presentation families.

import annoInputSource from "./anno-input.mjs?raw";
import {
  findForbiddenTokens,
  stripExports,
} from "./ask-runtime-transformer.mjs";

let _cached: string | null = null;

/**
 * Build the shared annotation-input runtime JS blob once per process. The
 * returned string is safe to inject as a child of an outer IIFE — all
 * declared helpers become locals there. Throws if the source contains
 * tokens that would break browser execution (TypeScript leaks, stray
 * imports, leftover module markers) so a regression in the .mjs is caught
 * before HTML generation rather than at runtime.
 */
export function getAnnoInputRuntimeJS(): string {
  if (_cached !== null) return _cached;
  const stripped = stripExports(annoInputSource);
  const offenders = findForbiddenTokens(stripped);
  if (offenders.length > 0) {
    throw new Error(
      `anno-input.mjs contains browser-unsafe tokens:\n  ${offenders.join("\n  ")}`,
    );
  }
  _cached = stripped;
  return stripped;
}
