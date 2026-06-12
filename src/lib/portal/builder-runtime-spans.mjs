// Canonical Builder runtime span builders — the single source of truth for
// the five f3d:runtime sentinel spans every generated Builder presentation
// carries, and the exact bytes the Presentation Upgrade patcher (P3) will
// splice into outdated packages.
//
// CONTRACT (byte identity):
//   - Each builder returns the FULL sentinel-inclusive block: first byte of
//     its BEGIN sentinel line through last byte of its END sentinel line,
//     no trailing newline. That block is the patcher's replacement unit
//     (PATCH_MUTATION_ALLOWLIST in presentation-upgrade-inspector.mjs —
//     "sentinel lines included").
//   - generatePresentation (portal.functions.ts) interpolates each builder
//     at column 0 of the line range its span previously occupied, so the
//     generated document is byte-identical to the pre-extraction generator.
//   - tests/builder-runtime-spans.test.mjs pins sha256 baselines captured
//     from origin/main@a646a20 BEFORE this extraction. Any byte change here
//     must be deliberate and must re-pin those baselines (and re-derive the
//     canary hash).
//
// PURITY: no imports. The js:kernel builder takes the two runtime module
// sources as PARAMETERS — the generator passes its Vite ?raw constants,
// node tests pass fs-read + stripExports output — so this module loads in
// plain node and in the browser bundle alike.
//
// WARNING (kept from the original emission site): never write backticks or
// interpolation tokens inside comments WITHIN the span template literals
// below. Template literals evaluate \${...} and end on backticks even
// inside // comments, which would corrupt the emitted runtime.

export function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Document order of the five spans inside a generated Builder presentation.
export const BUILDER_SPAN_CANONICAL_ORDER = Object.freeze([
  "css",
  "dep:peerjs",
  "markup",
  "js:kernel",
  "js:glue",
]);

// ── css — Live Tour overlay/toolbar styles. The ONLY branded span: 14
//    accentColor + 1 hudBgColor interpolation points, HTML-escaped here
//    (not at the call site) so the patcher cannot forget the escaping.
export function buildBuilderCssSpan({ accentColor, hudBgColor }) {
  return `/* f3d:runtime-css BEGIN v=1 family=builder */
/* ── Live Tour annotation overlay ─────────────────────────────────── */
/* The wrap is a full-size pass-through container in idle mode. When a
   live tour is connected, body.live-tour-active flips the wrap into a
   16:9 letterbox so pointer / stroke coordinates are stable on both
   ends regardless of viewport aspect ratio. Canvas + remote pointer
   sit absolutely over the iframe inside the wrap. */
#anno-letterbox-wrap{position:absolute;inset:0}
#anno-letterbox-wrap iframe{width:100%;height:100%;border:none;display:block}
#anno-canvas{position:absolute;inset:0;display:block;width:100%;height:100%;pointer-events:none;z-index:5;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
#anno-canvas.pointer-mode,#anno-canvas.draw-mode,#anno-canvas.rope-mode,#anno-canvas.eraser-mode{pointer-events:auto;cursor:crosshair}
#anno-canvas.eraser-mode{cursor:cell}
/* Stage gesture hardening — engages ONLY while an annotation tool is active
   (body.anno-tool-active, toggled by setToolMode) so Matterport navigation
   is completely normal otherwise. Mirrors the accepted Atlas 2.0.2 fix. */
body.anno-tool-active #anno-letterbox-wrap{touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
#remote-pointer{position:absolute;left:0;top:0;width:18px;height:18px;border-radius:50%;background:${escapeHtml(accentColor)}cc;border:2px solid #fff;box-shadow:0 1px 6px rgba(0,0,0,0.45);pointer-events:none;transform:translate(-50%,-50%);z-index:6;display:none}
#anno-toolbar{position:absolute;left:50%;top:14px;transform:translateX(-50%);display:none;gap:6px;z-index:10;background:rgba(10,12,20,0.7);backdrop-filter:blur(14px) saturate(160%);-webkit-backdrop-filter:blur(14px) saturate(160%);border:1px solid rgba(255,255,255,0.1);border-radius:10px;padding:6px;box-shadow:0 6px 24px rgba(0,0,0,0.35)}
.anno-tool-btn{appearance:none;border:1px solid rgba(255,255,255,0.12);background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.85);border-radius:6px;padding:6px 10px;font:600 12px/1 inherit;cursor:pointer;display:inline-flex;align-items:center;gap:4px;transition:background 0.15s,border-color 0.15s,color 0.15s;font-family:inherit}
.anno-tool-btn:hover{background:rgba(255,255,255,0.14);color:#fff}
.anno-tool-btn.active{background:${escapeHtml(accentColor)};border-color:${escapeHtml(accentColor)};color:#fff}
.anno-tool-btn.primary{background:${escapeHtml(accentColor)};border-color:${escapeHtml(accentColor)};color:#fff}
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
#live-tour-navlock{position:absolute;inset:0;z-index:4;background:transparent;cursor:not-allowed;display:none;touch-action:none;-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
body.live-tour-active.live-tour-visitor #live-tour-navlock.locked,body.live-tour-active.live-tour-agent #live-tour-navlock.locked{display:block}
body.live-tour-active.live-tour-visitor #anno-letterbox-wrap:has(#live-tour-navlock.locked) #matterport-frame,body.live-tour-active.live-tour-agent #anno-letterbox-wrap:has(#live-tour-navlock.locked) #matterport-frame{pointer-events:none}
/* Engage 16:9 letterboxing once the WebRTC session is live. Black
   bars come from #viewer's background while the wrap is centered
   inside it. Both roles get the annotation toolbar — strokes /
   pointer / clear / nav_lock are bidirectional. */
body.live-tour-active #viewer{display:flex;align-items:center;justify-content:center;background:#000}
body.live-tour-active #anno-letterbox-wrap{position:relative;inset:auto;aspect-ratio:16/9;width:min(100vw,calc(100vh * 16 / 9));height:auto;max-height:100vh}
body.live-tour-active.live-tour-agent #anno-toolbar,body.live-tour-active.live-tour-visitor #anno-toolbar{display:flex}

/* ── Live Tour controls (left-side drawer that replaces the top HUD
   while body.live-tour-active is set). Keeps the 3D tour and the
   native Matterport "Link to location" popup fully unobstructed:
   nothing renders at the top of the screen. The chevron moves to the
   top-left and toggles a compact left drawer. The visitor sees Leave
   then Sync My View; the agent sees Leave only (their annotation
   toolbar already lives inside the letterbox). */
body.live-tour-active #hud-header{display:none !important}
body.live-tour-active #hud-leave-btn{display:none !important}
/* During a Live Tour the chevron lives at the top-LEFT so it can't
   cover the Matterport URL popup that opens near the top-right. */
body.live-tour-active #hud-toggle{left:8px;right:auto}

#live-tour-control-drawer{display:none;position:fixed;top:0;left:0;height:100%;width:min(320px,90vw);z-index:1250;transform:translateX(-100%);transition:transform 0.28s ease;background:${escapeHtml(hudBgColor)}ee;-webkit-backdrop-filter:blur(20px) saturate(170%);backdrop-filter:blur(20px) saturate(170%);border-right:1px solid rgba(255,255,255,0.08);box-shadow:6px 0 28px rgba(0,0,0,0.32);will-change:transform}
body.live-tour-active #live-tour-control-drawer{display:flex;flex-direction:column}
#live-tour-control-drawer.open{transform:translateX(0)}
#ltcd-inner{display:flex;flex-direction:column;gap:10px;padding:52px 16px 18px;color:#fff;overflow-y:auto;height:100%;box-sizing:border-box}
/* While the live tour is active, the right-side Live Tour drawer is
   merged into this left drawer (see __relocateLiveGuide in the
   runtime). Hide the right drawer entirely so there is exactly one
   panel on screen and never two competing surfaces. */
body.live-tour-active #live-tour-drawer,body.live-tour-active #mattertag-drawer{display:none !important}
#ltcd-inner .drawer-live-guide{margin-top:0;border-top:none;padding-top:0;margin-bottom:0}
#ltcd-inner .lg-stops{max-height:calc(100vh - 280px);overflow-y:auto}
#ltcd-header{display:flex;align-items:center;gap:10px;min-width:0;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:4px}
#ltcd-logo{height:22px;width:auto;flex-shrink:0}
#ltcd-brand{font:700 13px/1.2 system-ui,-apple-system,sans-serif;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
#ltcd-status{font:600 10px/1 system-ui,-apple-system,sans-serif;color:rgba(255,255,255,0.85);padding:3px 8px;border-radius:999px;background:rgba(34,197,94,0.18);border:1px solid rgba(34,197,94,0.4);flex-shrink:0}
.lt-action-btn{appearance:none;border:none;cursor:pointer;width:100%;height:38px;padding:0 14px;border-radius:8px;background:${escapeHtml(accentColor)};color:#fff;font:700 13px/1 system-ui,-apple-system,sans-serif;letter-spacing:0.02em;display:inline-flex;align-items:center;justify-content:center;gap:6px;transition:background 0.2s,transform 0.1s,box-shadow 0.2s,opacity 0.15s;box-shadow:0 4px 12px ${escapeHtml(accentColor)}44}
.lt-action-btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px ${escapeHtml(accentColor)}66}
.lt-action-btn:active{transform:scale(0.98)}
.lt-action-btn.lt-leave{background:rgba(255,255,255,0.14);color:#fff;box-shadow:none;border:1px solid rgba(255,255,255,0.18)}
.lt-action-btn.lt-leave:hover{background:rgba(220,38,38,0.85);transform:translateY(-1px);box-shadow:0 6px 16px rgba(220,38,38,0.4)}

/* ── Location Sync — visitor's ambient pulse pill ──────────────────── */
/* Single ambient status pill. Clipboard is read silently on focus /
   visibilitychange / pointerenter once permission is granted at join
   time. The pill is also clickable as a user-gesture fallback for
   browsers that block ambient readText (Firefox/Safari per-call). Sits
   just below the top-left chevron so it cannot collide with Matterport's
   "Link to location" popup (top-right) or the drawer (off-screen). */
#loc-sync{position:fixed;top:50px;left:8px;z-index:1240;display:none;align-items:center;gap:8px;padding:6px 14px 6px 10px;border-radius:999px;background:rgba(0,0,0,0.58);border:1px solid rgba(255,255,255,0.18);color:#fff;font:600 12px/1 system-ui,-apple-system,sans-serif;-webkit-backdrop-filter:blur(14px) saturate(160%);backdrop-filter:blur(14px) saturate(160%);box-shadow:0 6px 20px rgba(0,0,0,0.32);cursor:help;user-select:none;transition:background 0.2s,opacity 0.2s;pointer-events:auto;max-width:min(280px,calc(100vw - 16px))}
body.live-tour-active.live-tour-visitor #loc-sync,body.live-tour-active.live-tour-agent #loc-sync{display:inline-flex}
/* Hover/focus reveal: subtle background brighten only — no transform,
   no active state. The pill is informational, not a button. */
#loc-sync:hover,#loc-sync:focus-visible{background:rgba(0,0,0,0.7)}
#loc-sync:focus-visible{outline:2px solid ${escapeHtml(accentColor)};outline-offset:2px}
.loc-sync-dot{position:relative;display:inline-flex;align-items:center;justify-content:center;width:10px;height:10px;border-radius:50%;background:${escapeHtml(accentColor)};flex-shrink:0;animation:loc-sync-breath 2.2s ease-in-out infinite}
.loc-sync-label{color:rgba(255,255,255,0.94);letter-spacing:0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
@keyframes loc-sync-breath{0%,100%{box-shadow:0 0 0 0 ${escapeHtml(accentColor)}66}50%{box-shadow:0 0 0 6px ${escapeHtml(accentColor)}00}}
@keyframes loc-sync-spin{to{transform:rotate(360deg)}}

/* State variants — all driven by data-state on #loc-sync. */
#loc-sync[data-state="syncing"] .loc-sync-dot{background:transparent;border:2px solid rgba(255,255,255,0.35);border-top-color:#fff;animation:loc-sync-spin 0.7s linear infinite;box-shadow:none}
#loc-sync[data-state="success"]{background:rgba(22,163,74,0.85);border-color:rgba(22,163,74,0.95)}
#loc-sync[data-state="success"] .loc-sync-dot{background:#fff;animation:none;box-shadow:none}
#loc-sync[data-state="success"] .loc-sync-dot::after{content:"";position:absolute;width:6px;height:3px;border-left:2px solid #16a34a;border-bottom:2px solid #16a34a;transform:rotate(-45deg) translate(0.5px,-1px)}
#loc-sync[data-state="waiting"]{opacity:0.65}
#loc-sync[data-state="waiting"] .loc-sync-dot{background:rgba(255,255,255,0.5);animation:loc-sync-breath 3s ease-in-out infinite}
@media(max-width:560px){#loc-sync{padding:5px 12px 5px 8px;font-size:11px}}

/* Tips dropdown — appears just below the pulse pill on every click.
   Brief instructional card with the 2-step user flow. CSS-gated to
   live-tour-active so it renders for both visitor and agent roles. */
#loc-sync-tips{position:fixed;top:88px;left:8px;z-index:1245;display:none;flex-direction:column;width:min(260px,calc(100vw - 16px));padding:10px 14px 12px;border-radius:12px;background:rgba(0,0,0,0.82);border:1px solid rgba(255,255,255,0.16);color:#fff;font:500 12px/1.45 system-ui,-apple-system,sans-serif;-webkit-backdrop-filter:blur(16px) saturate(170%);backdrop-filter:blur(16px) saturate(170%);box-shadow:0 12px 28px rgba(0,0,0,0.42);animation:loc-sync-tips-in 0.22s ease-out;pointer-events:none}
body.live-tour-active.live-tour-visitor #loc-sync-tips:not([hidden]),body.live-tour-active.live-tour-agent #loc-sync-tips:not([hidden]){display:flex}
#loc-sync-tips ol{margin:0;padding-left:22px}
#loc-sync-tips li{margin-bottom:3px;color:rgba(255,255,255,0.94)}
#loc-sync-tips li:last-child{margin-bottom:0}
#loc-sync-tips strong{color:#fff;font-weight:700}
#loc-sync-tips kbd{display:inline-block;padding:1px 7px;border-radius:4px;background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.26);font:700 11px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff}
@keyframes loc-sync-tips-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}

/* Agent auto-follow visual cue — brief outline pulse on the iframe
   wrap when a visitor's location_share arrives. No agent UI; the
   teleport is silent except for this pulse. */
body.live-tour-active.live-tour-agent #anno-letterbox-wrap.follow-pulse{box-shadow:0 0 0 3px ${escapeHtml(accentColor)},0 0 0 6px ${escapeHtml(accentColor)}33;transition:box-shadow 1.5s ease-out}
/* f3d:runtime-css END */`;
}

// ── dep:peerjs — inert SRI-pinned PeerJS loader config (version-static).
export const BUILDER_DEP_PEERJS_SPAN = `<!-- f3d:runtime-dep:peerjs BEGIN v=1 family=builder -->
<!-- PeerJS UMD bundle config (lazy CDN load). Pinned to an exact version
     with SRI so the CDN cannot serve different bytes than the ones this
     package was generated against. type="text/plain" keeps it inert: the
     glue reads data-src/data-integrity and injects a real script tag on
     first Start/Join intent, desktop only. Load failure is tolerated: the
     Live Guided Tour shows a friendly error and the static tour keeps
     working. -->
<script type="text/plain" id="f3d-peerjs-loader" data-src="https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js" data-integrity="sha384-x0YgkOr/3UOZP2CRDxGW9e0Q+2Qjyr3uJrm4xU32Y7ZCNAo7Cc7bjhrZMi/dwczu" data-crossorigin="anonymous"></script>
<!-- f3d:runtime-dep:peerjs END -->`;

// ── markup — annotation overlay DOM (version-static; excludes the
//    Matterport iframes, which are presentation content OUTSIDE the span).
//    Carries its original 4-space indentation as exact bytes.
export const BUILDER_MARKUP_SPAN = `    <!-- f3d:runtime-markup BEGIN v=1 family=builder -->
    <div id="live-tour-navlock" aria-hidden="true"></div>
    <canvas id="anno-canvas"></canvas>
    <div id="remote-pointer" aria-hidden="true"></div>
    <div id="anno-toolbar" role="toolbar" aria-label="Live tour annotations">
      <button type="button" class="anno-tool-btn" data-tool="pointer" title="Pointer (P)" aria-keyshortcuts="P">Pointer</button>
      <button type="button" class="anno-tool-btn" data-tool="draw" title="Draw (D)" aria-keyshortcuts="D">Draw</button>
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
      <button type="button" class="anno-tool-btn" data-tool="eraser" id="anno-eraser-btn" title="Eraser (E)" aria-keyshortcuts="E">Eraser</button>
      <button type="button" class="anno-tool-btn" id="anno-clear-btn" title="Clear annotations (C)" aria-keyshortcuts="C">Clear</button>
      <button type="button" class="anno-tool-btn anno-exit-btn" id="anno-exit-btn" title="Exit annotation mode (clears drawings &amp; unfreezes visitor)" aria-label="Exit annotation mode">&times;</button>
    </div>
    <!-- f3d:runtime-markup END -->`;

// ── js:kernel — inlines the shared live-session + anno-input runtime
//    modules. Parameterized (destructure-renamed so the span text below is
//    verbatim from the original emission site).
export function buildBuilderJsKernelSpan({
  liveSessionJs: LIVE_SESSION_RUNTIME_JS,
  annoInputJs: ANNO_INPUT_RUNTIME_JS,
}) {
  return `// f3d:runtime-js:kernel BEGIN v=1 family=builder
// ── Live Guided Tour PeerJS controller. Inlined verbatim from
//    src/lib/portal/live-session.mjs — after this point
//    createLiveSession is a local symbol. (Same caveat as above:
//    do NOT write \${LIVE_SESSION_RUNTIME_JS} or use any backticks
//    inside a comment here. Template literals evaluate \${...} and
//    end on backticks even inside // comments, which would inline
//    the whole module a second time and corrupt the script.)
${LIVE_SESSION_RUNTIME_JS}

// ── Shared mobile-input annotation kernel. Inlined verbatim from
//    src/lib/portal/anno-input.mjs — createAnnoPointerGuard,
//    annoCollectPoints, annoClampDpr, annoBudgetDpr, annoIsIosWebKit,
//    annoIsCoarsePointer, annoBindViewportEvents become locals here.
//    (Same caveat: never write the interpolation token or backticks in
//    a comment — the outer template literal would re-inline the module.)
${ANNO_INPUT_RUNTIME_JS}
// f3d:runtime-js:kernel END`;
}

// ── js:glue — the Live Guided Tour glue IIFE (version-static, zero
//    interpolations; the 12 \\ escape pairs below emit single backslashes
//    exactly as the original template literal did).
export const BUILDER_JS_GLUE_SPAN = `// f3d:runtime-js:glue BEGIN v=1 family=builder
(function initLiveGuide(){
  // Desktop-only Live Tour: collaboration is gated by the shared fail-closed
  // predicate from the anno-input kernel. Ineligible devices (phones,
  // tablets, iPad even with a keyboard/trackpad, ambiguous touch-first
  // environments) get EVERY collaboration affordance removed before any
  // wiring: no PeerJS download, no session controller, no mic, no clipboard
  // sync, no annotation surfaces, nothing focusable. Solo viewing, sharing,
  // fullscreen and PWA behavior are untouched. Fails closed if the kernel
  // is missing.
  var COLLAB_ELIGIBLE=(typeof annoCollabEligible==="function")&&annoCollabEligible(typeof window!=="undefined"?window:null,typeof navigator!=="undefined"?navigator:null);
  if(!COLLAB_ELIGIBLE){
    var collabIds=["hud-live-tour-btn","live-tour-drawer","live-tour-control-drawer","drawer-live-guide","loc-sync","loc-sync-tips","live-tour-navlock","anno-toolbar","anno-canvas","remote-pointer","lg-audio"];
    for(var ci=0;ci<collabIds.length;ci++){
      var cn=document.getElementById(collabIds[ci]);
      if(!cn) continue;
      if(cn.parentNode&&typeof cn.parentNode.removeChild==="function"){ cn.parentNode.removeChild(cn); }
      else { cn.hidden=true; }
    }
    return;
  }
  var section=document.getElementById("drawer-live-guide");
  if(!section) return;
  if(typeof createLiveSession!=="function") return;
  // Eligible desktop: reveal the launch affordances that ship hidden so
  // ineligible devices never flash them before this glue runs.
  section.hidden=false;
  var hudLiveTourBtn=document.getElementById("hud-live-tour-btn");
  if(hudLiveTourBtn) hudLiveTourBtn.hidden=false;

  var visitorPane=document.getElementById("lg-visitor");
  var agentPane=document.getElementById("lg-agent");
  var pinInput=document.getElementById("lg-pin-input");
  var joinBtn=document.getElementById("lg-join-btn");
  var visitorStatus=document.getElementById("lg-visitor-status");
  var toggleAgentLink=document.getElementById("lg-toggle-agent");
  var startBtn=document.getElementById("lg-start-btn");
  var toggleVisitorLink=document.getElementById("lg-toggle-visitor");
  var pinValue=document.getElementById("lg-pin-value");
  var agentStatus=document.getElementById("lg-agent-status");
  var stopsContainer=document.getElementById("lg-stops");
  var preJoinBlock=document.getElementById("lg-agent-prejoin");
  var activeBlock=document.getElementById("lg-agent-active");
  var audioEl=document.getElementById("lg-audio");
  var leaveBtn=document.getElementById("lt-leave-btn");
  var ltDrawer=document.getElementById("live-tour-control-drawer");
  // Sync My View button + instruction panel removed. The visitor now
  // shares views via clipboard auto-polling (see auto-share pill below)
  // so opening any drawer/panel — which would steal iframe focus and
  // break the U key — is no longer required for the main flow.
  function closeLtSyncPanel(){ /* retained as no-op for legacy callers */ }

  // Lazy PeerJS (pinned + SRI, declared inert in the head dep span):
  // downloaded ONLY when this eligible desktop user actually starts or
  // joins a Live Tour. Concurrent Start/Join clicks share one promise;
  // a failure or 12s timeout resets it so the next click retries, with
  // the error surfaced on the role status line. The controller receives
  // a forwarding constructor so it can be built now (network-inert) and
  // still pick up the lazily-loaded Peer global at connect time.
  var peerJsPromise=null;
  function ensurePeerJs(){
    if(typeof Peer==="function") return Promise.resolve(true);
    if(peerJsPromise) return peerJsPromise;
    peerJsPromise=new Promise(function(resolve,reject){
      var cfg=document.getElementById("f3d-peerjs-loader");
      var src=cfg&&typeof cfg.getAttribute==="function"?cfg.getAttribute("data-src"):null;
      if(!src){ reject(new Error("PeerJS loader config missing")); return; }
      var s=document.createElement("script");
      s.src=src;
      var integ=cfg.getAttribute("data-integrity");
      if(integ) s.integrity=integ;
      var cross=cfg.getAttribute("data-crossorigin");
      if(cross) s.crossOrigin=cross;
      var done=false;
      // Failure cleanup: clear the watchdog, detach handlers (so a late
      // load/error from this dead element is doubly inert on top of the done
      // guard), and remove the failed <script> from the DOM so a retry never
      // stacks tags.
      function cleanup(){
        try { clearTimeout(timer); } catch(_e){}
        s.onload=null; s.onerror=null;
        try { if(s.parentNode&&typeof s.parentNode.removeChild==="function") s.parentNode.removeChild(s); } catch(_e){}
      }
      var timer=setTimeout(function(){
        if(done) return; done=true;
        cleanup();
        reject(new Error("PeerJS load timed out"));
      },12000);
      s.onload=function(){
        if(done) return; done=true;
        if(typeof Peer==="function"){ try { clearTimeout(timer); } catch(_e){} resolve(true); }
        else { cleanup(); reject(new Error("PeerJS loaded without a Peer global")); }
      };
      s.onerror=function(){
        if(done) return; done=true;
        cleanup();
        reject(new Error("PeerJS failed to load"));
      };
      (document.head||document.documentElement).appendChild(s);
    });
    peerJsPromise.then(null,function(){ peerJsPromise=null; });
    return peerJsPromise;
  }
  function lazyPeerCtor(id){ return new Peer(id); }

  var session=createLiveSession({PeerCtor:lazyPeerCtor});
  var lastTeleportTs=0;
  var wasConnected=false;

  // ── Annotation overlay state (Phase 1) ─────────────────────────────
  // currentViewKey mirrors the controller's _currentViewKey on this
  // side; we keep a local copy so agent senders can stamp every
  // outbound packet with the active view. Stays in lock-step because
  // we update it in applyTeleport (the single point that changes the
  // visible Matterport sweep on either end).
  var letterboxWrap=document.getElementById("anno-letterbox-wrap");
  var annoCanvas=document.getElementById("anno-canvas");
  // Annotation-input kernel availability (anno-input.mjs injected as locals
  // above). Fail-closed: when any helper is missing keep Matterport
  // viewing / pointer / clear / location-sync live but refuse Draw and
  // Focus Rope rather than run them unhardened.
  var ANNO_INPUT_OK=(typeof createAnnoPointerGuard==="function"&&typeof annoCollectPoints==="function"&&typeof annoClampDpr==="function"&&typeof annoBudgetDpr==="function"&&typeof annoIsIosWebKit==="function"&&typeof annoIsCoarsePointer==="function"&&typeof annoBindViewportEvents==="function");
  var IS_IOS_WEBKIT=(typeof annoIsIosWebKit==="function")?annoIsIosWebKit(typeof navigator!=="undefined"?navigator:null):false;
  // Lazy annotation canvas: nothing is allocated at page load or at PIN
  // connect (a full-viewport high-DPI 2D buffer beside the Matterport WebGL
  // context is a real iPad memory risk). The context + a DPR-budgeted
  // buffer allocate on first Draw/Rope or first inbound remote stroke.
  var annoCtx=null;
  var annoCanvasAllocated=false;
  var annoAppliedDpr=1;
  var annoToolbar=document.getElementById("anno-toolbar");
  var remotePointer=document.getElementById("remote-pointer");
  var clearBtn=document.getElementById("anno-clear-btn");

  var ANNO_STROKE_COLOR="#ff3b30";
  var ANNO_STROKE_WIDTH=0.004;
  var ANNO_REMOTE_POINTER_TIMEOUT_MS=2500;

  var toolMode="none";
  var currentViewKey="";
  var localStrokes=[];
  var activeStroke=null;
  var pendingStrokePoints=null;
  var pendingStrokeId=null;
  var strokeFlushScheduled=false;
  var lastPointerSeq=0;
  var lastStrokeSeq=0;
  var lastClearSeq=0;
  var lastNavLockSeq=0;
  var lastStrokeDeleteSeq=0;
  var remotePointerHideTimer=null;
  // Shared annotation "floor": a gesture-scoped, invisible turn lock carried
  // on the existing nav_lock message. While the PEER holds the floor
  // (remoteGestureActive) this side won't START a new Draw/Rope/Eraser gesture
  // and its Matterport is frozen; the instant the peer's gesture ends
  // (nav_lock:false or the bounded safety timeout) annotation + navigation
  // free up again. Engaged per-gesture (pointerdown), released on every
  // gesture-end path. No visible turn UI.
  var FLOOR_SAFETY_MS=8000;
  // Keepalive cadence — comfortably below FLOOR_SAFETY_MS so the peer's remote
  // watchdog is always re-armed well before it can expire mid-gesture.
  var FLOOR_HEARTBEAT_MS=Math.floor(FLOOR_SAFETY_MS/3);
  var remoteGestureActive=false;
  var remoteFloorTimer=null;
  var localFloorHeld=false;
  var localFloorTimer=null;
  var lastFloorHeartbeatTs=0;
  // Eraser tool: tap- or drag-delete of committed strokes (geometric hit
  // test). eraserDeletedIds dedupes a drag so each stroke is removed once.
  var ANNO_ERASER_TOLERANCE_PX=12;
  var eraserActive=false;
  var eraserDeletedIds=null;
  // Focus Rope state — agent-only authoring of a circle/box outline
  // overlay. The rope is rendered as a polyline (48 pts circle, 5 pts
  // closed box) so it travels over the wire as a regular stroke.
  // activeRope is non-null while the agent is creating or resizing
  // one; once committed (tool switch / clear / teleport / new rope)
  // it stays in localStrokes as a normal stroke entry.
  var ANNO_ROPE_SHAPE="circle";
  var ANNO_ROPE_SHAPE_WHITELIST={circle:1,box:1};
  var ANNO_ROPE_CIRCLE_SAMPLES=48;
  var ANNO_LATCH_PX=10;
  // Coarse-pointer (touch/pen) gets a larger latch + a 44px-class hit target.
  var IS_COARSE_POINTER=(typeof annoIsCoarsePointer==="function")?annoIsCoarsePointer(window):false;
  var ANNO_LATCH_DRAW_PX=IS_COARSE_POINTER?14:ANNO_LATCH_PX;
  var activeRope=null;          // {strokeId,color,width,shape,x0,y0,x1,y1}
  var ropeDragging=false;       // initial draw drag
  var ropeLatchDragging=false;  // resize via latch handle
  var ropeMoveDragging=false;   // body-drag move of the whole rope
  var ropeMoveLast=null;        // last normalized point during a move-drag
  var ropeFlushScheduled=false;

  // After a visitor connects, auto-close the Live Tour drawer so the
  // tour fills the screen. The HUD header (and the Live Tour button)
  // remains visible so the visitor can reopen the panel anytime.
  function hideOverlaysForLiveTour(){
    try { if(window.__closeLiveTour) window.__closeLiveTour(); } catch(_e){}
  }

  // Reflect session state on the HUD Live Tour button.
  function setHudButtonState(state){
    var btn=document.getElementById("hud-live-tour-btn");
    if(!btn) return;
    btn.classList.remove("is-waiting","connected");
    if(state.isConnected) btn.classList.add("connected");
    else if(state.status==="waiting"||state.status==="connecting"||state.status==="initializing") btn.classList.add("is-waiting");
  }

  // Reset the Live-Guide UI back to the idle (visitor-default) state.
  // Called after dispose() so the user can start a new session without
  // a page reload.
  function resetUiToIdle(){
    if(visitorPane) visitorPane.hidden=false;
    if(agentPane) agentPane.hidden=true;
    if(preJoinBlock) preJoinBlock.hidden=false;
    if(activeBlock) activeBlock.hidden=true;
    if(joinBtn) joinBtn.disabled=false;
    if(startBtn) startBtn.disabled=false;
    if(pinInput) pinInput.value="";
    if(pinValue) pinValue.innerHTML="&mdash;&mdash;&mdash;&mdash;";
    if(visitorStatus) visitorStatus.textContent="";
    if(agentStatus) agentStatus.textContent="";
    if(stopsContainer) stopsContainer.innerHTML="";
    if(audioEl){ try { audioEl.srcObject=null; } catch(_e){} }
  }

  // ── Annotation helpers ─────────────────────────────────────────────
  // All math is in normalized [0,1] space relative to the letterbox
  // wrap. Both ends store the same numbers on the wire; the renderer
  // multiplies by current canvas pixels at draw time so a viewport
  // resize on either side stays consistent.
  // Move the #drawer-live-guide subtree between its two homes so that
  // there is only ever ONE live-tour panel on screen. Listeners survive
  // appendChild (it relocates, does not clone) so PIN entry, Start as
  // Agent, Tour Stops clicks etc. keep working without rewiring. Safe
  // to call repeatedly — if the node is already at the requested home
  // appendChild is a no-op.
  function relocateLiveGuide(toLeft){
    try {
      var guide=document.getElementById("drawer-live-guide");
      if(!guide) return;
      var leftHome=document.getElementById("ltcd-live-guide-slot");
      var rightHome=document.getElementById("live-tour-inner");
      var target=toLeft?leftHome:rightHome;
      if(target && guide.parentNode!==target){
        target.appendChild(guide);
      }
    } catch(_e){}
  }

  function setBodyLetterboxClass(active,isAgent){
    if(!document||!document.body) return;
    if(active){
      document.body.classList.add("live-tour-active");
      if(isAgent){
        document.body.classList.add("live-tour-agent");
        document.body.classList.remove("live-tour-visitor");
      } else {
        document.body.classList.add("live-tour-visitor");
        document.body.classList.remove("live-tour-agent");
      }
      relocateLiveGuide(true);
    } else {
      document.body.classList.remove("live-tour-active");
      document.body.classList.remove("live-tour-agent");
      document.body.classList.remove("live-tour-visitor");
      relocateLiveGuide(false);
    }
    // Reset the chevron-driven HUD visibility whenever the mode switches
    // so the newly-active header (regular ↔ live-tour) starts collapsed
    // and never inherits a stale "visible" state from the previous mode.
    try { if(typeof window.__setHudVisible==="function") window.__setHudVisible(false); } catch(_e){}
    // Auto-open the LEFT drawer for the agent on connection so they
    // immediately see the merged PIN + Tour Stops panel without a
    // chevron click. Visitor still auto-closes (see onState) so the
    // 3D tour fills their screen.
    if(active && isAgent){
      try { if(typeof window.__setHudVisible==="function") window.__setHudVisible(true); } catch(_e){}
    }
  }

  // Notify the embedding Atlas app (parent window) that an interaction needing
  // stable touch gestures has begun — Pointer / Draw / Focus Rope selection or
  // a live session connecting. The app-shell parent drops native Device
  // fullscreen into Maximize on iPad so the swipe-exit gesture can't collapse
  // fullscreen mid-draw. Same f3d: postMessage namespace as the share bridge
  // (the parent half origin-checks via event.source). NO-OP when there is no
  // distinct parent — a presentation opened directly (not embedded in the
  // Atlas modal) posts nothing, so direct standalone viewing is unaffected.
  // This is the runtime-2.0.3 interaction behavior, ported to the Builder
  // adapter so a Builder package never advertises 2.0.3 without carrying it.
  function emitInteractionActive(){
    try {
      if(typeof window==="undefined") return;
      if(!window.parent||window.parent===window) return;
      window.parent.postMessage({ type:"f3d:interaction-active" },"*");
    } catch(_e){}
  }

  function setToolMode(mode){
    // Fail-closed: Draw / Focus Rope require the hardened input kernel.
    if((mode==="draw"||mode==="rope")&&!ANNO_INPUT_OK) return;
    // Allocate the annotation canvas lazily on the first authoring entry.
    if(mode==="draw"||mode==="rope") ensureAnnoCanvasAllocated();
    // Interaction signal (runtime 2.0.3): Pointer / Draw / Rope all need
    // stable touch — ask the embedding app to leave native iPad fullscreen.
    if(mode==="pointer"||mode==="draw"||mode==="rope"||mode==="eraser") emitInteractionActive();
    var prev=toolMode;
    toolMode=mode;
    if(annoCanvas){
      annoCanvas.classList.remove("pointer-mode","draw-mode","rope-mode","eraser-mode");
      if(mode==="pointer") annoCanvas.classList.add("pointer-mode");
      else if(mode==="draw") annoCanvas.classList.add("draw-mode");
      else if(mode==="rope") annoCanvas.classList.add("rope-mode");
      else if(mode==="eraser") annoCanvas.classList.add("eraser-mode");
    }
    if(annoToolbar){
      var btns=annoToolbar.querySelectorAll(".anno-tool-btn[data-tool]");
      for(var i=0;i<btns.length;i++){
        var b=btns[i];
        if(b.getAttribute("data-tool")===mode) b.classList.add("active");
        else b.classList.remove("active");
      }
    }
    // Toggle the body class that reveals the rope shape dropdown only
    // while the Focus Rope tool is active. Keeps the toolbar compact
    // for Pointer/Draw and merges the rope button + shape picker into
    // one cohesive control.
    try {
      document.body.classList.toggle("anno-rope-active", mode==="rope");
      // Stage gesture hardening (wrapper touch-action / WebKit defenses + the
      // stage-event kills) engages ONLY while a tool is active, so Matterport
      // navigation is untouched the rest of the time.
      document.body.classList.toggle("anno-tool-active", mode==="pointer"||mode==="draw"||mode==="rope"||mode==="eraser");
    } catch(_e){}
    // Auto-open the shape <select> on the click that activates rope
    // mode so the agent immediately sees Circle/Box without a second
    // click. Guarded — showPicker isn't on every browser.
    if(prev!=="rope"&&mode==="rope"){
      try {
        var sel=document.getElementById("anno-shape-select");
        if(sel){
          sel.focus();
          if(typeof sel.showPicker==="function") sel.showPicker();
        }
      } catch(_e){}
    }
    if(prev==="pointer"&&mode!=="pointer"){
      // Leaving pointer tool while connected: hide the remote dot on
      // the other peer by sending a null-position pointer event. Both
      // roles emit — annotations are bidirectional.
      var s=session.getState();
      if((s.role==="agent"||s.role==="visitor")&&s.isConnected){
        session.sendPointer(currentViewKey,null,null);
      }
    }
    if(prev==="rope"&&mode!=="rope"){
      // Leaving rope tool: bake the active rope (commit on the wire,
      // drop the latch) so the next interaction starts fresh. The
      // points stay in localStrokes as a regular committed stroke.
      commitActiveRope();
    }
    // The peer-freeze is now GESTURE-scoped (the shared annotation floor),
    // engaged on pointerdown and released on gesture end — not tied to which
    // tool is selected. So a tool change just ends any floor this side still
    // holds; navigation stays normal between gestures (both peers free).
    try { releaseLocalFloor(); } catch(_e){}
  }

  // Lazy allocation: create the 2D context + size a DPR-budgeted buffer on
  // first real need. Idempotent; safe to call from any authoring/remote
  // entry point. Returns false if the canvas element is missing.
  function ensureAnnoCanvasAllocated(){
    if(annoCanvasAllocated) return true;
    if(!annoCanvas) return false;
    try { annoCtx=annoCanvas.getContext("2d"); } catch(_e){ annoCtx=null; }
    if(!annoCtx) return false;
    annoCanvasAllocated=true;
    resizeAnnoCanvas();
    return true;
  }

  function resizeAnnoCanvas(){
    if(!annoCanvas||!letterboxWrap||!annoCtx) return;
    var rect=letterboxWrap.getBoundingClientRect();
    var w=Math.max(1,Math.round(rect.width));
    var h=Math.max(1,Math.round(rect.height));
    // DPR clamp + absolute backing-store budget. A 3x phone at full
    // viewport would otherwise allocate a ~100MB RGBA buffer next to the
    // Matterport WebGL context; iOS gets the tighter cap (1.5 / 4.19MP).
    var rawDpr=window.devicePixelRatio||1;
    var dpr=ANNO_INPUT_OK?annoClampDpr(rawDpr,IS_IOS_WEBKIT?1.5:2.5):rawDpr;
    if(ANNO_INPUT_OK) dpr=annoBudgetDpr(w,h,dpr,IS_IOS_WEBKIT?4194304:9437184);
    annoAppliedDpr=dpr;
    annoCanvas.width=Math.max(1,Math.round(w*dpr));
    annoCanvas.height=Math.max(1,Math.round(h*dpr));
    annoCanvas.style.width=w+"px";
    annoCanvas.style.height=h+"px";
    try { annoCtx.setTransform(dpr,0,0,dpr,0,0); } catch(_e){}
    redrawAllStrokes();
  }

  function redrawAllStrokes(){
    if(!annoCtx||!annoCanvas) return;
    var dpr=annoAppliedDpr||window.devicePixelRatio||1;
    var w=annoCanvas.width/dpr;
    var h=annoCanvas.height/dpr;
    annoCtx.clearRect(0,0,w,h);
    for(var i=0;i<localStrokes.length;i++) drawStroke(localStrokes[i],w,h);
    if(activeStroke) drawStroke(activeStroke,w,h);
    if(activeRope) drawRopeLatch(activeRope,w,h);
  }

  function drawStroke(stroke,w,h){
    if(!stroke||!stroke.points||stroke.points.length===0) return;
    var color=stroke.color||ANNO_STROKE_COLOR;
    var width=typeof stroke.width==="number"?stroke.width:ANNO_STROKE_WIDTH;
    annoCtx.strokeStyle=color;
    annoCtx.lineWidth=Math.max(1,width*w);
    annoCtx.lineCap="round";
    annoCtx.lineJoin="round";
    annoCtx.beginPath();
    var p0=stroke.points[0];
    annoCtx.moveTo(p0[0]*w,p0[1]*h);
    if(stroke.points.length===1){
      annoCtx.lineTo(p0[0]*w+0.01,p0[1]*h+0.01);
    } else {
      for(var i=1;i<stroke.points.length;i++){
        var p=stroke.points[i];
        annoCtx.lineTo(p[0]*w,p[1]*h);
      }
    }
    annoCtx.stroke();
  }

  function findLocalStroke(id){
    for(var i=0;i<localStrokes.length;i++){
      if(localStrokes[i].strokeId===id) return localStrokes[i];
    }
    return null;
  }

  function clientToNorm(e){
    if(!letterboxWrap) return {x:0,y:0};
    var rect=letterboxWrap.getBoundingClientRect();
    var w=rect.width||1;
    var h=rect.height||1;
    var x=(e.clientX-rect.left)/w;
    var y=(e.clientY-rect.top)/h;
    if(x<0) x=0; else if(x>1) x=1;
    if(y<0) y=0; else if(y>1) y=1;
    return {x:x,y:y};
  }

  // Normalized [x,y] tuples for the active draw stroke, expanding the
  // browser's coalesced pointer history when present. A 120Hz Pencil
  // delivers several raw samples per rendered frame; using only the
  // dispatched event drops them and segments the ink. Falls back to the
  // single event (and to a bare clientToNorm if the kernel is absent).
  function collectNormTuples(e){
    if(ANNO_INPUT_OK&&typeof annoCollectPoints==="function"){
      return annoCollectPoints(e,function(ev){ var p=clientToNorm(ev); return [p.x,p.y]; });
    }
    var p0=clientToNorm(e);
    return [[p0.x,p0.y]];
  }

  function scheduleStrokeFlush(){
    if(strokeFlushScheduled) return;
    strokeFlushScheduled=true;
    var raf=window.requestAnimationFrame||function(cb){ return setTimeout(cb,16); };
    raf(function(){
      strokeFlushScheduled=false;
      if(!pendingStrokeId||!pendingStrokePoints||pendingStrokePoints.length===0) return;
      var batch=pendingStrokePoints;
      pendingStrokePoints=[];
      session.sendStrokePatch(currentViewKey,pendingStrokeId,batch);
    });
  }

  // ── Focus Rope helpers ─────────────────────────────────────────────
  // Ropes are rendered as polylines so the existing stroke pipeline
  // (drawStroke + the live-session stroke_* packets) handles them with
  // no protocol changes. The latch is purely a local agent affordance.
  function ropeBBox(rope){
    var x0=Math.min(rope.x0,rope.x1),y0=Math.min(rope.y0,rope.y1);
    var x1=Math.max(rope.x0,rope.x1),y1=Math.max(rope.y0,rope.y1);
    return {x0:x0,y0:y0,x1:x1,y1:y1};
  }
  function ropeToPoints(rope){
    var b=ropeBBox(rope);
    var cx=(b.x0+b.x1)/2,cy=(b.y0+b.y1)/2;
    var rx=(b.x1-b.x0)/2,ry=(b.y1-b.y0)/2;
    var out=[];
    if(rope.shape==="box"){
      out.push([b.x0,b.y0]);
      out.push([b.x1,b.y0]);
      out.push([b.x1,b.y1]);
      out.push([b.x0,b.y1]);
      out.push([b.x0,b.y0]);
    } else {
      var n=ANNO_ROPE_CIRCLE_SAMPLES;
      for(var i=0;i<=n;i++){
        var t=(i/n)*Math.PI*2;
        var x=cx+Math.cos(t)*rx;
        var y=cy+Math.sin(t)*ry;
        if(x<0)x=0;else if(x>1)x=1;
        if(y<0)y=0;else if(y>1)y=1;
        out.push([x,y]);
      }
    }
    return out;
  }
  function ropeLatchPos(rope){
    var b=ropeBBox(rope);
    return {x:b.x1,y:b.y1};
  }
  function ropePointInBBox(rope,pt){
    var b=ropeBBox(rope);
    return pt.x>=b.x0&&pt.x<=b.x1&&pt.y>=b.y0&&pt.y<=b.y1;
  }
  // Latch hit radius: 24px (48px target) for touch/pen so the resize handle
  // meets the 44px minimum; mouse keeps the precise 20px zone.
  function latchHitRadiusPx(e){
    var t=e&&typeof e.pointerType==="string"?e.pointerType:"";
    if(t==="touch"||t==="pen"||IS_COARSE_POINTER) return 24;
    return ANNO_LATCH_PX*2;
  }
  function drawRopeLatch(rope,w,h){
    if(!annoCtx) return;
    var lp=ropeLatchPos(rope);
    var px=lp.x*w, py=lp.y*h;
    var r=Math.max(5,Math.min(ANNO_LATCH_DRAW_PX,16));
    annoCtx.beginPath();
    annoCtx.arc(px,py,r,0,Math.PI*2);
    annoCtx.fillStyle=rope.color||ANNO_STROKE_COLOR;
    annoCtx.fill();
    annoCtx.lineWidth=2;
    annoCtx.strokeStyle="#ffffff";
    annoCtx.stroke();
  }
  function ropeRegenerate(rope){
    rope.points=ropeToPoints(rope);
  }
  function scheduleRopeFlush(){
    if(ropeFlushScheduled) return;
    ropeFlushScheduled=true;
    var raf=window.requestAnimationFrame||function(cb){ return setTimeout(cb,16); };
    raf(function(){
      ropeFlushScheduled=false;
      if(!activeRope) return;
      var s=session.getState();
      if((s.role!=="agent"&&s.role!=="visitor")||!s.isConnected) return;
      session.sendStrokeBegin(currentViewKey,activeRope.strokeId,activeRope.color,activeRope.width,activeRope.points);
    });
  }
  function commitActiveRope(){
    if(!activeRope) return;
    var s=session.getState();
    if((s.role==="agent"||s.role==="visitor")&&s.isConnected){
      // Flush a final shape snapshot before the commit so the peer
      // ends up with the exact bbox the annotator let go of.
      session.sendStrokeBegin(currentViewKey,activeRope.strokeId,activeRope.color,activeRope.width,activeRope.points);
      session.sendStrokeCommit(currentViewKey,activeRope.strokeId);
    }
    activeRope.committed=true;       // sealed rope is now erasable (same obj in localStrokes)
    activeRope=null;
    ropeDragging=false;
    ropeLatchDragging=false;
    ropeMoveDragging=false;
    ropeMoveLast=null;
    redrawAllStrokes();
  }

  function wipeAnnotations(){
    localStrokes=[];
    activeStroke=null;
    pendingStrokeId=null;
    pendingStrokePoints=null;
    activeRope=null;
    ropeDragging=false;
    ropeLatchDragging=false;
    ropeMoveDragging=false;
    ropeMoveLast=null;
    eraserActive=false;
    eraserDeletedIds=null;
    if(annoGuard) annoGuard.reset();
    if(remotePointer){
      remotePointer.style.display="none";
    }
    if(remotePointerHideTimer){
      try { clearTimeout(remotePointerHideTimer); } catch(_e){}
      remotePointerHideTimer=null;
    }
    redrawAllStrokes();
  }

  // Toggle the transparent overlay that swallows pointer/touch input
  // on the Matterport iframe while the OTHER peer is annotating. Each
  // side only locks itself in response to an inbound nav_lock packet —
  // annotators never lock themselves so they can keep teleporting.
  // Safe to call when the overlay element isn't present yet.
  function applyNavLock(locked){
    try {
      var ov=document.getElementById("live-tour-navlock");
      if(!ov) return;
      if(locked) ov.classList.add("locked");
      else ov.classList.remove("locked");
    } catch(_e){}
  }

  // ── Shared annotation floor (gesture-scoped, invisible) ─────────────
  // acquireLocalFloor: call at the START of a Draw/Rope/Eraser gesture.
  // Returns false (caller bails) when the peer currently holds the floor —
  // that is the invisible sequential-annotation rule. On success it
  // broadcasts nav_lock(true) so the peer freezes its Matterport and won't
  // begin a competing gesture, and arms a bounded local safety timeout.
  function acquireLocalFloor(){
    if(remoteGestureActive) return false;
    if(!localFloorHeld){
      localFloorHeld=true;
      lastFloorHeartbeatTs=Date.now(); // the initial lock is the first beat
      var s=session.getState();
      if((s.role==="agent"||s.role==="visitor")&&s.isConnected){
        session.sendNavLock(currentViewKey,true);
      }
    }
    if(localFloorTimer){ try { clearTimeout(localFloorTimer); } catch(_e){} }
    localFloorTimer=setTimeout(function(){ releaseLocalFloor(); },FLOOR_SAFETY_MS);
    return true;
  }
  // releaseLocalFloor: idempotent; call on EVERY gesture-end path (pointerup,
  // pointercancel, lostpointercapture, tool change, disconnect) and from the
  // safety timeout. Broadcasts nav_lock(false) so the peer frees immediately.
  function releaseLocalFloor(){
    if(localFloorTimer){ try { clearTimeout(localFloorTimer); } catch(_e){} localFloorTimer=null; }
    lastFloorHeartbeatTs=0; // stop heartbeats; next gesture starts a fresh cadence
    if(!localFloorHeld) return;
    localFloorHeld=false;
    var s=session.getState();
    if((s.role==="agent"||s.role==="visitor")&&s.isConnected){
      session.sendNavLock(currentViewKey,false);
    }
  }
  // Push the safety watchdog out on owned-gesture activity so a long but
  // healthy stroke/rope/erase keeps the floor for its whole duration. The
  // timeout only fires ~FLOOR_SAFETY_MS after activity actually STOPS — the
  // genuine "pointerup/cancel never arrived" crash case — not mid-gesture.
  function refreshLocalFloor(){
    if(!localFloorHeld) return;
    if(localFloorTimer){ try { clearTimeout(localFloorTimer); } catch(_e){} }
    localFloorTimer=setTimeout(function(){ releaseLocalFloor(); },FLOOR_SAFETY_MS);
  }
  // Throttled keepalive for the PEER's remote watchdog. The local watchdog is
  // refreshed in-process (refreshLocalFloor), but the peer only re-arms its own
  // when it hears from us — and an Eraser drag emits stroke_delete ONLY when it
  // hits a stroke (nothing over blank space), so stroke traffic is not a
  // reliable keepalive. While we hold the floor on an active gesture and are
  // connected, re-broadcast nav_lock(true) at most once per FLOOR_HEARTBEAT_MS.
  // Movement-driven: a stationary/abandoned gesture stops beating and both
  // sides release via the safety timeout. nav_lock is ordered + seq-deduped on
  // the wire, so duplicate beats are harmless and a stale beat can never relock
  // after the final nav_lock(false).
  function floorHeartbeat(){
    if(!localFloorHeld) return;
    var s=session.getState();
    if((s.role!=="agent"&&s.role!=="visitor")||!s.isConnected) return;
    var now=Date.now();
    if(now-lastFloorHeartbeatTs<FLOOR_HEARTBEAT_MS) return;
    lastFloorHeartbeatTs=now;
    session.sendNavLock(currentViewKey,true);
  }
  // setRemoteFloor: react to an inbound nav_lock. Freezes/unfreezes this
  // side's Matterport (applyNavLock) AND gates new local gesture starts. A
  // bounded timeout auto-clears so a peer that crashes mid-gesture can never
  // lock this side out forever; ongoing remote stroke activity refreshes it.
  function setRemoteFloor(active){
    remoteGestureActive=active===true;
    applyNavLock(remoteGestureActive);
    if(remoteFloorTimer){ try { clearTimeout(remoteFloorTimer); } catch(_e){} remoteFloorTimer=null; }
    if(remoteGestureActive){
      remoteFloorTimer=setTimeout(function(){
        remoteGestureActive=false;
        applyNavLock(false);
        remoteFloorTimer=null;
      },FLOOR_SAFETY_MS);
    }
  }
  function refreshRemoteFloor(){ if(remoteGestureActive) setRemoteFloor(true); }

  // ── Eraser hit-testing (point-to-polyline distance, touch-tolerant) ──
  function pointSegDistPx(px,py,ax,ay,bx,by){
    var vx=bx-ax, vy=by-ay, wx=px-ax, wy=py-ay;
    var c1=vx*wx+vy*wy;
    if(c1<=0){ return Math.sqrt(wx*wx+wy*wy); }
    var c2=vx*vx+vy*vy;
    if(c2<=c1){ var ex=px-bx, ey=py-by; return Math.sqrt(ex*ex+ey*ey); }
    var t=c1/c2, projx=ax+t*vx, projy=ay+t*vy, dxp=px-projx, dyp=py-projy;
    return Math.sqrt(dxp*dxp+dyp*dyp);
  }
  function strokeHitTest(stroke,pt,rect,tolPx){
    var pts=stroke&&stroke.points;
    if(!pts||pts.length===0) return false;
    var w=rect.width||1, h=rect.height||1;
    var px=pt.x*w, py=pt.y*h;
    var halfWidthPx=(typeof stroke.width==="number"?stroke.width:ANNO_STROKE_WIDTH)*w/2;
    var tol=Math.max(tolPx,halfWidthPx+tolPx*0.5);
    if(pts.length===1){
      var dx0=pts[0][0]*w-px, dy0=pts[0][1]*h-py;
      return Math.sqrt(dx0*dx0+dy0*dy0)<=tol;
    }
    for(var i=1;i<pts.length;i++){
      if(pointSegDistPx(px,py,pts[i-1][0]*w,pts[i-1][1]*h,pts[i][0]*w,pts[i][1]*h)<=tol) return true;
    }
    return false;
  }
  // Erase every COMMITTED stroke whose geometry is within tolerance of pt.
  // In-flight (uncommitted) local OR remote strokes are skipped. Each stroke
  // is removed at most once per eraser gesture; deletions sync via stroke_delete.
  function eraseAtPoint(pt,e){
    if(!localStrokes.length) return;
    var rect=letterboxWrap?letterboxWrap.getBoundingClientRect():{width:1,height:1};
    var tolPx=ANNO_ERASER_TOLERANCE_PX;
    var ptype=e&&typeof e.pointerType==="string"?e.pointerType:"";
    if(ptype==="touch"||ptype==="pen"||IS_COARSE_POINTER) tolPx=24;
    var hitIds=[];
    for(var i=localStrokes.length-1;i>=0;i--){
      var st=localStrokes[i];
      if(!st||st.committed!==true) continue;
      if(eraserDeletedIds&&eraserDeletedIds[st.strokeId]) continue;
      if(strokeHitTest(st,pt,rect,tolPx)){
        hitIds.push(st.strokeId);
        if(eraserDeletedIds) eraserDeletedIds[st.strokeId]=1;
      }
    }
    if(hitIds.length===0) return;
    localStrokes=localStrokes.filter(function(s){ return hitIds.indexOf(s.strokeId)<0; });
    redrawAllStrokes();
    var s=session.getState();
    if((s.role==="agent"||s.role==="visitor")&&s.isConnected){
      session.sendStrokeDelete(currentViewKey,hitIds);
    }
  }

  function handleClearLocallyAndBroadcast(){
    wipeAnnotations();
    var s=session.getState();
    if((s.role==="agent"||s.role==="visitor")&&s.isConnected){
      session.sendClear(currentViewKey);
    }
  }



  // Canvas pointer wiring — bidirectional. Either role may annotate;
  // toolMode stays "none" until the user picks a tool so handlers are
  // no-ops in idle. Each side renders its own strokes locally; the
  // peer receives them through the DataChannel.
  function _canAnnotateLocal(){
    var r=session.getState().role;
    return r==="agent"||r==="visitor";
  }
  function annotationToolActive(){
    return toolMode==="draw"||toolMode==="rope"||toolMode==="pointer";
  }

  // Finish the in-flight freehand stroke: flush queued points, commit on the
  // wire, promote to localStrokes. Idempotent (no-op when no stroke) so
  // pointerup / pointercancel / lostpointercapture all route here safely.
  function finishActiveDraw(){
    if(!activeStroke) return;
    if(pendingStrokePoints&&pendingStrokePoints.length>0){
      session.sendStrokePatch(currentViewKey,pendingStrokeId,pendingStrokePoints);
    }
    pendingStrokePoints=null;
    session.sendStrokeCommit(currentViewKey,activeStroke.strokeId);
    activeStroke.committed=true;     // eligible for the eraser only once sealed
    localStrokes.push(activeStroke);
    activeStroke=null;
    pendingStrokeId=null;
  }
  // End the in-flight rope drag (initial draw / latch-resize / body-move) and
  // resend the final shape. The rope stays active so its latch remains
  // grabbable; commitActiveRope() seals it on tool exit.
  function finishActiveRopeDrag(){
    if(!activeRope) return;
    if(!ropeDragging&&!ropeLatchDragging&&!ropeMoveDragging) return;
    ropeDragging=false;
    ropeLatchDragging=false;
    ropeMoveDragging=false;
    ropeMoveLast=null;
    var s=session.getState();
    if((s.role==="agent"||s.role==="visitor")&&s.isConnected){
      session.sendStrokeBegin(currentViewKey,activeRope.strokeId,activeRope.color,activeRope.width,activeRope.points);
    }
    redrawAllStrokes();
  }
  // Commit-or-abort for pen takeover, pointercancel, and lostpointercapture.
  // COMMIT the in-flight gesture (the remote side already holds its begin/
  // patch packets, so committing leaves no orphan stroke on either end).
  function finalizeActiveGesture(){
    if(toolMode==="draw") finishActiveDraw();
    else if(toolMode==="rope") finishActiveRopeDrag();
  }

  // Single-owner gesture guard from the shared kernel: one pointer owns a
  // gesture at a time, a second finger can't start one, and a pen takes
  // over from a touch (palm rejection) after committing the touch stroke.
  var annoGuard=ANNO_INPUT_OK?createAnnoPointerGuard({onTakeover:finalizeActiveGesture}):null;

  if(annoCanvas){
    annoCanvas.addEventListener("pointerdown",function(e){
      if(!_canAnnotateLocal()) return;
      // Claim single-owner ownership for the authoring tools so a second
      // finger / palm can't corrupt the in-flight stroke. (A pen arriving
      // mid-touch fires onTakeover → finalizeActiveGesture, then claims.)
      // Then acquire the shared annotation floor: if the PEER is mid-gesture
      // we bail (invisible sequential turn-taking); otherwise we broadcast
      // the floor so they pause + their view freezes for this one gesture.
      if(toolMode==="draw"||toolMode==="rope"||toolMode==="eraser"){
        if(remoteGestureActive) return;
        if(annoGuard&&!annoGuard.claim(e)) return;
        acquireLocalFloor();
      }
      if(toolMode==="draw"){
        var pt=clientToNorm(e);
        var sid=String(Date.now())+"_"+Math.random().toString(36).slice(2,8);
        activeStroke={
          strokeId:sid,
          color:ANNO_STROKE_COLOR,
          width:ANNO_STROKE_WIDTH,
          points:[[pt.x,pt.y]],
        };
        pendingStrokeId=sid;
        pendingStrokePoints=[];
        session.sendStrokeBegin(currentViewKey,sid,activeStroke.color,activeStroke.width,[[pt.x,pt.y]]);
        redrawAllStrokes();
        try { annoCanvas.setPointerCapture(e.pointerId); } catch(_e){}
        e.preventDefault();
        return;
      }
      if(toolMode==="rope"){
        var rpt=clientToNorm(e);
        // Hit-test the latch first: if we're near it, resize the
        // current rope instead of starting a new one.
        if(activeRope){
          var lp=ropeLatchPos(activeRope);
          var rect=letterboxWrap?letterboxWrap.getBoundingClientRect():{width:1,height:1};
          var dx=(rpt.x-lp.x)*rect.width;
          var dy=(rpt.y-lp.y)*rect.height;
          if(Math.sqrt(dx*dx+dy*dy)<=latchHitRadiusPx(e)){
            ropeLatchDragging=true;
            try { annoCanvas.setPointerCapture(e.pointerId); } catch(_e){}
            e.preventDefault();
            return;
          }
          // Inside the rope body (off the latch): drag moves the whole rope
          // — the touch affordance the resize-only latch lacked.
          if(ropePointInBBox(activeRope,rpt)){
            ropeMoveDragging=true;
            ropeMoveLast=rpt;
            try { annoCanvas.setPointerCapture(e.pointerId); } catch(_e){}
            e.preventDefault();
            return;
          }
          // Tapping outside the rope starts a new one — commit the prior
          // one so it bakes into localStrokes.
          commitActiveRope();
        }
        var rsid=String(Date.now())+"_"+Math.random().toString(36).slice(2,8);
        activeRope={
          strokeId:rsid,
          color:ANNO_STROKE_COLOR,
          width:ANNO_STROKE_WIDTH,
          shape:ANNO_ROPE_SHAPE,
          x0:rpt.x,y0:rpt.y,x1:rpt.x,y1:rpt.y,
          points:[[rpt.x,rpt.y]],
        };
        ropeRegenerate(activeRope);
        // Insert into localStrokes so the existing renderer draws it.
        localStrokes.push(activeRope);
        ropeDragging=true;
        scheduleRopeFlush();
        redrawAllStrokes();
        try { annoCanvas.setPointerCapture(e.pointerId); } catch(_e){}
        e.preventDefault();
        return;
      }
      if(toolMode==="eraser"){
        eraserActive=true;
        eraserDeletedIds={};
        try { annoCanvas.setPointerCapture(e.pointerId); } catch(_e){}
        e.preventDefault();
        eraseAtPoint(clientToNorm(e),e);   // tap-to-delete
        return;
      }
    });
    annoCanvas.addEventListener("pointermove",function(e){
      if(!_canAnnotateLocal()) return;
      if(toolMode==="pointer"){
        // Only the primary pointer drives the shared remote dot.
        if(e.isPrimary===false) return;
        var ppt=clientToNorm(e);
        session.sendPointer(currentViewKey,ppt.x,ppt.y);
        return;
      }
      // Draw / Rope only advance for the pointer that owns the gesture.
      if(annoGuard&&!annoGuard.owns(e)) return;
      // Owned gesture: suppress any default WebKit handling for the move.
      e.preventDefault();
      refreshLocalFloor();   // keep OUR watchdog alive while this gesture is active
      floorHeartbeat();      // throttled nav_lock(true) keepalive for the remote watchdog
      if(toolMode==="draw"&&activeStroke){
        var pts=collectNormTuples(e);
        if(pts.length>0){
          for(var ci=0;ci<pts.length;ci++){
            activeStroke.points.push(pts[ci]);
            if(!pendingStrokePoints) pendingStrokePoints=[];
            pendingStrokePoints.push(pts[ci]);
          }
          scheduleStrokeFlush();
          redrawAllStrokes();
        }
      } else if(toolMode==="rope"&&activeRope&&ropeMoveDragging){
        var mpt=clientToNorm(e);
        var b=ropeBBox(activeRope);
        var mdx=mpt.x-ropeMoveLast.x;
        var mdy=mpt.y-ropeMoveLast.y;
        // Clamp the translation so the bbox never leaves [0,1] space.
        if(mdx<-b.x0) mdx=-b.x0;
        if(mdx>1-b.x1) mdx=1-b.x1;
        if(mdy<-b.y0) mdy=-b.y0;
        if(mdy>1-b.y1) mdy=1-b.y1;
        activeRope.x0+=mdx;
        activeRope.x1+=mdx;
        activeRope.y0+=mdy;
        activeRope.y1+=mdy;
        ropeMoveLast=mpt;
        ropeRegenerate(activeRope);
        scheduleRopeFlush();
        redrawAllStrokes();
      } else if(toolMode==="rope"&&activeRope&&(ropeDragging||ropeLatchDragging)){
        var rpt=clientToNorm(e);
        activeRope.x1=rpt.x;
        activeRope.y1=rpt.y;
        ropeRegenerate(activeRope);
        scheduleRopeFlush();
        redrawAllStrokes();
      } else if(toolMode==="eraser"&&eraserActive){
        // Drag-erase: hit-test every coalesced sample so a fast sweep never
        // skips a stroke; eraserDeletedIds keeps each removal to one.
        var epts=collectNormTuples(e);
        for(var ei=0;ei<epts.length;ei++) eraseAtPoint({x:epts[ei][0],y:epts[ei][1]},e);
      }
    });
    annoCanvas.addEventListener("pointerup",function(e){
      if(!_canAnnotateLocal()) return;
      if(annoGuard&&!annoGuard.owns(e)){
        try { annoCanvas.releasePointerCapture(e.pointerId); } catch(_e){}
        return;
      }
      e.preventDefault();
      if(toolMode==="draw"&&activeStroke){
        finishActiveDraw();
      } else if(toolMode==="rope"&&activeRope&&(ropeDragging||ropeLatchDragging||ropeMoveDragging)){
        finishActiveRopeDrag();
      } else if(toolMode==="eraser"){
        eraserActive=false;
        eraserDeletedIds=null;
      }
      if(annoGuard) annoGuard.release(e);
      try { annoCanvas.releasePointerCapture(e.pointerId); } catch(_e){}
      releaseLocalFloor();   // gesture ended → free the peer immediately
    });
    // iOS system gestures can abort a touch mid-stroke (pointercancel) or
    // strip capture without a matching up (lostpointercapture). Both
    // finalize the in-flight gesture so neither side is left with an orphan
    // stroke, a stuck rope drag, or a permanently-claimed pointer. A normal
    // pointerup also fires lostpointercapture — by then the guard has
    // released, so this is a no-op on the happy path (no double commit).
    function handlePointerAbort(e){
      if(!annoGuard||!annoGuard.owns(e)) return;
      try { e.preventDefault(); } catch(_e){}
      finalizeActiveGesture();
      if(toolMode==="eraser"){ eraserActive=false; eraserDeletedIds=null; }
      annoGuard.release(e);
      try { annoCanvas.releasePointerCapture(e.pointerId); } catch(_e){}
      releaseLocalFloor();   // abort is a gesture-end path → free the peer
    }
    annoCanvas.addEventListener("pointercancel",handlePointerAbort);
    annoCanvas.addEventListener("lostpointercapture",handlePointerAbort);
    annoCanvas.addEventListener("pointerleave",function(){
      if(!_canAnnotateLocal()) return;
      if(toolMode==="pointer"){
        session.sendPointer(currentViewKey,null,null);
      }
    });
    // WebKit gesture defenses: while Draw or Focus Rope is active, swallow
    // the raw touch sequence at the canvas (non-passive on purpose) so
    // Safari cannot run its long-press / magnifier / text-interaction
    // recognizers alongside the pointer stream. Pointer events are not
    // synthesized from touch, so drawing is unaffected. Canvas-scoped only.
    function blockTouchDuringGesture(e){
      if(toolMode!=="draw"&&toolMode!=="rope"&&toolMode!=="eraser") return;
      try { e.preventDefault(); } catch(_e){}
    }
    try {
      var nonPassive={ passive:false };
      annoCanvas.addEventListener("touchstart",blockTouchDuringGesture,nonPassive);
      annoCanvas.addEventListener("touchmove",blockTouchDuringGesture,nonPassive);
      annoCanvas.addEventListener("touchend",blockTouchDuringGesture,nonPassive);
      annoCanvas.addEventListener("touchcancel",blockTouchDuringGesture,nonPassive);
    } catch(_e){}
  }

  // Stage-scoped selection/menu defenses: the annotation stage is a drawing
  // surface, not a document — context menus, text selection, and drag-start
  // inside it fight the WebKit gesture recognizers. Scoped to the letterbox
  // wrap and only while a tool is active (a normal viewer surface otherwise).
  if(letterboxWrap){
    var killStageEvent=function(e){
      if(!annotationToolActive()) return;
      try { e.preventDefault(); } catch(_e){}
      return false;
    };
    letterboxWrap.addEventListener("contextmenu",killStageEvent);
    letterboxWrap.addEventListener("selectstart",killStageEvent);
    letterboxWrap.addEventListener("dragstart",killStageEvent);
  }

  // Toolbar buttons — visible to both roles via CSS. Annotations are
  // bidirectional, so the same handler runs on agent and visitor.
  if(annoToolbar){
    annoToolbar.addEventListener("click",function(e){
      var btn=e.target&&e.target.closest?e.target.closest(".anno-tool-btn"):null;
      if(!btn) return;
      var t=btn.getAttribute("data-tool");
      if(t==="pointer"||t==="draw"||t==="rope"||t==="eraser"){ setToolMode(t); return; }
      if(btn===clearBtn){ handleClearLocallyAndBroadcast(); return; }
      
      if(btn.id==="anno-exit-btn"){
        // Hard exit: wipe local + remote annotations, drop the tool
        // mode (which also releases the peer's nav-lock via the
        // setToolMode side-effect), and broadcast an explicit
        // nav_lock:false as a belt-and-suspenders safety net.
        handleClearLocallyAndBroadcast();
        setToolMode("none");
        try {
          var st=session.getState();
          if((st.role==="agent"||st.role==="visitor")&&st.isConnected){
            session.sendNavLock(currentViewKey,false);
          }
        } catch(_e){}
        return;
      }
    });
  }
  // Stroke color picker — updates the live ANNO_STROKE_COLOR used for
  // subsequent strokes. Existing committed strokes keep their original
  // color (each stroke carries its own color on the wire and in
  // localStrokes), so switching mid-session only affects new drawings.
  var annoColorSelect=document.getElementById("anno-color-select");
  var annoColorSwatch=document.getElementById("anno-color-swatch");
  if(annoColorSelect){
    // Allow only the whitelisted palette to avoid unexpected CSS injection
    // via a hijacked <option>. Anything else falls back to the current value.
    var ANNO_COLOR_WHITELIST={"#ff3b30":1,"#1e90ff":1,"#22c55e":1,"#ffffff":1};
    annoColorSelect.value=ANNO_STROKE_COLOR;
    annoColorSelect.addEventListener("change",function(){
      var v=String(annoColorSelect.value||"").toLowerCase();
      if(!ANNO_COLOR_WHITELIST[v]){ annoColorSelect.value=ANNO_STROKE_COLOR; return; }
      ANNO_STROKE_COLOR=v;
      if(annoColorSwatch) annoColorSwatch.style.background=v;
      // Live-update the in-progress rope so its outline (and latch
      // fill) repaint immediately, and broadcast a fresh snapshot so
      // the visitor sees the new color before the next mouse move.
      if(activeRope){
        activeRope.color=v;
        scheduleRopeFlush();
        redrawAllStrokes();
      }
    });
  }

  // Focus Rope shape picker — Circle / Box. Whitelist-guarded just
  // like the color picker so a hijacked <option> can't push arbitrary
  // state into the renderer. Changing mid-edit regenerates the active
  // rope's polyline so the visitor sees the new shape immediately.
  var annoShapeSelect=document.getElementById("anno-shape-select");
  if(annoShapeSelect){
    annoShapeSelect.value=ANNO_ROPE_SHAPE;
    annoShapeSelect.addEventListener("change",function(){
      var v=String(annoShapeSelect.value||"").toLowerCase();
      if(!ANNO_ROPE_SHAPE_WHITELIST[v]){ annoShapeSelect.value=ANNO_ROPE_SHAPE; return; }
      ANNO_ROPE_SHAPE=v;
      if(activeRope){
        activeRope.shape=v;
        ropeRegenerate(activeRope);
        scheduleRopeFlush();
        redrawAllStrokes();
      }
    });
  }

  // Global hotkeys: only fire when an active agent session exists and
  // the user isn't typing in a form field.
  document.addEventListener("keydown",function(e){
    var s=session.getState();
    if(s.role!=="agent"||!s.isConnected) return;
    var tgt=e.target;
    if(tgt&&(tgt.tagName==="INPUT"||tgt.tagName==="TEXTAREA"||tgt.isContentEditable)){
      return;
    }
    var k=(e.key||"").toLowerCase();
    if(k==="p"){ setToolMode("pointer"); e.preventDefault(); }
    else if(k==="d"){ setToolMode("draw"); e.preventDefault(); }
    else if(k==="r"){ setToolMode("rope"); e.preventDefault(); }
    else if(k==="e"){ setToolMode("eraser"); e.preventDefault(); }
    else if(k==="c"){ handleClearLocallyAndBroadcast(); e.preventDefault(); }
    else if(e.key==="Escape"){
      setToolMode("none");
      e.preventDefault();
    }
  });

  // ResizeObserver re-renders strokes when the letterbox box changes
  // (window resize, devtools open, fullscreen toggle). Normalized
  // coords stay valid; we only need to rebake the pixel projection.
  if(typeof ResizeObserver==="function"&&letterboxWrap){
    try {
      var ro=new ResizeObserver(function(){ resizeAnnoCanvas(); });
      ro.observe(letterboxWrap);
    } catch(_e){
      window.addEventListener("resize",resizeAnnoCanvas);
    }
  } else if(letterboxWrap){
    window.addEventListener("resize",resizeAnnoCanvas);
  }
  // visualViewport resize (iOS URL-bar collapse / keyboard / pinch) and
  // orientationchange — geometry events a plain window 'resize' misses on
  // mobile, so the canvas stays aligned to the letterbox after rotation.
  if(ANNO_INPUT_OK&&letterboxWrap) annoBindViewportEvents(window,resizeAnnoCanvas);

  // ── Location Sync (visitor → agent, clipboard auto-share) ────────
  // True one-action sync: the visitor positions their view, presses U
  // inside Matterport, and clicks "Copy to clipboard" in Matterport's
  // native popup. That's it. We auto-poll the clipboard while
  // connected as a visitor and push any new ss/sr to the agent over
  // the data channel. No drawer click, no paste, no focus juggling —
  // so the U key never breaks because we never overlay the iframe.
  //
  // Permission strategy: we pre-fire navigator.clipboard.readText()
  // inside both Join (visitor) and Start (agent) click handlers so the
  // browser permission prompt appears once, at the natural opt-in
  // moment. Chrome/Edge remember the grant for the rest of the page
  // session, after which readText() runs silently forever. Safari/
  // Firefox don't expose clipboard-read at all; they degrade to a
  // single-tap pill, then to a paste field as a deep fallback.
  // Ambient pulse pill — shown on BOTH visitor and agent sides.
  // Read-only / informational — hover or keyboard focus reveals the
  // tips dropdown; there is NO click action and the pill never steals
  // keyboard focus from the iframe. Auto-sync happens silently when
  // the clipboard changes (Matterport's "Copy to clipboard" inside the
  // iframe), via the clipboardchange / focus / visibilitychange /
  // pointerenter listeners below. Visitor's send routes through
  // shareLocationWithAgent → agent's iframe reloads; agent's send
  // routes through teleportVisitor → visitor's iframe reloads. Both
  // sides also auto-follow on the inverse packet via onState.
  var syncBtn=document.getElementById("loc-sync");
  var syncLabelEl=syncBtn?syncBtn.querySelector(".loc-sync-label"):null;
  var tipsEl=document.getElementById("loc-sync-tips");

  var LOC_SYNC_POLL_THROTTLE_MS=800;
  var LOC_SYNC_SUCCESS_RESET_MS=1800;
  var LOC_SYNC_TIPS_HIDE_DELAY_MS=250;
  // locSyncGranted is a hint, not a hard gate — every poll attempts
  // readText() inside try/catch and degrades gracefully on rejection.
  var locSyncGranted=false;
  var locSyncLastPollTs=0;
  var lastReadClipText="";
  var lastSentLocationKey="";
  var lastSentLocationTs=0;
  var lastShareTs=0;
  // Provenance tracking for echo suppression: the view we most recently
  // APPLIED FROM A REMOTE sync (teleport received / share followed),
  // kept separate from the sent-dedupe vars above so a remote apply can
  // never poison the outbound dedupe. Only the short-lived automatic
  // echo of this remotely applied location is swallowed — an
  // INTENTIONAL U + Copy of the very view we're displaying still sends.
  var lastAppliedRemoteKey="";
  var lastAppliedRemoteTs=0;
  // Last-Sender-Wins suppression: any outbound sync (ambient or Tour
  // Stop) stamps lastOwnSendTs. Incoming syncs received within the
  // SYNC_SUPPRESS_MS window are dropped (watermark still advances) so
  // simultaneous bidirectional syncs don't swap views.
  var lastOwnSendTs=0;
  var SYNC_SUPPRESS_MS=500;
  var syncResetTimer=null;
  var tipsTimer=null;

  // Tips dropdown helpers — hover-driven, no auto-dismiss timer.
  // showTips: reveal immediately, cancel any pending hide.
  // scheduleHideTips: queue a hide after a short delay so the cursor
  // can move from the pill onto the tips card without it disappearing.
  // hideTips: immediate, used by teardown.
  function showTips(){
    if(!tipsEl) return;
    if(tipsTimer){ try { clearTimeout(tipsTimer); } catch(_e){} tipsTimer=null; }
    tipsEl.hidden=false;
  }

  function scheduleHideTips(){
    if(!tipsEl) return;
    if(tipsTimer){ try { clearTimeout(tipsTimer); } catch(_e){} }
    tipsTimer=setTimeout(function(){
      if(tipsEl) tipsEl.hidden=true;
      tipsTimer=null;
    },LOC_SYNC_TIPS_HIDE_DELAY_MS);
  }

  function hideTips(){
    if(tipsEl) tipsEl.hidden=true;
    if(tipsTimer){ try { clearTimeout(tipsTimer); } catch(_e){} tipsTimer=null; }
  }

  var LOC_SYNC_LABELS={
    idle:"To sync your view…",
    syncing:"Aligning agent’s view…",
    success:"View Synced",
    waiting:"Connecting…"
  };

  function setPulseState(name){
    if(!syncBtn) return;
    var state=LOC_SYNC_LABELS[name]?name:"idle";
    syncBtn.setAttribute("data-state",state);
    if(syncLabelEl) syncLabelEl.textContent=LOC_SYNC_LABELS[state];
    if(syncResetTimer){ try { clearTimeout(syncResetTimer); } catch(_e){} syncResetTimer=null; }
  }

  function scheduleSyncIdleReset(){
    if(syncResetTimer){ try { clearTimeout(syncResetTimer); } catch(_e){} }
    syncResetTimer=setTimeout(function(){
      var cur=syncBtn?syncBtn.getAttribute("data-state"):"idle";
      if(cur==="success") setPulseState("idle");
    },LOC_SYNC_SUCCESS_RESET_MS);
  }
  function resetLocationSyncUi(){
    locSyncGranted=false;
    locSyncLastPollTs=0;
    lastReadClipText="";
    lastSentLocationKey="";
    lastSentLocationTs=0;
    lastShareTs=0;
    lastAppliedRemoteKey="";
    lastAppliedRemoteTs=0;
    lastOwnSendTs=0;
    hideTips();
    setPulseState("waiting");
  }

  // Parse a Matterport "Link to location" URL. Returns {ss, sr} or null.
  // We require the URL to be on matterport.com (any subdomain), to carry
  // an "ss" integer sweep id, and (if present) a well-formed "sr" pair.
  // Hard 2KB ceiling so a clipboard packed with garbage can't OOM the
  // parser.
  function parseMatterportLocationUrl(text){
    if(!text||typeof text!=="string") return null;
    var trimmed=text.trim();
    if(trimmed.length===0||trimmed.length>2000) return null;
    var u;
    try { u=new URL(trimmed); } catch(_e){ return null; }
    if(!/(^|\\.)matterport\\.com$/i.test(u.hostname||"")) return null;
    var ss=u.searchParams.get("ss");
    var sr=u.searchParams.get("sr")||"";
    if(!ss||!/^\\d+$/.test(ss)) return null;
    if(sr&&!/^-?\\d*\\.?\\d+,-?\\d*\\.?\\d+$/.test(sr)) return null;
    return { ss: ss, sr: sr };
  }

  function attemptSendLocation(parsed){
    if(!parsed) return false;
    var key=parsed.ss+"|"+parsed.sr;
    var now=Date.now();
    // Echo suppression — provenance-aware. Only the short-lived
    // automatic echo of a REMOTELY APPLIED location is swallowed:
    // right after applyTeleport ran for an inbound sync, a racing
    // ambient trigger re-reading the same coords must not rebroadcast
    // and ping-pong the sender's iframe. An INTENTIONAL U + Copy of
    // the view we're standing in (e.g. the host pulling the guest back
    // after following the guest's share) is a legitimate send and goes
    // through once this window passes. A blanket currentViewKey
    // equality check here previously swallowed those intentional syncs
    // forever — with a success pulse.
    if(key===lastAppliedRemoteKey&&(now-lastAppliedRemoteTs)<SYNC_SUPPRESS_MS){
      setPulseState("success");
      scheduleSyncIdleReset();
      return true;
    }
    // Content-level dedupe: if the same parsed coords were sent within
    // the last 5s, flash success without re-sending. Saves an iframe
    // reload on the agent side and absorbs any redundant ambient
    // triggers that re-read the same clipboard URL. Only GENUINE own
    // sends write lastSentLocationKey now (remote applies track
    // lastAppliedRemoteKey above), so this can no longer eat an
    // intentional re-share of a just-followed view.
    if(key===lastSentLocationKey&&(now-lastSentLocationTs)<5000){
      setPulseState("success");
      scheduleSyncIdleReset();
      return true;
    }
    var ok=false;
    var role=session.getState().role;
    try {
      if(role==="visitor") ok=session.shareLocationWithAgent(parsed.ss,parsed.sr);
      else if(role==="agent") ok=session.teleportVisitor(parsed.ss,parsed.sr);
    } catch(_e){ ok=false; }
    if(ok){
      // The controller send method just stamped ITS view key (see
      // live-session.mjs teleportVisitor/shareLocationWithAgent — the
      // sender owns that update, so no noteCurrentView call here);
      // converge the glue too, under the same contract as
      // applyTeleport: every accepted sync rolls the key and wipes the
      // canvas, on both ends, so strokes never straddle a sync
      // boundary (the receiving side wipes inside its applyTeleport).
      currentViewKey=key;
      wipeAnnotations();
      lastSentLocationKey=key;
      lastSentLocationTs=now;
      lastOwnSendTs=now;
      setPulseState("success");
      scheduleSyncIdleReset();
      return true;
    }
    // Channel not ready — revert the pulse to idle so it doesn't sit
    // on "syncing" forever. The caller leaves lastReadClipText
    // unchanged so the next ambient trigger naturally retries.
    setPulseState("idle");
    return false;
  }

  // Silently read the clipboard and send if it's a new Matterport URL.
  // Pure ambient operation — no user gesture is bound to this; it runs
  // from the focus / visibilitychange / pointerenter / clipboardchange
  // listeners below. Three layers of dedupe keep the pill quiet:
  //   1. locSyncLastPollTs throttle in schedulePoll (event-handler).
  //   2. lastReadClipText content-equality check here (text dedupe).
  //   3. lastSentLocationKey + 5s window in attemptSendLocation
  //      (parsed ss|sr dedupe).
  // Only NEW Matterport URLs flash the pulse (syncing → success → idle).
  // Repeat reads, non-Matterport clipboards, and rejected reads stay
  // silent so the pill doesn't strobe during normal interaction.
  // We deliberately don't pre-flight navigator.permissions.query() —
  // it returned stale "denied" on file:// while the live popup was
  // pending. readText() raises the popup itself; the Promise outcome
  // is the source of truth.
  // Ambient clipboard reads are allowed only when they cannot raise the
  // iOS Paste callout mid-gesture: never on iOS/iPadOS WebKit, never while
  // an annotation tool is active (any platform), and only when the input
  // kernel is present to make that determination. Fail-closed.
  function ambientClipboardAllowed(){
    if(!ANNO_INPUT_OK) return false;
    if(IS_IOS_WEBKIT) return false;
    if(toolMode==="draw"||toolMode==="rope"||toolMode==="pointer") return false;
    return true;
  }
  function readClipboardAndSend(){
    if(!ambientClipboardAllowed()) return;
    var s=session.getState();
    if((s.role!=="visitor"&&s.role!=="agent")||!s.isConnected) return;
    if(!navigator||!navigator.clipboard||typeof navigator.clipboard.readText!=="function") return;
    var p;
    try { p=navigator.clipboard.readText(); } catch(_e){ return; }
    if(!p||typeof p.then!=="function") return;
    p.then(function(text){
      if(typeof text!=="string") return;
      // Content dedupe: silent skip when the clipboard hasn't changed
      // since our last processed read. Prevents repeated pulse flashes
      // on ambient triggers (mouse re-entering iframe area, tab focus
      // toggles, etc.) when no new view has been copied.
      if(text===lastReadClipText) return;
      var parsed=parseMatterportLocationUrl(text);
      if(!parsed){
        // Not a tour link — silent, no pulse change. Update the dedupe
        // marker so we don't re-parse the same non-Matterport text on
        // every ambient trigger.
        lastReadClipText=text;
        return;
      }
      locSyncGranted=true;
      // Only NOW do we know there's something real to do. Flip the
      // pulse to "syncing" and dispatch the share.
      setPulseState("syncing");
      if(attemptSendLocation(parsed)){
        // Send succeeded (or was a recent-dedupe hit). Lock the dedupe
        // so subsequent identical reads stay silent.
        lastReadClipText=text;
      }
      // If attemptSendLocation returned false (channel not ready), it
      // has already reverted the pulse to idle. Leave lastReadClipText
      // unchanged so the next ambient trigger retries.
    },function(){
      // Read rejected (denied / SecurityError / no focus). Stay silent;
      // the next ambient trigger will retry. No state flip — the pill
      // keeps its current label (typically "To sync your view…") so the
      // visitor isn't alarmed by a transient permission error.
    });
  }

  // schedulePoll: ambient throttled entrypoint for focus / visibility
  // / pointerenter / clipboardchange events. Bails on hidden tab, wrong
  // role, recent poll. No focus juggling — readText runs with whatever
  // focus state the trigger event provided; on HTTPS Chromium with a
  // persistent grant it works regardless of focus, which is the user's
  // production scenario.
  function schedulePoll(){
    if(!ambientClipboardAllowed()) return;
    if(document.hidden) return;
    var s=session.getState();
    if((s.role!=="visitor"&&s.role!=="agent")||!s.isConnected) return;
    var now=Date.now();
    if(now-locSyncLastPollTs<LOC_SYNC_POLL_THROTTLE_MS) return;
    locSyncLastPollTs=now;
    readClipboardAndSend();
  }

  // DESKTOP: the pill is informational only — hover or keyboard focus reveals
  // the tips card; NO click/Enter/Space action there, because any focus shift
  // to the pill would steal keyboard control from the iframe and break the
  // visitor pressing U next. Desktop auto-sync runs via the ambient listeners
  // below once clipboard permission is granted.
  if(syncBtn){
    syncBtn.addEventListener("mouseenter",showTips);
    syncBtn.addEventListener("mouseleave",scheduleHideTips);
    syncBtn.addEventListener("focus",showTips);
    syncBtn.addEventListener("blur",scheduleHideTips);
  }
  // Keep tips visible while the cursor is hovering the card itself so
  // the visitor can read it without it disappearing mid-glance.
  if(tipsEl){
    tipsEl.addEventListener("mouseenter",showTips);
    tipsEl.addEventListener("mouseleave",scheduleHideTips);
  }

  // Ambient polling triggers. Battery-friendly: NO setInterval, only
  // event-driven. All four funnel through schedulePoll which dedupes
  // and throttles.
  window.addEventListener("focus",schedulePoll);
  document.addEventListener("visibilitychange",function(){ if(!document.hidden) schedulePoll(); });
  if(letterboxWrap){
    letterboxWrap.addEventListener("pointerenter",schedulePoll);
  }

  // Persistence hack — Chrome 124+ exposes a clipboardchange event
  // that fires when the system clipboard contents change. Once the
  // visitor has granted the persistent "Always allow" permission,
  // this event lets us auto-detect Matterport's Copy click without
  // any further user gesture or prompt. Older browsers don't expose
  // the API; the addEventListener call is a no-op there. Safe by
  // default — schedulePoll's throttle + content dedupe drop redundant
  // reads if the event fires more often than expected.
  try {
    if(navigator&&navigator.clipboard&&typeof navigator.clipboard.addEventListener==="function"){
      navigator.clipboard.addEventListener("clipboardchange",schedulePoll);
    }
  } catch(_e){}

  // Pillar C — Hover focus injection. On mouseenter into the iframe
  // wrap, force the iframe to take keyboard focus so pressing U works
  // on the first try. Guarded against (a) non-visitor roles and (b)
  // active focus in a parent INPUT/TEXTAREA so we never steal focus
  // mid-typing in a side-drawer text field.
  if(letterboxWrap){
    letterboxWrap.addEventListener("pointerenter",function(){
      var st=session.getState();
      if(st.role!=="visitor"&&st.role!=="agent") return;
      var ae=document.activeElement;
      if(ae&&(ae.tagName==="INPUT"||ae.tagName==="TEXTAREA"||ae.isContentEditable)) return;
      if(frame){
        try { frame.focus({ preventScroll: true }); } catch(_e){
          try { frame.focus(); } catch(_e2){}
        }
      }
    });
  }

  function teardownSession(){
    try { session.dispose(); } catch(_e){}
    if(leaveBtn) leaveBtn.hidden=true;
    wasConnected=false;
    // Strip the letterbox + agent class so idle viewing returns to a
    // full-screen iframe and the toolbar disappears.
    setBodyLetterboxClass(false,false);
    setToolMode("none");
    wipeAnnotations();
    currentViewKey="";
    lastPointerSeq=0;
    lastStrokeSeq=0;
    lastClearSeq=0;
    lastNavLockSeq=0;
    lastStrokeDeleteSeq=0;
    // Disconnect is a gesture-end path: release any floor this side holds and
    // clear any floor the peer held so neither side is left frozen/locked out.
    try { releaseLocalFloor(); } catch(_e){}
    try { setRemoteFloor(false); } catch(_e){}
    eraserActive=false;
    eraserDeletedIds=null;
    resetLocationSyncUi();
    resetUiToIdle();
    // Re-create the controller so a fresh session can be started
    // without reloading the page. Re-attach the same subscriber.
    session=createLiveSession({PeerCtor:lazyPeerCtor});
    session.subscribe(onState);
  }

  if(leaveBtn){
    leaveBtn.addEventListener("click",function(){
      teardownSession();
    });
  }


  // Strip ss/sr/qs/play/title/brand from a Matterport URL and re-append
  // them with the supplied values. We always force qs=1 (Quick Start)
  // and play=1 so the visitor's iframe snaps to the new view without
  // the fly-in animation, and we always force title=0 & brand=0 so the
  // teleport never re-shows Matterport's centered title card or brand
  // watermark mid-tour. This override is scoped to live-tour bookmark
  // teleports only — normal viewing still respects the agent's
  // TourBehavior hideTitle / hideBranding toggles.
  function rewriteIframeForTeleport(baseUrl,ss,sr){
    if(!baseUrl) return baseUrl;
    var stripped=baseUrl.replace(/[?&](ss|sr|qs|play|title|brand)=[^&]*/g,function(m){
      return m.charAt(0)==="?"?"?":"";
    });
    // The strip above can leave a trailing "?" or "?&" sequence —
    // normalize to a clean separator.
    stripped=stripped.replace(/\\?&/g,"?").replace(/[?&]$/,"");
    var sep=stripped.indexOf("?")===-1?"?":"&";
    var qs="ss="+encodeURIComponent(ss);
    if(sr) qs+="&sr="+encodeURIComponent(sr);
    qs+="&qs=1&play=1&title=0&brand=0";
    return stripped+sep+qs;
  }

  function applyTeleport(ss,sr){
    if(!frame) return;
    var p=props[current];
    if(!p||!p.iframeUrl) return;
    // Auto-clear all annotations on every teleport — agents and
    // visitors both wipe their canvas so strokes never bleed across
    // the new Matterport sweep. The viewKey also rolls so any late
    // packets from the previous sweep get dropped by the receiver's
    // viewKey filter in live-session.mjs.
    currentViewKey=(ss||"")+"|"+(sr||"");
    // Tell the controller the view it cannot see changed: its receive
    // filter and outbound annotation stamping both key off
    // _currentViewKey, and a locally applied view (inbound sync follow
    // or tour-stop click) is invisible to it otherwise. Idempotent for
    // the tour-stop path, where teleportVisitor already set it.
    try { session.noteCurrentView(ss,sr); } catch(_e){}
    wipeAnnotations();
    // Live tour teleports always target the primary iframe (closure-
    // captured frame === Iframe A). Snap state back so the user sees
    // the upcoming reload on the iframe they're looking at.
    try { if(window.__snapPrimaryActive) window.__snapPrimaryActive(); } catch(_e){}
    try { frame.src=rewriteIframeForTeleport(p.iframeUrl,ss,sr); } catch(_e){}
  }

  function renderStops(){
    if(!stopsContainer) return;
    stopsContainer.innerHTML="";
    var p=props[current]||{};
    var stops=p.liveTourStops||[];
    if(stops.length===0){
      var empty=document.createElement("div");
      empty.className="lg-stops-empty";
      empty.textContent="No bookmarks for this property.";
      stopsContainer.appendChild(empty);
      return;
    }
    var connected=session.getState().isConnected;
    stops.forEach(function(stop){
      var btn=document.createElement("button");
      btn.type="button";
      btn.className="lg-stop-btn";
      btn.textContent=stop.name||"Stop";
      btn.disabled=!connected;
      btn.addEventListener("click",function(){
        var sent=session.teleportVisitor(stop.ss,stop.sr||"");
        // Whether or not the data channel send succeeds, the agent's
        // own iframe should follow along — they're leading the tour.
        if(sent){
          lastOwnSendTs=Date.now();
          applyTeleport(stop.ss,stop.sr||"");
        }
      });
      stopsContainer.appendChild(btn);
    });
  }

  // Hook called by load(i) so stops re-render when the agent flips
  // between properties mid-tour.
  window.__lgOnPropertyChange=function(){
    if(session.getState().role==="agent") renderStops();
  };

  if(toggleAgentLink){
    toggleAgentLink.addEventListener("click",function(){
      if(visitorPane) visitorPane.hidden=true;
      if(agentPane) agentPane.hidden=false;
    });
  }
  if(toggleVisitorLink){
    toggleVisitorLink.addEventListener("click",function(){
      if(visitorPane) visitorPane.hidden=false;
      if(agentPane) agentPane.hidden=true;
    });
  }

  if(joinBtn&&pinInput){
    joinBtn.addEventListener("click",function(){
      var pin=(pinInput.value||"").replace(/\\D/g,"").slice(0,4);
      if(pin.length!==4){
        if(visitorStatus) visitorStatus.textContent="Enter the 4-digit PIN from your agent.";
        return;
      }
      joinBtn.disabled=true;
      if(visitorStatus) visitorStatus.textContent="Preparing Live Tour…";
      // Pre-grant clipboard permission in the same user gesture as the
      // Join click — browser prompts once now, then silent reads power
      // the ambient pulse pill for the rest of the session. Must stay
      // synchronous inside the click (a then-callback is not a gesture).
      try {
        if(navigator&&navigator.permissions&&typeof navigator.permissions.query==="function"){
          navigator.permissions.query({ name: "clipboard-read" }).then(function(r){
            locSyncGranted=!!(r&&r.state==="granted");
          },function(){});
        }
        if(!IS_IOS_WEBKIT&&navigator&&navigator.clipboard&&typeof navigator.clipboard.readText==="function"){
          navigator.clipboard.readText().then(function(){ locSyncGranted=true; },
                                              function(){ locSyncGranted=false; });
        }
      } catch(_e){}
      ensurePeerJs().then(function(){
        if(visitorStatus) visitorStatus.textContent="Connecting…";
        session.joinAsVisitor(pin).catch(function(){
          // error state surfaced via subscribe()
        });
      },function(){
        joinBtn.disabled=false;
        if(visitorStatus) visitorStatus.textContent="Live Tour could not load (network issue). Click Join to retry.";
      });
    });
    pinInput.addEventListener("keydown",function(e){
      if(e.key==="Enter"){ e.preventDefault(); joinBtn.click(); }
    });
    pinInput.addEventListener("input",function(){
      // Strip non-digits live so the input always shows a clean PIN.
      pinInput.value=(pinInput.value||"").replace(/\\D/g,"").slice(0,4);
    });
  }

  if(startBtn){
    startBtn.addEventListener("click",function(){
      startBtn.disabled=true;
      if(agentStatus) agentStatus.textContent="Preparing Live Tour…";
      // Pre-grant clipboard permission in the same user gesture as the
      // Start click — the agent presses U + Copy in their own iframe to
      // sync the visitor's view, just like the visitor's flow. Prompt
      // once now; subsequent ambient reads stay silent on Chromium.
      try {
        if(navigator&&navigator.permissions&&typeof navigator.permissions.query==="function"){
          navigator.permissions.query({ name: "clipboard-read" }).then(function(r){
            locSyncGranted=!!(r&&r.state==="granted");
          },function(){});
        }
        if(!IS_IOS_WEBKIT&&navigator&&navigator.clipboard&&typeof navigator.clipboard.readText==="function"){
          navigator.clipboard.readText().then(function(){ locSyncGranted=true; },
                                              function(){ locSyncGranted=false; });
        }
      } catch(_e){}
      ensurePeerJs().then(function(){
        if(agentStatus) agentStatus.textContent="Reserving session…";
        session.initializeAsAgent().catch(function(){
          // error surfaced via subscribe()
        });
      },function(){
        startBtn.disabled=false;
        if(agentStatus) agentStatus.textContent="Live Tour could not load (network issue). Click Start to retry.";
      });
    });
  }

  function onState(state){
    // PIN display.
    if(pinValue && state.pin) pinValue.textContent=state.pin;

    // Agent pane: swap pre-join/active visibility once we have a PIN.
    if(state.role==="agent"){
      var hasPin=!!state.pin;
      if(preJoinBlock) preJoinBlock.hidden=hasPin;
      if(activeBlock) activeBlock.hidden=!hasPin;
      if(agentStatus){
        if(state.status==="initializing") agentStatus.textContent="Reserving session…";
        else if(state.status==="waiting") agentStatus.textContent="Share the PIN with your visitor.";
        else if(state.status==="connected") agentStatus.textContent="Connected. Click a stop to teleport your visitor.";
        else if(state.status==="ended") agentStatus.textContent="Session ended.";
        else if(state.status==="error") agentStatus.textContent=state.error||"Something went wrong.";
      }
      if(state.status==="error"&&startBtn) startBtn.disabled=false;
      // Refresh stop button enabled state — render once on transition,
      // then update disabled flags on every state tick (cheap).
      if(hasPin){
        if(stopsContainer && !stopsContainer.firstChild) renderStops();
        if(stopsContainer){
          var btns=stopsContainer.querySelectorAll(".lg-stop-btn");
          for(var i=0;i<btns.length;i++) btns[i].disabled=!state.isConnected;
        }
      }
    }

    // Visitor pane status messaging.
    if(state.role==="visitor"&&visitorStatus){
      if(state.status==="connecting") visitorStatus.textContent="Connecting…";
      else if(state.status==="connected") visitorStatus.textContent="Connected to your agent.";
      else if(state.status==="ended") { visitorStatus.textContent="Session ended."; if(joinBtn) joinBtn.disabled=false; }
      else if(state.status==="error") { visitorStatus.textContent=state.error||"Couldn't connect."; if(joinBtn) joinBtn.disabled=false; }
    }

    // First transition into "connected" — reveal Leave button and
    // auto-close the contact drawer + HUD header so the 3D tour gets
    // the full screen. Latched so we only fire once per session.
    if(!wasConnected && state.isConnected && state.status==="connected"){
      wasConnected=true;
      // A live tour is itself an interaction that needs stable gestures —
      // ask the parent to switch off native Device fullscreen on iPad.
      emitInteractionActive();
      if(leaveBtn) leaveBtn.hidden=false;
      // Engage the 16:9 letterbox + agent toolbar (if applicable) once
      // the channel is live. Resize the canvas backing store so
      // strokes received before the first redraw appear correctly.
      setBodyLetterboxClass(true,state.role==="agent");
      resizeAnnoCanvas();
      // Visitor: auto-close the Live Tour drawer so the tour fills the
      // screen. Agent stays in the drawer to manage stops.
      if(state.role==="visitor") hideOverlaysForLiveTour();
    }
    setHudButtonState(state);

    // If the session ends/errors after having been connected, return
    // both sides to a clean idle state automatically.
    if(wasConnected && (state.status==="ended"||state.status==="error")){
      // Defer to break out of the current subscriber tick before we
      // dispose + re-create the controller.
      setTimeout(teardownSession,0);
    }

    // Voice attach. srcObject is the modern API; legacy browsers fall
    // back to URL.createObjectURL but every browser PeerJS supports
    // also supports srcObject.
    if(audioEl){
      try {
        if(state.remoteStream && audioEl.srcObject!==state.remoteStream){
          audioEl.srcObject=state.remoteStream;
          var pp=audioEl.play();
          if(pp&&typeof pp.catch==="function") pp.catch(function(){});
        } else if(!state.remoteStream && audioEl.srcObject){
          audioEl.srcObject=null;
        }
      } catch(_e){}
    }

    // Visitor iframe sync. The controller patches incomingTeleportEvent
    // with a fresh ts on every inbound packet; we de-dupe on ts so the
    // same coords can be re-fired (re-teleport to the same stop) but
    // an unchanged event doesn't keep replaying.
    if(state.role==="visitor"&&state.incomingTeleportEvent&&state.incomingTeleportEvent.ts!==lastTeleportTs){
      lastTeleportTs=state.incomingTeleportEvent.ts;
      // Last-Sender-Wins: drop incoming if we sent within the last 500ms.
      // Watermark still advanced above so the same packet isn't replayed.
      if(lastOwnSendTs===0||(Date.now()-lastOwnSendTs)>=SYNC_SUPPRESS_MS){
        applyTeleport(state.incomingTeleportEvent.ss,state.incomingTeleportEvent.sr);
        // Record the REMOTE provenance so a racing ambient clipboard
        // read of the same coords cannot rebroadcast and ping-pong the
        // sender's iframe (echo guard in attemptSendLocation). Kept
        // separate from lastSentLocationKey: a remote apply must never
        // poison the outbound dedupe, or an intentional re-share of
        // this view gets silently eaten.
        lastAppliedRemoteKey=state.incomingTeleportEvent.ss+"|"+state.incomingTeleportEvent.sr;
        lastAppliedRemoteTs=Date.now();
      }
    }

    // Agent auto-follow: visitor's location_share patches the state with
    // a fresh ts on each inbound packet. Dedupe by ts. Pure local
    // action — we do NOT broadcast back to the visitor (their iframe
    // must never reload from auto-sync, per the role-isolation rule).
    if(state.role==="agent"&&state.incomingLocationShareEvent&&state.incomingLocationShareEvent.ts!==lastShareTs){
      lastShareTs=state.incomingLocationShareEvent.ts;
      // Last-Sender-Wins: drop incoming visitor share if we sent within
      // the last 500ms (ambient sync or Tour Stop). Watermark advanced
      // above so the same packet won't replay once the window expires.
      if(lastOwnSendTs===0||(Date.now()-lastOwnSendTs)>=SYNC_SUPPRESS_MS){
        applyTeleport(state.incomingLocationShareEvent.ss,state.incomingLocationShareEvent.sr);
        // Remote-provenance record (see visitor branch above). Stops an
        // immediate ambient echo of the just-followed coords without
        // blocking the agent's INTENTIONAL "come here" re-share of this
        // same view a moment later.
        lastAppliedRemoteKey=state.incomingLocationShareEvent.ss+"|"+state.incomingLocationShareEvent.sr;
        lastAppliedRemoteTs=Date.now();
        if(letterboxWrap){
          try {
            letterboxWrap.classList.add("follow-pulse");
            setTimeout(function(){ if(letterboxWrap) letterboxWrap.classList.remove("follow-pulse"); },1500);
          } catch(_e){}
        }
      }
    }

    // Pulse pill: reflects connection state. When connected, settle
    // into idle (breathing pulse). When disconnected, dim to waiting.
    // Don't clobber a transient syncing/success state. Both roles use
    // the same pill — visitor sends location_share, agent sends
    // teleportVisitor; the pulse states are direction-agnostic.
    if((state.role==="visitor"||state.role==="agent")&&syncBtn){
      var curState=syncBtn.getAttribute("data-state");
      if(!state.isConnected){
        if(curState!=="syncing") setPulseState("waiting");
      } else if(curState==="waiting"){
        setPulseState("idle");
      }
    }

    // ── Annotation receive paths ─────────────────────────────────
    // Controller's seq filter guarantees monotonicity in state; we
    // de-dupe locally by seq so the same patch-tick doesn't re-render
    // the same event. Bidirectional — both agent and visitor render
    // the OTHER peer's inbound pointer/strokes/clear/nav_lock. Each
    // side's own actions are rendered locally by the canvas handlers,
    // not by inbound events (peer-to-peer with no loopback).
    var _canReceive=(state.role==="agent"||state.role==="visitor");
    var pev=state.incomingPointerEvent;
    if(pev&&pev.seq!==lastPointerSeq){
      lastPointerSeq=pev.seq;
      if(_canReceive&&remotePointer&&letterboxWrap){
        if(pev.x==null||pev.y==null){
          remotePointer.style.display="none";
          if(remotePointerHideTimer){ try { clearTimeout(remotePointerHideTimer); } catch(_e){} remotePointerHideTimer=null; }
        } else {
          // #remote-pointer is a child of the wrap; absolute coords
          // are relative to the wrap so plain fraction * wrap size
          // is the correct projection.
          var rect=letterboxWrap.getBoundingClientRect();
          remotePointer.style.left=(pev.x*rect.width)+"px";
          remotePointer.style.top=(pev.y*rect.height)+"px";
          remotePointer.style.display="block";
          if(remotePointerHideTimer){ try { clearTimeout(remotePointerHideTimer); } catch(_e){} }
          // Idle-hide so a stuck pointer doesn't linger forever if
          // the peer disconnects without a clean leave event.
          remotePointerHideTimer=setTimeout(function(){
            if(remotePointer) remotePointer.style.display="none";
          },ANNO_REMOTE_POINTER_TIMEOUT_MS);
        }
      }
    }

    var sev=state.incomingStrokeEvent;
    if(sev&&sev.seq!==lastStrokeSeq){
      lastStrokeSeq=sev.seq;
      if(_canReceive){
        // A remote stroke means the canvas must exist even if this side
        // never picked up a tool (e.g. a visitor watching the agent draw).
        ensureAnnoCanvasAllocated();
        if(sev.kind==="begin"){
          // Focus Rope reuses stroke_begin to push atomic shape
          // snapshots under a stable strokeId. If the id is already
          // known, replace its point list (and color/width) so the
          // rope resizes in place. Otherwise push a new stroke —
          // unchanged legacy free-draw behavior.
          var existingBegin=findLocalStroke(sev.strokeId);
          if(existingBegin){
            if(sev.points) existingBegin.points=sev.points.slice();
            if(typeof sev.color==="string") existingBegin.color=sev.color;
            if(typeof sev.width==="number") existingBegin.width=sev.width;
          } else {
            var nstroke={
              strokeId:sev.strokeId,
              color:sev.color||ANNO_STROKE_COLOR,
              width:typeof sev.width==="number"?sev.width:ANNO_STROKE_WIDTH,
              points:sev.points?sev.points.slice():[],
            };
            localStrokes.push(nstroke);
          }
          redrawAllStrokes();
        } else if(sev.kind==="patch"){
          var existing=findLocalStroke(sev.strokeId);
          if(existing&&sev.points){
            for(var pi=0;pi<sev.points.length;pi++) existing.points.push(sev.points[pi]);
            redrawAllStrokes();
          }
        } else if(sev.kind==="commit"){
          // Commit seals the stroke: mark it erasable. Until now it was an
          // in-flight remote stroke and the eraser deliberately skipped it.
          var committedRemote=findLocalStroke(sev.strokeId);
          if(committedRemote) committedRemote.committed=true;
        }
        // Ongoing remote stroke activity refreshes the floor safety timer so
        // a long remote gesture keeps this side paused until it actually ends.
        if(sev.kind==="begin"||sev.kind==="patch") refreshRemoteFloor();
      }
    }

    var cev=state.incomingClearEvent;
    if(cev&&cev.seq!==lastClearSeq){
      lastClearSeq=cev.seq;
      if(_canReceive){
        wipeAnnotations();
        // Defensive: a Clear from the peer always implies "annotation
        // session ended" — release the floor/nav-lock too in case the
        // explicit unlock packet was dropped or reordered.
        setRemoteFloor(false);
      }
    }

    var nlev=state.incomingNavLockEvent;
    if(nlev&&nlev.seq!==lastNavLockSeq){
      lastNavLockSeq=nlev.seq;
      // nav_lock IS the shared annotation floor: freeze this side's Matterport
      // AND block new local gesture starts for its duration. setRemoteFloor
      // arms a bounded safety timeout so a crashed peer can't lock us out.
      if(_canReceive) setRemoteFloor(nlev.locked===true);
    }

    var dev=state.incomingStrokeDeleteEvent;
    if(dev&&dev.seq!==lastStrokeDeleteSeq){
      lastStrokeDeleteSeq=dev.seq;
      // Defense in depth: a delete proves the peer's eraser is mid-gesture, so
      // re-arm the remote watchdog too (the nav_lock heartbeat is the primary
      // keepalive; this just hardens the delete-heavy path).
      if(_canReceive) refreshRemoteFloor();
      // Idempotent erase: drop any matching ids; unknown / already-removed
      // ids change nothing (no redraw), so duplicate/stale deletes are safe.
      if(_canReceive&&dev.strokeIds&&dev.strokeIds.length){
        var beforeLen=localStrokes.length;
        localStrokes=localStrokes.filter(function(s){ return dev.strokeIds.indexOf(s.strokeId)<0; });
        if(localStrokes.length!==beforeLen) redrawAllStrokes();
      }
    }
  }

  session.subscribe(onState);
})();
// f3d:runtime-js:glue END`;
