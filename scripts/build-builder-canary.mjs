#!/usr/bin/env node
/**
 * Builder live-tour CANARY assembler (for real-device QA before deploy).
 *
 * Why: the U0 Builder runtime hardening affects EVERY newly downloaded
 * presentation, but the real generator (generatePresentation, a TanStack
 * server-fn) can't run headless. This script reconstructs a self-contained,
 * device-testable page from the SAME corrected sources the generator inlines:
 *   - the pinned PeerJS dependency, runtime CSS, and annotation overlay markup
 *     extracted from portal.functions.ts via the f3d:runtime sentinels, and
 *   - the real live-session.mjs controller + anno-input.mjs kernel + the
 *     live-guide glue (so the genuine pointer guard / WebKit defenses run).
 *
 * What you CAN test on iPhone/iPad with the output:
 *   - Tap "Host a tour" (role=agent, no peer needed), pick Draw / Focus Rope,
 *     and annotate the Matterport sample: multi-touch rejection, Pencil
 *     takeover, NO Apple Paste interruption, rope body-drag + 44px latch.
 *   - With no tool selected, Matterport navigation must be completely normal.
 *   - Two tabs / two devices can PIN-connect to test the bidirectional flow.
 *
 * What it is NOT: a full branded presentation (no config / QA / analytics /
 * protected gate). For a production-fidelity canary, export a presentation
 * from the app on this branch. This canary isolates the runtime under test.
 *
 * Run:   node scripts/build-builder-canary.mjs [matterportModelId]
 * Out:   dist/builder-canary.html
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripExports } from "../src/lib/portal/ask-runtime-transformer.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const PORTAL = read("src", "lib", "portal.functions.ts");
// A public Matterport sample (override via argv[2] with your own model id).
const MODEL_ID = process.argv[2] || "SxQL3iGyoDo";

// ── Extract a sentinel-bounded span and turn template-literal text into the
//    real bytes the generator would emit (un-escape \\ \` \${; substitute the
//    handful of known config interpolations with canary defaults; blank the
//    rest). ───────────────────────────────────────────────────────────────
function span(beginNeedle, endNeedle, { inner = false } = {}) {
  const a = PORTAL.indexOf(beginNeedle);
  const b = PORTAL.indexOf(endNeedle, a);
  if (a === -1 || b === -1) throw new Error(`canary: span ${beginNeedle} not found`);
  // inner=true → between the BEGIN/END lines (drop the sentinel comments);
  // inner=false → include them (handy for the dep tag, which is a comment+tag).
  const from = inner ? PORTAL.indexOf("\n", a) + 1 : a;
  const to = inner ? b : PORTAL.indexOf("\n", b) + 1;
  return PORTAL.slice(from, to);
}
// Turn template-literal text into the real bytes the generator emits.
// `interp` maps a ${EXPR} token to its replacement; a MATCHED token's value is
// emitted verbatim (so an inlined .mjs keeps its OWN ${} template literals),
// while unmatched ${...} become "null" (valid in any JS/CSS position). Known
// config interpolations are pre-substituted with canary-safe literals.
function deTemplate(src, interp) {
  interp = interp || {};
  let s = src
    .replace(/\$\{escapeHtml\(accentColor\)\}/g, "#6c5ce7")
    .replace(/\$\{escapeHtml\(hudBgColor\)\}/g, "#0a0e27");
  let out = "";
  let i = 0;
  while (i < s.length) {
    if (s[i] === "$" && s[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < s.length && depth > 0) {
        if (s[j] === "{") depth += 1;
        else if (s[j] === "}") depth -= 1;
        if (depth === 0) break;
        j += 1;
      }
      const expr = s.slice(i + 2, j).trim();
      i = j + 1;
      out += Object.prototype.hasOwnProperty.call(interp, expr) ? interp[expr] : "null";
      continue;
    }
    if (s[i] === "\\" && (s[i + 1] === "$" || s[i + 1] === "`" || s[i + 1] === "\\")) {
      out += s[i + 1];
      i += 2;
      continue;
    }
    out += s[i];
    i += 1;
  }
  return out;
}

const DEP = deTemplate(span("<!-- f3d:runtime-dep:peerjs BEGIN", "<!-- f3d:runtime-dep:peerjs END -->", { inner: false }));
const CSS = deTemplate(span("/* f3d:runtime-css BEGIN", "/* f3d:runtime-css END */", { inner: true }));
const MARKUP = deTemplate(span("<!-- f3d:runtime-markup BEGIN", "<!-- f3d:runtime-markup END -->", { inner: true }));
// The kernel span interpolates the two runtime modules — inline the real
// (stripped) sources as-is so createLiveSession + the anno-input helpers are
// locals AND their own template literals are not corrupted.
const KERNEL = deTemplate(
  span("// f3d:runtime-js:kernel BEGIN", "// f3d:runtime-js:kernel END", { inner: true }),
  {
    LIVE_SESSION_RUNTIME_JS: stripExports(read("src", "lib", "portal", "live-session.mjs")),
    ANNO_INPUT_RUNTIME_JS: stripExports(read("src", "lib", "portal", "anno-input.mjs")),
  },
);
const GLUE = deTemplate(span("// f3d:runtime-js:glue BEGIN", "// f3d:runtime-js:glue END", { inner: true }));

const IFRAME_SRC = `https://my.matterport.com/show/?m=${MODEL_ID}&play=1&qs=1`;

// Minimal live-guide control panel — only the ids the glue requires to host /
// join / leave plus the containers it relocates. Everything else the glue
// looks up is guarded (if(el)), so a lean panel is enough to drive the runtime.
const PANEL = `
<div id="live-tour-control-drawer"><div id="ltcd-inner"><div id="ltcd-live-guide-slot"></div></div></div>
<div id="live-tour-inner"></div>
<div id="drawer-live-guide" class="canary-panel">
  <div id="lg-visitor">
    <div id="lg-agent-prejoin"></div>
    <input id="lg-pin-input" inputmode="numeric" maxlength="4" placeholder="PIN" />
    <button id="lg-join-btn" type="button">Join with PIN</button>
    <div id="lg-visitor-status"></div>
    <a id="lg-toggle-agent" href="#">Host instead</a>
  </div>
  <div id="lg-agent" hidden>
    <button id="lg-start-btn" type="button">Host a tour</button>
    <div id="lg-agent-active" hidden>PIN: <strong id="lg-pin-value">————</strong></div>
    <div id="lg-agent-status"></div>
    <div id="lg-stops"></div>
    <a id="lg-toggle-visitor" href="#">Join instead</a>
  </div>
  <button id="lt-leave-btn" type="button" hidden>Leave</button>
  <button id="hud-live-tour-btn" type="button" hidden></button>
  <audio id="lg-audio" autoplay playsinline></audio>
</div>
<div id="loc-sync" data-state="waiting"><span class="loc-sync-dot"></span><span class="loc-sync-label"></span></div>
<div id="loc-sync-tips" hidden></div>`;

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>Builder live-tour canary — DEVICE QA ONLY</title>
${DEP}
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000;color:#fff;font-family:-apple-system,system-ui,sans-serif}
#viewer{position:absolute;inset:0}
.canary-panel{position:fixed;top:8px;right:8px;z-index:2000;display:flex;flex-direction:column;gap:6px;max-width:240px;padding:10px;border-radius:10px;background:rgba(10,14,39,.92);border:1px solid rgba(255,255,255,.12)}
.canary-panel button,.canary-panel input{font:600 13px/1 inherit;padding:8px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:#6c5ce7;color:#fff}
.canary-panel input{background:rgba(255,255,255,.08)}
.canary-panel a{color:#a5b4fc;font-size:12px}
.canary-banner{position:fixed;left:8px;bottom:8px;z-index:2000;font:600 11px/1.3 system-ui;color:#fbbf24;background:rgba(0,0,0,.6);padding:6px 10px;border-radius:8px;max-width:60vw}
/* ── runtime CSS (extracted from portal.functions.ts) ─────────────── */
${CSS}
</style>
</head>
<body>
<div id="viewer">
  <div id="anno-letterbox-wrap">
    <iframe id="matterport-frame" src="${IFRAME_SRC}" allowfullscreen allow="xr-spatial-tracking; fullscreen"></iframe>
    <iframe id="matterport-frame-ghost" allowfullscreen allow="xr-spatial-tracking; fullscreen" aria-hidden="true" tabindex="-1"></iframe>
${MARKUP}
  </div>
</div>
${PANEL}
<div class="canary-banner">CANARY — device QA only. Tap "Host a tour", then Draw / Focus Rope to test mobile annotation. With no tool selected, Matterport navigation must be normal.</div>
<script>
(function(){
  // The generated page declares frame in its outer IIFE; mirror that here so
  // the live-guide glue (which references the bare identifier) resolves it.
  var frame=document.getElementById("matterport-frame");
${KERNEL}
${GLUE}
})();
</script>
</body>
</html>`;

const outDir = path.join(ROOT, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "builder-canary.html");
fs.writeFileSync(outFile, HTML, "utf8");

// Sanity: the inlined runtime <script> must parse as JS (catches a bad splice
// before you waste a device session on a blank page).
const scriptBody = "var frame=null;\n" + KERNEL + "\n" + GLUE;
try {
  new Function("window", "document", "navigator", "createLiveSession", "ResizeObserver", scriptBody);
} catch (err) {
  console.error("[canary] ❌ assembled runtime <script> failed to parse: " + err.message);
  process.exit(1);
}
console.log(`[canary] ✅ wrote ${path.relative(ROOT, outFile)} (${HTML.length} bytes, model ${MODEL_ID}); runtime parses.`);
