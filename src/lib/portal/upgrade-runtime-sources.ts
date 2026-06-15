// Browser-bundle-safe adapter that supplies the TRUSTED current runtime
// sources to the Presentation Upgrade engine (P5 admin route).
//
// It reuses the SAME pure `?raw` loaders the HTML generator uses
// (getLiveSessionRuntimeJS / getAnnoInputRuntimeJS) — which inline the
// runtime `.mjs` modules at build time and strip their trailing export blocks
// — so the patcher reproduces the canonical current runtime byte-for-byte.
//
// It deliberately does NOT import `portal.functions.ts` (server-only:
// createServerFn, request context, Supabase auth, rate limiting) and never
// reads runtime JavaScript from an uploaded file or any user input. The two
// `*-source.ts` loaders it calls are pure TypeScript with no server imports,
// so this module is safe in the client bundle.

import { getLiveSessionRuntimeJS } from "./live-session-source";
import { getAnnoInputRuntimeJS } from "./anno-input-source";

export interface BundledRuntimeSources {
  liveSessionJs: string;
  annoInputJs: string;
}

/**
 * The trusted `{ liveSessionJs, annoInputJs }` pair the P3 patcher requires,
 * built from the application bundle. Throws only if a runtime `.mjs` regressed
 * into browser-unsafe tokens — a build-time/source-loader guard caught by
 * `verify:html` long before this route ever runs.
 */
export function getBundledRuntimeSources(): BundledRuntimeSources {
  return {
    liveSessionJs: getLiveSessionRuntimeJS(),
    annoInputJs: getAnnoInputRuntimeJS(),
  };
}
