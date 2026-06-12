#!/usr/bin/env node
/**
 * Builder live-tour CANARY assembler (for real-device QA before deploy).
 *
 * Why: the U0 Builder runtime hardening affects EVERY newly downloaded
 * presentation, but the real generator (generatePresentation, a TanStack
 * server-fn) can't run headless. This script reconstructs a self-contained,
 * device-testable page from the SAME corrected sources the generator inlines:
 *   - the pinned PeerJS dependency, runtime CSS, annotation overlay markup,
 *     and live-guide glue imported from the canonical span builders in
 *     src/lib/portal/builder-runtime-spans.mjs (the SAME builders
 *     generatePresentation interpolates — P2), and
 *   - the real live-session.mjs controller + anno-input.mjs kernel
 *     (so the genuine pointer guard / WebKit defenses run).
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
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripExports } from "../src/lib/portal/ask-runtime-transformer.mjs";
import { ATLAS_RUNTIME_VERSION, buildRuntimeMetaTags } from "../src/lib/atlas-runtime-version.mjs";
import {
  buildBuilderCssSpan,
  buildBuilderJsKernelSpan,
  BUILDER_DEP_PEERJS_SPAN,
  BUILDER_MARKUP_SPAN,
  BUILDER_JS_GLUE_SPAN,
} from "../src/lib/portal/builder-runtime-spans.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
// A public Matterport sample (override via argv[2] with your own model id).
const MODEL_ID = process.argv[2] || "SxQL3iGyoDo";

// The canonical builders return SENTINEL-INCLUSIVE blocks (the patcher's
// replacement unit) already in real emitted bytes. The canary template wants
// the INNER content for css/markup/kernel/glue (it slots them between its own
// surrounding lines): bytes after the BEGIN line up to the start of the END
// sentinel literal — exactly what the old source extraction produced (the
// markup END line keeps its leading indentation).
function innerOf(block, endLiteral) {
  const from = block.indexOf("\n") + 1;
  const to = block.indexOf(endLiteral);
  if (from === 0 || to === -1) throw new Error(`canary: malformed span block (${endLiteral})`);
  return block.slice(from, to);
}

const DEP = BUILDER_DEP_PEERJS_SPAN + "\n";
const CSS = innerOf(
  buildBuilderCssSpan({ accentColor: "#6c5ce7", hudBgColor: "#0a0e27" }),
  "/* f3d:runtime-css END */",
);
const MARKUP = innerOf(BUILDER_MARKUP_SPAN, "<!-- f3d:runtime-markup END -->");
// The kernel builder interpolates the two runtime modules — pass the real
// (stripped) sources so createLiveSession + the anno-input helpers are
// locals AND their own template literals are not corrupted.
const KERNEL = innerOf(
  buildBuilderJsKernelSpan({
    liveSessionJs: stripExports(read("src", "lib", "portal", "live-session.mjs")),
    annoInputJs: stripExports(read("src", "lib", "portal", "anno-input.mjs")),
  }),
  "// f3d:runtime-js:kernel END",
);
const GLUE = innerOf(BUILDER_JS_GLUE_SPAN, "// f3d:runtime-js:glue END");

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
${buildRuntimeMetaTags("builder")}
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
    <iframe id="matterport-frame" src="${IFRAME_SRC}" allowfullscreen allow="xr-spatial-tracking; gyroscope; accelerometer; fullscreen; autoplay; clipboard-write; web-share"></iframe>
    <iframe id="matterport-frame-ghost" allowfullscreen allow="xr-spatial-tracking; gyroscope; accelerometer; fullscreen; autoplay; clipboard-write; web-share" aria-hidden="true" tabindex="-1"></iframe>
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
const sha256 = crypto.createHash("sha256").update(HTML).digest("hex");
console.log(`[canary] ✅ wrote ${path.relative(ROOT, outFile)} — runtime <script> parses.`);
console.log(`[canary]    runtime_version : ${ATLAS_RUNTIME_VERSION}  (advertises this; carries the f3d:interaction-active emit)`);
console.log(`[canary]    matterport model: ${MODEL_ID}`);
console.log(`[canary]    bytes           : ${HTML.length}`);
console.log(`[canary]    sha256          : ${sha256}`);
