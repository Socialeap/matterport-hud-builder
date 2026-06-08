/**
 * Atlas Curated Showcase — "Explore Together" (Shared Tour) shell assembler.
 *
 * Produces the minimal, self-contained Live Tour UI (CSS + markup + runtime
 * <script>) that the curated showcase page (atlas-curation-server.ts) splices
 * into its otherwise-static index.html. It REUSES the tested live-session
 * controller via getLiveSessionRuntimeJS() and the self-contained glue in
 * atlas-live-tour-runtime.mjs — no portal export runtime is copied.
 *
 * The complex runtime JS lives in atlas-live-tour-runtime.mjs (loaded via
 * Vite's ?raw import, same as the Ask AI and live-session runtimes). Keeping
 * it out of a TS template literal means single backslashes stay correct and
 * the file is real, parseable, lintable JS — so the backslash-doubling
 * hazard that the verify-portal-html guard exists to catch cannot occur here.
 *
 * Server-only by association: imported by atlas-curation-server.ts, which is
 * reached exclusively via dynamic import inside server-fn handlers, so it
 * never enters the client bundle.
 */
import { getLiveSessionRuntimeJS } from "./portal/live-session-source";
import atlasLiveTourGlueSource from "./atlas-live-tour-runtime.mjs?raw";
import annoInputSource from "./portal/anno-input.mjs?raw";
import {
  findForbiddenTokens,
  stripExports,
} from "./portal/ask-runtime-transformer.mjs";

let _glueCache: string | null = null;
let _annoInputCache: string | null = null;

/**
 * Validate + return the Atlas Live Tour glue runtime. Same anti-drift gate
 * as getLiveSessionRuntimeJS(): a TypeScript leak, stray import, or leftover
 * export in the .mjs throws here (at HTML-generation time) instead of at the
 * visitor's browser.
 */
export function getAtlasLiveTourGlueJS(): string {
  if (_glueCache !== null) return _glueCache;
  const stripped = stripExports(atlasLiveTourGlueSource);
  const offenders = findForbiddenTokens(stripped);
  if (offenders.length > 0) {
    throw new Error(
      `atlas-live-tour-runtime.mjs contains browser-unsafe tokens:\n  ${offenders.join("\n  ")}`,
    );
  }
  _glueCache = stripped;
  return stripped;
}

/**
 * Validate + return the shared mobile-input helpers (portal/anno-input.mjs).
 * Injected between the live-session controller and the glue so the glue can
 * call them as plain locals. Same anti-drift gate as the other runtimes —
 * designed for reuse by the portal export glue when it adopts the v2 input
 * path, so the pointer state machine never forks between surfaces.
 */
export function getAnnoInputJS(): string {
  if (_annoInputCache !== null) return _annoInputCache;
  const stripped = stripExports(annoInputSource);
  const offenders = findForbiddenTokens(stripped);
  if (offenders.length > 0) {
    throw new Error(
      `anno-input.mjs contains browser-unsafe tokens:\n  ${offenders.join("\n  ")}`,
    );
  }
  _annoInputCache = stripped;
  return stripped;
}

export interface AtlasLiveTourStop {
  name: string;
  ss: string;
  sr?: string;
}

export interface AtlasLiveTourOptions {
  /** Accent color (hex) used for buttons, the remote pointer, and the pulse pill. */
  accentColor: string;
  /** The Matterport embed URL used as the teleport rewrite base (e.g. `https://my.matterport.com/show/?m=<id>&play=1`). */
  matterportEmbedSrc: string;
  /** Human title used in the share/invite copy. */
  shareTitle: string;
  /** Optional pre-saved tour stops. Atlas showcases carry none today, so the panel shows a friendly empty note. */
  stops?: AtlasLiveTourStop[];
}

export interface AtlasLiveTourAssets {
  /** Goes in <head>: the deferred PeerJS UMD tag. */
  headHtml: string;
  /** Raw CSS (no <style> wrapper) — the caller inlines it in its stylesheet. */
  css: string;
  /** The "Explore Together" launch button for the top bar. */
  launchButtonHtml: string;
  /** Overlay markup spliced INSIDE the #anno-letterbox-wrap, after the iframe. */
  stageOverlayHtml: string;
  /** Annotation toolbar strip; place between the page header and the stage so it never overlays the Matterport iframe. Hidden until a live session is active. */
  toolbarHtml: string;
  /** The control panel + status chip + location-sync pill + audio sink (near </body>). */
  bodyHtml: string;
  /** Config + runtime <script> blocks (placed last, before </body>). */
  scriptHtml: string;
}

const PEERJS_TAG =
  '<!-- PeerJS UMD bundle (deferred CDN load). Consumed by the Explore\n' +
  "     Together controller below. Failure to load is tolerated: the\n" +
  "     controller surfaces a friendly error state and the static tour\n" +
  "     keeps working. Pinned to an exact version with SRI so the CDN\n" +
  "     cannot serve different bytes than the ones this package was\n" +
  '     generated against (floating @1.5 had no integrity check). -->\n' +
  '<script src="https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js" integrity="sha384-x0YgkOr/3UOZP2CRDxGW9e0Q+2Qjyr3uJrm4xU32Y7ZCNAo7Cc7bjhrZMi/dwczu" crossorigin="anonymous" defer></script>';

/** JSON for safe embedding inside an inline <script> (no </script> / U+2028/9 breakout). */
function safeJsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildCss(accent: string): string {
  // accent is a server-controlled hex string; inlined as a CSS var.
  return `
:root{--lt-accent:${accent}}

/* ── Letterbox + annotation overlay ───────────────────────────────── */
#anno-letterbox-wrap{position:absolute;inset:0}
/* 2.0.2 wrapper fix: stage gesture hardening engages ONLY while an
   annotation tool is active (body.anno-tool-active, toggled by
   setToolMode) so Matterport navigation is untouched otherwise. */
body.anno-tool-active #anno-letterbox-wrap{touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
#anno-letterbox-wrap iframe{width:100%;height:100%;border:none;display:block}
#anno-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none;z-index:5;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
#anno-canvas.pointer-mode,#anno-canvas.draw-mode,#anno-canvas.rope-mode{pointer-events:auto;cursor:crosshair}
#remote-pointer{position:absolute;left:0;top:0;width:18px;height:18px;border-radius:50%;background:var(--lt-accent);border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.45);pointer-events:none;transform:translate(-50%,-50%);z-index:6;display:none}
#lt-navlock{position:absolute;inset:0;z-index:4;background:transparent;cursor:not-allowed;display:none;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
body.live-tour-active #lt-navlock.locked{display:block}
body.live-tour-active #anno-letterbox-wrap:has(#lt-navlock.locked) #matterport-frame{pointer-events:none}

#anno-toolbar{display:none;justify-content:center;align-items:center;flex-wrap:wrap;gap:6px;padding:8px 12px;background:rgba(10,12,20,0.92);border-bottom:1px solid rgba(255,255,255,0.08);position:relative;z-index:1250;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
body.live-tour-active #anno-toolbar{display:flex}
.anno-tool-btn{appearance:none;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.85);border-radius:6px;padding:6px 10px;font:600 12px/1 inherit;cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:background 0.15s,border-color 0.15s,color 0.15s;font-family:inherit;-webkit-tap-highlight-color:transparent}
.anno-tool-btn:hover{background:rgba(255,255,255,0.14);color:#fff}
.anno-tool-btn.active{background:var(--lt-accent);border-color:var(--lt-accent);color:#fff}
.anno-color-wrap{display:inline-flex;align-items:center;gap:4px;padding:0 2px 0 6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);border-radius:6px}
.anno-color-swatch{display:inline-block;width:12px;height:12px;border-radius:50%;background:#ff3b30;border:1px solid rgba(255,255,255,0.6);box-shadow:0 0 0 1px rgba(0,0,0,0.3)}
.anno-color-select{appearance:none;-webkit-appearance:none;background:transparent;border:none;color:rgba(255,255,255,0.85);padding:6px 6px 6px 2px;font:600 12px/1 inherit;cursor:pointer;outline:none}
.anno-color-select option{background:#11141d;color:#fff}
.anno-rope-group{display:inline-flex;align-items:center;gap:4px}
.anno-rope-group .anno-shape-wrap{display:none}
body.anno-rope-active .anno-rope-group .anno-shape-wrap{display:inline-flex}
.anno-shape-wrap{align-items:center;gap:4px;padding:0 2px 0 6px;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);border-radius:6px}
.anno-shape-select{appearance:none;-webkit-appearance:none;background:transparent;border:none;color:rgba(255,255,255,0.85);padding:6px 6px 6px 2px;font:600 12px/1 inherit;cursor:pointer;outline:none;font-family:inherit}
.anno-shape-select option{background:#11141d;color:#fff}
.anno-exit-btn{font-size:16px;line-height:1;padding:4px 9px 6px}
.anno-exit-btn:hover{background:rgba(255,107,107,0.18);border-color:rgba(255,107,107,0.45);color:#ff6b6b}

/* Engage the 16:9 letterbox once a session is live. */
body.live-tour-active #viewer{display:flex;align-items:center;justify-content:center;background:#000}
body.live-tour-active #anno-letterbox-wrap{position:relative;inset:auto;aspect-ratio:16/9;width:min(100%,calc((100vh - 100px) * 16 / 9));height:auto;max-height:100%}
body.live-tour-active.live-tour-host #anno-letterbox-wrap.follow-pulse{box-shadow:0 0 0 3px var(--lt-accent),0 0 0 6px rgba(129,140,248,0.2);transition:box-shadow 1.5s ease-out}

/* ── Explore Together launch button (top bar) ─────────────────────── */
.lt-launch{position:relative}
.lt-launch .lt-dot{width:7px;height:7px;border-radius:50%;background:transparent;display:inline-block}
.lt-launch.is-waiting .lt-dot{background:#fff;opacity:0.9}
.lt-launch.connected .lt-dot{background:#fff;animation:lt-pulse 1.6s ease-in-out infinite}
@keyframes lt-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,0.5)}50%{box-shadow:0 0 0 6px rgba(255,255,255,0)}}
@media(max-width:560px){.lt-launch .lt-launch-label{display:none}}

/* ── Control panel (right drawer) ─────────────────────────────────── */
#lt-panel{position:fixed;top:0;right:0;width:min(340px,92vw);height:100%;z-index:2000;display:flex;flex-direction:column;transform:translateX(100%);transition:transform 0.3s ease;background:rgba(10,12,20,0.62);-webkit-backdrop-filter:blur(28px) saturate(160%);backdrop-filter:blur(28px) saturate(160%);border-left:1px solid rgba(255,255,255,0.08);box-shadow:-8px 0 32px rgba(0,0,0,0.25)}
#lt-panel.open{transform:translateX(0)}
.lt-panel-head{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,0.08)}
.lt-panel-title{font-size:14px;font-weight:700;color:#fff}
.lt-status-chip{font:600 10px/1 system-ui,-apple-system,sans-serif;color:#fff;padding:3px 8px;border-radius:999px;background:rgba(34,197,94,0.2);border:1px solid rgba(34,197,94,0.45)}
.lt-panel-close{margin-left:auto;width:26px;height:26px;border-radius:50%;background:rgba(255,255,255,0.1);border:none;color:rgba(255,255,255,0.75);font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s}
.lt-panel-close:hover{background:rgba(255,255,255,0.2)}
.lt-panel-body{padding:16px;overflow-y:auto;display:flex;flex-direction:column;gap:10px}
.lt-intro{margin:0 0 4px;font-size:12.5px;line-height:1.55;color:rgba(255,255,255,0.78)}
.lt-role-choose{display:flex;flex-direction:column;gap:8px}
.lt-btn{appearance:none;border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.07);color:#fff;border-radius:8px;padding:10px 12px;font:600 13px/1 inherit;font-family:inherit;cursor:pointer;transition:background 0.2s,opacity 0.2s,transform 0.1s;-webkit-tap-highlight-color:transparent}
.lt-btn:hover{background:rgba(255,255,255,0.14)}
.lt-btn:active{transform:scale(0.99)}
.lt-btn:disabled{opacity:0.45;cursor:not-allowed}
.lt-btn.primary{background:var(--lt-accent);border-color:var(--lt-accent)}
.lt-btn.primary:hover{opacity:0.9;background:var(--lt-accent)}
.lt-leave-btn{background:rgba(255,255,255,0.1);border-color:rgba(255,255,255,0.18)}
.lt-leave-btn:hover{background:rgba(220,38,38,0.85);border-color:rgba(220,38,38,0.85)}
.lt-pin-display{background:rgba(0,0,0,0.28);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:12px;text-align:center}
.lt-pin-label{font-size:10px;color:rgba(255,255,255,0.55);text-transform:uppercase;letter-spacing:0.07em;margin-bottom:4px}
.lt-pin-value{font-size:30px;font-weight:700;color:#fff;letter-spacing:0.22em;font-variant-numeric:tabular-nums}
.lt-status{font-size:11.5px;color:rgba(255,255,255,0.62);min-height:14px;line-height:1.45}
.lt-mini-status{font-size:11px;color:rgba(255,255,255,0.55);min-height:13px}
.lt-field-label,.lt-stops-label{font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:rgba(255,255,255,0.45)}
.lt-join-row{display:flex;gap:6px}
.lt-input{flex:1;border:1px solid rgba(255,255,255,0.16);border-radius:8px;background:rgba(255,255,255,0.07);color:#fff;padding:9px 10px;font:600 16px/1 inherit;letter-spacing:0.22em;text-align:center;font-variant-numeric:tabular-nums;outline:none}
.lt-input:focus{border-color:var(--lt-accent)}
.lt-input::placeholder{color:rgba(255,255,255,0.35);letter-spacing:0.22em}
.lt-stops{display:flex;flex-direction:column;gap:4px;max-height:34vh;overflow-y:auto}
.lt-stop-btn{border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#fff;border-radius:6px;padding:8px 10px;font:500 12px/1.3 inherit;font-family:inherit;cursor:pointer;text-align:left;transition:background 0.2s}
.lt-stop-btn:hover:not(:disabled){background:rgba(255,255,255,0.14)}
.lt-stop-btn:disabled{opacity:0.45;cursor:not-allowed}
.lt-stops-empty{font-size:11px;color:rgba(255,255,255,0.5);font-style:italic;line-height:1.5}
.lt-back-link{align-self:flex-start;background:transparent;border:none;color:rgba(255,255,255,0.5);font-size:11px;cursor:pointer;padding:4px 0;font-family:inherit}
.lt-back-link:hover{color:rgba(255,255,255,0.85)}

/* ── Live extras: voice status + manual paste-to-sync fallback ────── */
#lt-live-extras{display:flex;flex-direction:column;gap:10px;margin-top:6px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.08)}
.lt-voice-status{display:flex;align-items:center;gap:7px;font-size:11.5px;line-height:1.45;color:rgba(255,255,255,0.7);min-height:14px}
.lt-voice-status::before{content:"";width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.3);flex-shrink:0}
.lt-voice-status[data-voice="ok"]::before{background:#22c55e}
.lt-voice-status[data-voice="live"]::before{background:#22c55e;animation:lt-pulse 1.6s ease-in-out infinite}
.lt-voice-status[data-voice="warn"]::before{background:#f59e0b}
.lt-manual-sync{display:flex;flex-direction:column;gap:6px}
.lt-manual-input{flex:1;min-width:0;border:1px solid rgba(255,255,255,0.16);border-radius:8px;background:rgba(255,255,255,0.07);color:#fff;padding:9px 10px;font:500 13px/1.2 inherit;font-family:inherit;outline:none}
.lt-manual-input:focus{border-color:var(--lt-accent)}
.lt-manual-input::placeholder{color:rgba(255,255,255,0.35)}

@media(max-width:640px){
  #lt-panel{top:auto;bottom:0;right:0;left:0;width:100%;height:auto;max-height:82vh;border-radius:16px 16px 0 0;border-left:none;border-top:1px solid rgba(255,255,255,0.08);transform:translateY(100%);padding-bottom:env(safe-area-inset-bottom,0px)}
  #lt-panel.open{transform:translateY(0)}
  @supports(height:100dvh){#lt-panel{max-height:82dvh}}
}

/* ── Touch ergonomics (coarse pointers): ≥44px targets + safe areas ── */
@media(pointer: coarse){
  #anno-toolbar{gap:8px;padding:10px calc(12px + env(safe-area-inset-right,0px)) 10px calc(12px + env(safe-area-inset-left,0px))}
  .anno-tool-btn{min-height:44px;min-width:44px;padding:10px 14px;font-size:14px}
  .anno-exit-btn{font-size:20px}
  .anno-color-wrap,.anno-shape-wrap{min-height:44px}
  .anno-color-select,.anno-shape-select{min-height:42px;font-size:14px}
  .lt-btn{min-height:44px}
  .lt-stop-btn{min-height:44px}
  .lt-panel-close{width:44px;height:44px;font-size:20px}
}

/* dvh letterbox: track the iOS visual viewport instead of the largest
   layout viewport so URL-bar collapse never misaligns the canvas. */
@supports(height:100dvh){
  body.live-tour-active #anno-letterbox-wrap{width:min(100%,calc((100dvh - 100px) * 16 / 9))}
}

/* ── Location-sync pulse pill (both roles) ────────────────────────── */
#loc-sync{position:fixed;top:60px;left:12px;z-index:1240;display:none;align-items:center;gap:8px;padding:6px 14px 6px 10px;border-radius:999px;background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.18);color:#fff;font:600 12px/1 system-ui,-apple-system,sans-serif;-webkit-backdrop-filter:blur(14px) saturate(160%);backdrop-filter:blur(14px) saturate(160%);box-shadow:0 6px 20px rgba(0,0,0,0.32);cursor:help;user-select:none;max-width:min(280px,calc(100vw - 24px))}
body.live-tour-active #loc-sync{display:inline-flex}
#loc-sync:hover,#loc-sync:focus-visible{background:rgba(0,0,0,0.72)}
#loc-sync:focus-visible{outline:2px solid var(--lt-accent);outline-offset:2px}
.loc-sync-dot{position:relative;display:inline-flex;align-items:center;justify-content:center;width:10px;height:10px;border-radius:50%;background:var(--lt-accent);flex-shrink:0;animation:loc-sync-breath 2.2s ease-in-out infinite}
.loc-sync-label{color:rgba(255,255,255,0.94);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes loc-sync-breath{0%,100%{box-shadow:0 0 0 0 rgba(129,140,248,0.4)}50%{box-shadow:0 0 0 6px rgba(129,140,248,0)}}
@keyframes loc-sync-spin{to{transform:rotate(360deg)}}
#loc-sync[data-state="syncing"] .loc-sync-dot{background:transparent;border:2px solid rgba(255,255,255,0.35);border-top-color:#fff;animation:loc-sync-spin 0.7s linear infinite;box-shadow:none}
#loc-sync[data-state="success"]{background:rgba(22,163,74,0.85);border-color:rgba(22,163,74,0.95)}
#loc-sync[data-state="success"] .loc-sync-dot{background:#fff;animation:none;box-shadow:none}
#loc-sync[data-state="success"] .loc-sync-dot::after{content:"";position:absolute;width:6px;height:3px;border-left:2px solid #16a34a;border-bottom:2px solid #16a34a;transform:rotate(-45deg) translate(0.5px,-1px)}
#loc-sync[data-state="waiting"]{opacity:0.65}
#loc-sync[data-state="waiting"] .loc-sync-dot{background:rgba(255,255,255,0.5)}
#loc-sync-tips{position:fixed;top:96px;left:12px;z-index:1245;display:none;flex-direction:column;width:min(264px,calc(100vw - 24px));padding:10px 14px 12px;border-radius:12px;background:rgba(0,0,0,0.82);border:1px solid rgba(255,255,255,0.16);color:#fff;font:500 12px/1.45 system-ui,-apple-system,sans-serif;-webkit-backdrop-filter:blur(16px) saturate(170%);backdrop-filter:blur(16px) saturate(170%);box-shadow:0 12px 28px rgba(0,0,0,0.42);pointer-events:auto}
body.live-tour-active #loc-sync-tips:not([hidden]){display:flex}
#loc-sync-tips ol{margin:0;padding-left:20px}
#loc-sync-tips li{margin-bottom:3px;color:rgba(255,255,255,0.94)}
#loc-sync-tips kbd{display:inline-block;padding:1px 7px;border-radius:4px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.26);font:700 11px/1.4 ui-monospace,Menlo,monospace;color:#fff}
/* Safe-area offsets (notch/Dynamic Island); falls back to the base
   top/left above where env() is unsupported. */
#loc-sync{top:calc(60px + env(safe-area-inset-top,0px));left:calc(12px + env(safe-area-inset-left,0px))}
#loc-sync-tips{top:calc(96px + env(safe-area-inset-top,0px));left:calc(12px + env(safe-area-inset-left,0px))}

#lt-audio{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
`.trim();
}

const LAUNCH_BUTTON_HTML = `<button id="lt-launch-btn" type="button" class="f3d-iconbtn lt-launch" aria-expanded="false" aria-controls="lt-panel" title="Explore Together — live shared tour with voice, synced views & annotations">
  <span class="lt-dot" aria-hidden="true"></span>
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  <span class="lt-launch-label">Explore Together</span>
</button>`;

const STAGE_OVERLAY_HTML = `<div id="lt-navlock" aria-hidden="true"></div>
    <canvas id="anno-canvas"></canvas>
    <div id="remote-pointer" aria-hidden="true"></div>`;

const TOOLBAR_HTML = `<div id="anno-toolbar" role="toolbar" aria-label="Shared tour annotations">
  <button type="button" class="anno-tool-btn" data-tool="pointer" title="Pointer (P)" aria-keyshortcuts="P">Pointer</button>
  <button type="button" class="anno-tool-btn" data-tool="draw" id="anno-draw-btn" title="Draw (D)" aria-keyshortcuts="D">Draw</button>
  <label class="anno-color-wrap" title="Stroke color">
    <span class="anno-color-swatch" id="anno-color-swatch" aria-hidden="true"></span>
    <select class="anno-color-select" id="anno-color-select" aria-label="Stroke color">
      <option value="#ff3b30">Red</option>
      <option value="#1e90ff">Blue</option>
      <option value="#22c55e">Green</option>
      <option value="#ffffff">White</option>
    </select>
  </label>
  <span class="anno-rope-group" role="group" aria-label="Focus Rope">
    <button type="button" class="anno-tool-btn" data-tool="rope" id="anno-rope-btn" title="Focus Rope (R)" aria-keyshortcuts="R">Focus Rope</button>
    <label class="anno-shape-wrap" title="Rope shape">
      <select class="anno-shape-select" id="anno-shape-select" aria-label="Rope shape">
        <option value="circle">Circle</option>
        <option value="box">Box</option>
      </select>
    </label>
  </span>
  <button type="button" class="anno-tool-btn" id="anno-clear-btn" title="Clear annotations (C)" aria-keyshortcuts="C">Clear</button>
  <button type="button" class="anno-tool-btn anno-exit-btn" id="anno-exit-btn" title="Exit annotation mode" aria-label="Exit annotation mode">&times;</button>
</div>`;

const PANEL_HTML = `<aside id="lt-panel" class="lt-panel" role="dialog" aria-label="Explore Together" aria-modal="false">
  <div class="lt-panel-head">
    <span class="lt-panel-title">Explore Together</span>
    <span id="lt-status-chip" class="lt-status-chip" hidden>Live</span>
    <button id="lt-panel-close" class="lt-panel-close" type="button" aria-label="Close">&times;</button>
  </div>
  <div class="lt-panel-body">
    <p class="lt-intro">Tour this space together in real time — voice chat, synced views, and pointer / draw / focus-rope annotations.</p>
    <div id="lt-diag" class="lt-mini-status" hidden></div>
    <div id="lt-role-choose" class="lt-role-choose">
      <button id="lt-host-start-btn" type="button" class="lt-btn primary">Host a tour</button>
      <button id="lt-guest-choose-btn" type="button" class="lt-btn">Join with a PIN</button>
    </div>
    <div id="lt-host-block" hidden>
      <div class="lt-pin-display">
        <div class="lt-pin-label">Your tour PIN</div>
        <div id="lt-pin-value" class="lt-pin-value">----</div>
      </div>
      <button id="lt-invite-btn" type="button" class="lt-btn primary">Share invite</button>
      <div id="lt-invite-status" class="lt-mini-status" aria-live="polite"></div>
      <div id="lt-host-status" class="lt-status" aria-live="polite"></div>
      <div class="lt-stops-label">Tour stops</div>
      <div id="lt-stops" class="lt-stops"></div>
      <button type="button" class="lt-back-link">&larr; Back</button>
      <button type="button" class="lt-btn lt-leave-btn" hidden>Leave tour</button>
    </div>
    <div id="lt-guest-block" hidden>
      <label class="lt-field-label" for="lt-pin-input">Enter the 4-digit PIN from your host</label>
      <div class="lt-join-row">
        <input id="lt-pin-input" class="lt-input" inputmode="numeric" maxlength="4" placeholder="0000" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Tour PIN" />
        <button id="lt-join-btn" type="button" class="lt-btn primary">Join</button>
      </div>
      <div id="lt-guest-status" class="lt-status" aria-live="polite"></div>
      <button type="button" class="lt-back-link">&larr; Back</button>
      <button type="button" class="lt-btn lt-leave-btn" hidden>Leave tour</button>
    </div>
    <div id="lt-live-extras" hidden>
      <button id="lt-enable-voice-btn" type="button" class="lt-btn primary" hidden>Enable voice</button>
      <div id="lt-voice-status" class="lt-voice-status" data-voice="off" aria-live="polite"></div>
      <div class="lt-manual-sync">
        <label class="lt-field-label" for="lt-manual-sync-input">Sync not working? Paste the Matterport &ldquo;Link to location&rdquo;</label>
        <div class="lt-join-row">
          <input id="lt-manual-sync-input" class="lt-manual-input" type="text" inputmode="url" placeholder="Paste the Matterport link to location" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Matterport link to location" />
          <button id="lt-manual-sync-btn" type="button" class="lt-btn primary">Sync</button>
        </div>
        <div id="lt-manual-sync-status" class="lt-mini-status" aria-live="polite"></div>
      </div>
    </div>
  </div>
</aside>

<div id="loc-sync" data-state="waiting" tabindex="0" aria-label="Tour sync status — hover for instructions">
  <span class="loc-sync-dot" aria-hidden="true"></span>
  <span class="loc-sync-label" aria-live="polite">Connecting…</span>
</div>
<div id="loc-sync-tips" role="status" aria-live="polite" hidden>
  <ol>
    <li>Click <strong>Allow</strong> if a clipboard prompt appears.</li>
    <li>Position the view you want to share.</li>
    <li>Press <kbd>U</kbd> then <strong>Copy to clipboard</strong> to sync.</li>
  </ol>
</div>
<audio id="lt-audio" autoplay playsinline></audio>`;

// Bounded sentinels around the replaceable runtime spans so a future
// upgrade can locate them by exact byte range. Inert comments that wrap
// ONLY runtime spans, never presentation content. (Atlas packages are
// normally regenerated from curation source rather than byte-patched, but
// the markers keep the package self-describing and consistent with the
// Builder family. Comment syntax matches each host context.)
function f3dWrapHtml(span: string, inner: string): string {
  return `<!-- f3d:runtime-${span} BEGIN v=1 family=atlas -->\n${inner}\n<!-- f3d:runtime-${span} END -->`;
}
function f3dWrapCss(inner: string): string {
  return `/* f3d:runtime-css BEGIN v=1 family=atlas */\n${inner}\n/* f3d:runtime-css END */`;
}

/**
 * Assemble all Live Tour shell pieces for a curated showcase page. The caller
 * splices each field into its static index.html template.
 */
export function renderAtlasLiveTour(opts: AtlasLiveTourOptions): AtlasLiveTourAssets {
  const config = {
    accent: opts.accentColor,
    matterportBaseUrl: opts.matterportEmbedSrc,
    shareTitle: opts.shareTitle,
    stops: Array.isArray(opts.stops) ? opts.stops : [],
  };
  const runtimeJs = getLiveSessionRuntimeJS();
  const annoInputJs = getAnnoInputJS();
  const glueJs = getAtlasLiveTourGlueJS();
  const scriptHtml = `<script>window.__ATLAS_LT_CONFIG=${safeJsonForScript(config)};</script>
<script>
(function(){
// f3d:runtime-js:kernel BEGIN v=1 family=atlas
${runtimeJs}
${annoInputJs}
// f3d:runtime-js:kernel END
// f3d:runtime-js:glue BEGIN v=1 family=atlas
${glueJs}
// f3d:runtime-js:glue END
})();
</script>`;

  return {
    headHtml: f3dWrapHtml("dep:peerjs", PEERJS_TAG),
    css: f3dWrapCss(buildCss(opts.accentColor)),
    launchButtonHtml: LAUNCH_BUTTON_HTML,
    stageOverlayHtml: f3dWrapHtml("markup", STAGE_OVERLAY_HTML),
    toolbarHtml: f3dWrapHtml("markup", TOOLBAR_HTML),
    bodyHtml: f3dWrapHtml("markup", PANEL_HTML),
    scriptHtml,
  };
}
