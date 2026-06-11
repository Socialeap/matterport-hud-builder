// Atlas Curated Showcase — "Explore Together" (Shared Tour) runtime glue.
//
// Self-contained controller binding for the Atlas curated showcase page.
// It REUSES the tested createLiveSession() controller (injected verbatim
// just before this file inside the same <script> via getLiveSessionRuntimeJS)
// and the shared mobile-input helpers from portal/anno-input.mjs (injected
// between the controller and this glue via getAnnoInputJS), and wires them
// to a minimal, portal-free DOM. The wire protocol and the normalized-[0,1]
// annotation pipeline are identical to the builder export, so the same
// controller drives both surfaces.
//
// Roles map to user-facing language: the controller "agent" is the Host,
// the controller "visitor" is the Guest. The controller role strings are
// internal and never shown.
//
// Browser-safety constraints (shared with the other runtime .mjs modules,
// enforced by scripts/verify-portal-html.mjs): NO single-quote string
// literals, NO import/export, NO TypeScript syntax. Single backslashes are
// correct here because this file is injected via ?raw, not nested inside a
// TS template literal.
//
// Graceful degradation:
//   - PeerJS missing / blocked CDN  -> createLiveSession is absent OR
//     init resolves to an error state; the static tour stays fully usable
//     and only the Explore Together button is disabled / shows a message.
//   - Microphone denied / unavailable -> the controller falls back to a
//     silent track; session + annotation + location sync still work.
//   - Clipboard read unavailable (Safari/Firefox) -> ambient location sync
//     degrades silently; everything else is unaffected.

(function initAtlasLiveTour() {
  if (typeof document === "undefined") return;

  var launchBtn = document.getElementById("lt-launch-btn");

  // Desktop-only Live Tour: collaboration is gated by the shared fail-closed
  // predicate from the anno-input kernel. Ineligible devices (phones,
  // tablets, iPad even with a keyboard/trackpad, ambiguous touch-first
  // environments) get EVERY collaboration affordance removed before any
  // wiring: no PeerJS download, no session controller, no mic, no clipboard
  // sync, no annotation surfaces, nothing focusable. Solo viewing, sharing,
  // fullscreen and PWA behavior are untouched. Fails closed if the kernel
  // is missing.
  var COLLAB_ELIGIBLE =
    typeof annoCollabEligible === "function" &&
    annoCollabEligible(
      typeof window !== "undefined" ? window : null,
      typeof navigator !== "undefined" ? navigator : null,
    );
  if (!COLLAB_ELIGIBLE) {
    var collabIds = [
      "lt-launch-btn",
      "lt-panel",
      "anno-toolbar",
      "anno-canvas",
      "remote-pointer",
      "lt-navlock",
      "loc-sync",
      "loc-sync-tips",
      "lt-audio",
    ];
    for (var ci = 0; ci < collabIds.length; ci++) {
      var cn = document.getElementById(collabIds[ci]);
      if (!cn) continue;
      if (cn.parentNode && typeof cn.parentNode.removeChild === "function") {
        cn.parentNode.removeChild(cn);
      } else {
        cn.hidden = true;
      }
    }
    return;
  }

  // Hard guard: the controller factory is injected just above. If it is
  // missing (script assembly bug) the page must still work as a plain
  // tour — disable only the live-tour affordance.
  if (typeof createLiveSession !== "function") {
    if (launchBtn) {
      launchBtn.disabled = true;
      launchBtn.hidden = false;
      launchBtn.setAttribute("title", "Live tour unavailable in this browser");
    }
    return;
  }
  // Eligible desktop: reveal the launch button (ships hidden so ineligible
  // devices never flash it before this glue runs).
  if (launchBtn) launchBtn.hidden = false;

  var CONFIG =
    window.__ATLAS_LT_CONFIG && typeof window.__ATLAS_LT_CONFIG === "object"
      ? window.__ATLAS_LT_CONFIG
      : {};
  var ACCENT = typeof CONFIG.accent === "string" ? CONFIG.accent : "#818cf8";
  var MP_BASE = typeof CONFIG.matterportBaseUrl === "string" ? CONFIG.matterportBaseUrl : "";
  var SHARE_TITLE = typeof CONFIG.shareTitle === "string" ? CONFIG.shareTitle : "Frontiers3D Showcase";
  var STOPS = Array.isArray(CONFIG.stops) ? CONFIG.stops : [];

  // ── Platform + assembly gates (early: the session factory below needs
  //    them; anno-input.mjs function declarations are hoisted across the
  //    shared IIFE body, so they are callable here). ───────────────────
  var ANNO_INPUT_OK =
    typeof createAnnoPointerGuard === "function" &&
    typeof annoCollectPoints === "function" &&
    typeof annoClampDpr === "function" &&
    typeof annoBudgetDpr === "function" &&
    typeof annoIsIosWebKit === "function" &&
    typeof annoIsCoarsePointer === "function" &&
    typeof annoBindViewportEvents === "function";

  // iOS/iPadOS WebKit (incl. iPad desktop mode and iOS Chrome): drives
  // the clipboard isolation (ambientClipboardAllowed), the DEFERRED
  // voice startup, and the tighter canvas DPR + pixel budget.
  var IS_IOS_WEBKIT =
    typeof annoIsIosWebKit === "function" ? annoIsIosWebKit(navigator) : false;

  // ── DOM refs ────────────────────────────────────────────────────────
  var panel = document.getElementById("lt-panel");
  var panelClose = document.getElementById("lt-panel-close");
  var roleChoose = document.getElementById("lt-role-choose");
  var hostStartBtn = document.getElementById("lt-host-start-btn");
  var guestChooseBtn = document.getElementById("lt-guest-choose-btn");
  var hostBlock = document.getElementById("lt-host-block");
  var guestBlock = document.getElementById("lt-guest-block");
  var pinValue = document.getElementById("lt-pin-value");
  var pinInput = document.getElementById("lt-pin-input");
  var joinBtn = document.getElementById("lt-join-btn");
  var hostStatus = document.getElementById("lt-host-status");
  var guestStatus = document.getElementById("lt-guest-status");
  var inviteBtn = document.getElementById("lt-invite-btn");
  var inviteStatus = document.getElementById("lt-invite-status");
  var backLinks = document.querySelectorAll(".lt-back-link");
  var stopsWrap = document.getElementById("lt-stops");
  var leaveBtns = document.querySelectorAll(".lt-leave-btn");
  var statusChip = document.getElementById("lt-status-chip");
  var audioEl = document.getElementById("lt-audio");

  // Annotation overlay refs.
  var letterboxWrap = document.getElementById("anno-letterbox-wrap");
  var frame = document.getElementById("matterport-frame");
  var annoCanvas = document.getElementById("anno-canvas");
  var annoCtx = annoCanvas ? annoCanvas.getContext("2d") : null;
  var annoToolbar = document.getElementById("anno-toolbar");
  var remotePointer = document.getElementById("remote-pointer");
  var clearBtn = document.getElementById("anno-clear-btn");
  var navlockEl = document.getElementById("lt-navlock");

  // Location-sync pill refs.
  var syncBtn = document.getElementById("loc-sync");
  var syncLabelEl = syncBtn ? syncBtn.querySelector(".loc-sync-label") : null;
  var tipsEl = document.getElementById("loc-sync-tips");

  // Live-session extras: voice status + manual paste-to-sync fallback. Shown
  // once a tour is connected; the manual field is the safety net for browsers
  // where clipboard read is blocked or unavailable.
  var liveExtras = document.getElementById("lt-live-extras");
  var voiceStatus = document.getElementById("lt-voice-status");
  var enableVoiceBtn = document.getElementById("lt-enable-voice-btn");
  var diagEl = document.getElementById("lt-diag");
  // True between a startVoice() that began a call and either a remote
  // stream arriving or the attempt dying — drives the retry re-enable.
  var voiceAttemptPending = false;
  var voiceConnected = false;

  // ── Diagnostic milestones (P0 iPad crash instrumentation) ───────────
  // Persisted to sessionStorage so a tab crash/reload still reveals the
  // LAST completed step of the connect transition. Controller milestones
  // (data_connected, mic_requested/granted/denied, media_call_started,
  // remote_stream) arrive via the onDiagnostic hook; glue milestones
  // (layout_started, canvas_allocated, audio_playing) are marked direct.
  var MILESTONE_LOG_KEY = "f3d_lt_milestone_log";
  var MILESTONE_LAST_KEY = "f3d_lt_last_milestone";

  // Notify the embedding Atlas app (parent window) that an interaction
  // needing stable touch gestures has begun — Draw / Focus Rope / pointer
  // tool selection, or a live session connecting. The parent uses this to
  // drop out of native Device fullscreen into Maximize on iPad (iPadOS
  // swipe-exit would otherwise collapse native fullscreen mid-draw). Uses
  // the same f3d: postMessage namespace as the share-url bridge. No-op
  // when there is no distinct parent (showcase opened directly, not in the
  // Atlas modal). The parent half is origin-checked via event.source.
  function emitInteractionActive() {
    try {
      if (typeof window === "undefined") return;
      if (!window.parent || window.parent === window) return;
      window.parent.postMessage({ type: "f3d:interaction-active" }, "*");
    } catch (_e) {}
  }

  function markMilestone(name) {
    try {
      if (!window.sessionStorage) return;
      window.sessionStorage.setItem(MILESTONE_LAST_KEY, String(name) + "@" + Date.now());
      var raw = window.sessionStorage.getItem(MILESTONE_LOG_KEY);
      var arr;
      try {
        arr = raw ? JSON.parse(raw) : [];
      } catch (_e) {
        arr = [];
      }
      if (!Array.isArray(arr)) arr = [];
      arr.push({ m: String(name), ts: Date.now() });
      if (arr.length > 40) arr = arr.slice(arr.length - 40);
      window.sessionStorage.setItem(MILESTONE_LOG_KEY, JSON.stringify(arr));
    } catch (_e) {}
  }
  function resetMilestoneLog() {
    try {
      if (!window.sessionStorage) return;
      window.sessionStorage.removeItem(MILESTONE_LOG_KEY);
      window.sessionStorage.setItem(MILESTONE_LAST_KEY, "session_starting@" + Date.now());
    } catch (_e) {}
  }
  // Crash forensics: if a previous session in this tab recorded
  // milestones, surface the last one reached in the panel.
  (function reportPriorMilestone() {
    try {
      if (!window.sessionStorage || !diagEl) return;
      var last = window.sessionStorage.getItem(MILESTONE_LAST_KEY);
      if (!last) return;
      diagEl.textContent = "Previous live-tour session reached: " + String(last).split("@")[0];
      diagEl.hidden = false;
    } catch (_e) {}
  })();

  // Lazy PeerJS (pinned + SRI, declared inert in the head dep span):
  // downloaded ONLY when this eligible desktop user actually hosts or
  // joins a tour. Concurrent Host/Join clicks share one promise; a
  // failure or 12s timeout resets it so the next click retries, with the
  // error surfaced on the role status line. The controller receives a
  // forwarding constructor so it can be built now (network-inert) and
  // still pick up the lazily-loaded Peer global at connect time.
  var peerJsPromise = null;
  function ensurePeerJs() {
    if (typeof Peer === "function") return Promise.resolve(true);
    if (peerJsPromise) return peerJsPromise;
    peerJsPromise = new Promise(function (resolve, reject) {
      var cfg = document.getElementById("f3d-peerjs-loader");
      var src = cfg && typeof cfg.getAttribute === "function" ? cfg.getAttribute("data-src") : null;
      if (!src) {
        reject(new Error("PeerJS loader config missing"));
        return;
      }
      var s = document.createElement("script");
      s.src = src;
      var integ = cfg.getAttribute("data-integrity");
      if (integ) s.integrity = integ;
      var cross = cfg.getAttribute("data-crossorigin");
      if (cross) s.crossOrigin = cross;
      var done = false;
      // Failure cleanup: clear the watchdog, detach handlers (so a late
      // load/error from this dead element is doubly inert on top of the done
      // guard), and remove the failed <script> from the DOM so a retry never
      // stacks tags.
      function cleanup() {
        try {
          clearTimeout(timer);
        } catch (_e) {}
        s.onload = null;
        s.onerror = null;
        try {
          if (s.parentNode && typeof s.parentNode.removeChild === "function") {
            s.parentNode.removeChild(s);
          }
        } catch (_e) {}
      }
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("PeerJS load timed out"));
      }, 12000);
      s.onload = function () {
        if (done) return;
        done = true;
        if (typeof Peer === "function") {
          try {
            clearTimeout(timer);
          } catch (_e) {}
          resolve(true);
        } else {
          cleanup();
          reject(new Error("PeerJS loaded without a Peer global"));
        }
      };
      s.onerror = function () {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error("PeerJS failed to load"));
      };
      (document.head || document.documentElement).appendChild(s);
    });
    peerJsPromise.then(null, function () {
      peerJsPromise = null;
    });
    return peerJsPromise;
  }
  function lazyPeerCtor(id) {
    return new Peer(id);
  }

  // Session factory: every (re)creation carries the same policy — voice
  // is DEFERRED on iOS (no automatic getUserMedia / AudioContext / media
  // call during the connect transition; see the Enable voice button) and
  // the controller reports diagnostic milestones via markMilestone.
  function newSession() {
    return createLiveSession({
      deferVoice: IS_IOS_WEBKIT,
      onDiagnostic: markMilestone,
      PeerCtor: lazyPeerCtor,
    });
  }
  var session = newSession();
  var lastTeleportTs = 0;
  var lastShareTs = 0;
  var wasConnected = false;

  // ── Annotation state (normalized [0,1] over the 16:9 letterbox) ──────
  var ANNO_STROKE_COLOR = "#ff3b30";
  var ANNO_STROKE_WIDTH = 0.004;
  var ANNO_REMOTE_POINTER_TIMEOUT_MS = 2500;
  var ANNO_ROPE_SHAPE = "circle";
  var ANNO_ROPE_SHAPE_WHITELIST = { circle: 1, box: 1 };
  var ANNO_COLOR_WHITELIST = { "#ff3b30": 1, "#1e90ff": 1, "#22c55e": 1, "#ffffff": 1 };
  var ANNO_ROPE_CIRCLE_SAMPLES = 48;
  var ANNO_LATCH_PX = 10;
  // iPhone/iPad run under jetsam memory limits next to the Matterport
  // WebGL context: tighter DPR cap plus an absolute backing-store pixel
  // budget (RGBA bytes = pixels * 4). Desktop keeps retina sharpness.
  var ANNO_DPR_MAX = IS_IOS_WEBKIT ? 1.5 : 2.5;
  var ANNO_PIXEL_BUDGET = IS_IOS_WEBKIT ? 4194304 : 9437184;

  // Coarse-pointer (touch-first) detection drives runtime affordance
  // sizing (latch size/hit radius); the CSS @media (pointer: coarse)
  // block handles the toolbar/panel controls.
  var IS_COARSE_POINTER =
    typeof annoIsCoarsePointer === "function" ? annoIsCoarsePointer(window) : false;
  var ANNO_LATCH_DRAW_PX = IS_COARSE_POINTER ? 14 : ANNO_LATCH_PX;

  var toolMode = "none";
  var currentViewKey = "";
  var localStrokes = [];
  var activeStroke = null;
  var pendingStrokePoints = null;
  var pendingStrokeId = null;
  var strokeFlushScheduled = false;
  var lastPointerSeq = 0;
  var lastStrokeSeq = 0;
  var lastClearSeq = 0;
  var lastNavLockSeq = 0;
  var lastStrokeDeleteSeq = 0;
  var remotePointerHideTimer = null;
  // Shared annotation "floor": a gesture-scoped, invisible turn lock carried
  // on the existing nav_lock message. While the PEER holds it
  // (remoteGestureActive) this side won't START a new Draw/Rope/Eraser gesture
  // and its Matterport is frozen; the instant the peer's gesture ends
  // (nav_lock:false or the bounded safety timeout) annotation + navigation
  // free up again. Engaged per-gesture (pointerdown), released on every
  // gesture-end path. No visible turn UI.
  var FLOOR_SAFETY_MS = 8000;
  var remoteGestureActive = false;
  var remoteFloorTimer = null;
  var localFloorHeld = false;
  var localFloorTimer = null;
  // Eraser tool: tap- or drag-delete of committed strokes (geometric hit
  // test). eraserDeletedIds dedupes a drag so each stroke is removed once.
  var ANNO_ERASER_TOLERANCE_PX = 12;
  var eraserActive = false;
  var eraserDeletedIds = null;
  var activeRope = null;
  var ropeDragging = false;
  var ropeLatchDragging = false;
  var ropeFlushScheduled = false;
  var ropeMoveDragging = false;
  var ropeMoveLast = null;
  var annoAppliedDpr = 1;
  var canvasAllocated = false;
  var lastCanvasW = 0;
  var lastCanvasH = 0;
  var lastCanvasDpr = 0;
  var canvasResizeScheduled = false;

  // Single-owner pointer guard (anno-input.mjs, injected just above this
  // glue). FAIL CLOSED if script assembly ever regresses (Codex review
  // 2026-06-06): a permissive fallback would silently restore the unsafe
  // multi-touch behavior the guard exists to prevent, so when any helper
  // is missing the Draw / Focus Rope tools are disabled outright (see
  // setToolMode + the toolbar disable block below) while Matterport
  // viewing, voice, pointer, clear, and location sync stay fully
  // functional — the same shape as the createLiveSession hard guard.
  // finalizeActiveGesture is a hoisted declaration (rope helpers below);
  // ANNO_INPUT_OK / IS_IOS_WEBKIT are computed early, above the session
  // factory.
  var annoGuard = ANNO_INPUT_OK
    ? createAnnoPointerGuard({ onTakeover: finalizeActiveGesture })
    : null;

  function collectNormPoints(e) {
    if (typeof annoCollectPoints === "function") return annoCollectPoints(e, clientToNorm);
    return [clientToNorm(e)];
  }

  function clampedDpr() {
    var raw = window.devicePixelRatio || 1;
    if (typeof annoClampDpr === "function") return annoClampDpr(raw, ANNO_DPR_MAX);
    return Math.min(raw, ANNO_DPR_MAX);
  }

  // ── Small helpers ───────────────────────────────────────────────────
  function setText(el, text) {
    if (el) el.textContent = text;
  }
  function show(el) {
    if (el) el.hidden = false;
  }
  function hide(el) {
    if (el) el.hidden = true;
  }
  function shareUrl() {
    try {
      return String(window.location.href).split("#")[0];
    } catch (_e) {
      return "";
    }
  }

  function openPanel() {
    if (panel) panel.classList.add("open");
    if (launchBtn) launchBtn.setAttribute("aria-expanded", "true");
  }
  function closePanel() {
    if (panel) panel.classList.remove("open");
    if (launchBtn) launchBtn.setAttribute("aria-expanded", "false");
  }
  function togglePanel() {
    if (panel && panel.classList.contains("open")) closePanel();
    else openPanel();
  }

  function setHudButtonState(state) {
    if (!launchBtn) return;
    launchBtn.classList.remove("is-waiting", "connected");
    if (state.isConnected) launchBtn.classList.add("connected");
    else if (
      state.status === "waiting" ||
      state.status === "connecting" ||
      state.status === "initializing"
    ) {
      launchBtn.classList.add("is-waiting");
    }
  }

  function showRoleChoose() {
    show(roleChoose);
    hide(hostBlock);
    hide(guestBlock);
  }

  function resetUiToIdle() {
    showRoleChoose();
    if (joinBtn) joinBtn.disabled = false;
    if (hostStartBtn) hostStartBtn.disabled = false;
    if (pinInput) pinInput.value = "";
    if (pinValue) pinValue.textContent = "----";
    setText(hostStatus, "");
    setText(guestStatus, "");
    setText(inviteStatus, "");
    if (stopsWrap) stopsWrap.innerHTML = "";
    if (statusChip) statusChip.hidden = true;
    if (audioEl) {
      try {
        audioEl.srcObject = null;
      } catch (_e) {}
    }
    hide(liveExtras);
    setVoiceStatus("", "off");
    voiceConnected = false;
    voiceAttemptPending = false;
    if (enableVoiceBtn) {
      enableVoiceBtn.hidden = true;
      enableVoiceBtn.disabled = false;
    }
  }

  // ── Letterbox / body-class engagement ───────────────────────────────
  function setBodyLetterboxClass(active, isHost) {
    if (!document || !document.body) return;
    if (active) {
      document.body.classList.add("live-tour-active");
      if (isHost) {
        document.body.classList.add("live-tour-host");
        document.body.classList.remove("live-tour-guest");
      } else {
        document.body.classList.add("live-tour-guest");
        document.body.classList.remove("live-tour-host");
      }
    } else {
      document.body.classList.remove("live-tour-active");
      document.body.classList.remove("live-tour-host");
      document.body.classList.remove("live-tour-guest");
    }
  }

  // ── Annotation rendering ────────────────────────────────────────────
  function setToolMode(mode) {
    // Fail closed: gesture tools require the anno-input guard. Gating
    // here covers the toolbar, the hotkeys, and any future entry point.
    if ((mode === "draw" || mode === "rope") && !ANNO_INPUT_OK) return;
    var prev = toolMode;
    toolMode = mode;
    if (annoCanvas) {
      annoCanvas.classList.remove("pointer-mode", "draw-mode", "rope-mode", "eraser-mode");
      if (mode === "pointer") annoCanvas.classList.add("pointer-mode");
      else if (mode === "draw") annoCanvas.classList.add("draw-mode");
      else if (mode === "rope") annoCanvas.classList.add("rope-mode");
      else if (mode === "eraser") annoCanvas.classList.add("eraser-mode");
    }
    if (annoToolbar) {
      var btns = annoToolbar.querySelectorAll(".anno-tool-btn[data-tool]");
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.getAttribute("data-tool") === mode) b.classList.add("active");
        else b.classList.remove("active");
      }
    }
    if (mode === "draw" || mode === "rope") ensureAnnoCanvasAllocated();
    if (mode === "pointer" || mode === "draw" || mode === "rope" || mode === "eraser") emitInteractionActive();
    try {
      document.body.classList.toggle("anno-rope-active", mode === "rope");
      // Stage gesture hardening (wrapper touch-action/user-select, the
      // stage-event kills) engages ONLY while a tool is active so
      // Matterport navigation is untouched otherwise (2.0.2 wrapper fix).
      document.body.classList.toggle(
        "anno-tool-active",
        mode === "pointer" || mode === "draw" || mode === "rope" || mode === "eraser",
      );
    } catch (_e) {}
    if (prev !== "rope" && mode === "rope") {
      try {
        var sel = document.getElementById("anno-shape-select");
        if (sel) {
          sel.focus();
          if (typeof sel.showPicker === "function") sel.showPicker();
        }
      } catch (_e) {}
    }
    if (prev === "pointer" && mode !== "pointer") {
      var s = session.getState();
      if ((s.role === "agent" || s.role === "visitor") && s.isConnected) {
        session.sendPointer(currentViewKey, null, null);
      }
    }
    if (prev === "rope" && mode !== "rope") {
      commitActiveRope();
    }
    // The peer-freeze is now GESTURE-scoped (the shared annotation floor),
    // engaged on pointerdown and released on gesture end — not tied to which
    // tool is selected. A tool change just ends any floor this side holds;
    // navigation stays normal between gestures (both peers free).
    try {
      releaseLocalFloor();
    } catch (_e) {}
  }

  // LAZY canvas allocation (P0 iPad fix): the backing store is NOT
  // allocated when the PIN connects — that transition already carries
  // WebRTC setup and the letterbox layout flip. The buffer is created on
  // first need (Draw/Focus Rope selected, or a remote stroke arrives)
  // and reallocated only when geometry/DPR actually changed.
  function ensureAnnoCanvasAllocated() {
    if (canvasAllocated) return;
    canvasAllocated = true;
    markMilestone("canvas_allocated");
    resizeAnnoCanvas();
  }

  function resizeAnnoCanvas() {
    if (!canvasAllocated) return;
    if (!annoCanvas || !letterboxWrap || !annoCtx) return;
    var rect = letterboxWrap.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var dpr = clampedDpr();
    if (typeof annoBudgetDpr === "function") dpr = annoBudgetDpr(w, h, dpr, ANNO_PIXEL_BUDGET);
    // Dedupe: ResizeObserver, visualViewport, and orientation events can
    // fire together for one geometry change, and assigning canvas.width
    // reallocates (and clears) the buffer even with an unchanged value.
    if (w === lastCanvasW && h === lastCanvasH && dpr === lastCanvasDpr) return;
    lastCanvasW = w;
    lastCanvasH = h;
    lastCanvasDpr = dpr;
    annoAppliedDpr = dpr;
    annoCanvas.width = Math.max(1, Math.round(w * dpr));
    annoCanvas.height = Math.max(1, Math.round(h * dpr));
    annoCanvas.style.width = w + "px";
    annoCanvas.style.height = h + "px";
    try {
      annoCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } catch (_e) {}
    redrawAllStrokes();
  }

  // Coalesce the resize triggers through one frame so simultaneous
  // observer callbacks produce at most one reallocation.
  function scheduleCanvasResize() {
    if (!canvasAllocated) return;
    if (canvasResizeScheduled) return;
    canvasResizeScheduled = true;
    var raf =
      window.requestAnimationFrame ||
      function (cb) {
        return setTimeout(cb, 16);
      };
    raf(function () {
      canvasResizeScheduled = false;
      resizeAnnoCanvas();
    });
  }

  // Free the backing store on teardown so an ended tour leaves no
  // multi-megabyte buffer behind on memory-constrained devices.
  function releaseAnnoCanvas() {
    canvasAllocated = false;
    lastCanvasW = 0;
    lastCanvasH = 0;
    lastCanvasDpr = 0;
    annoAppliedDpr = 1;
    if (annoCanvas) {
      try {
        annoCanvas.width = 1;
        annoCanvas.height = 1;
        annoCanvas.style.width = "";
        annoCanvas.style.height = "";
      } catch (_e) {}
    }
  }

  function redrawAllStrokes() {
    if (!canvasAllocated) return;
    if (!annoCtx || !annoCanvas) return;
    // Back out the SAME (clamped) ratio resizeAnnoCanvas applied — using
    // the raw devicePixelRatio here would misscale on capped displays.
    var dpr = annoAppliedDpr || 1;
    var w = annoCanvas.width / dpr;
    var h = annoCanvas.height / dpr;
    annoCtx.clearRect(0, 0, w, h);
    for (var i = 0; i < localStrokes.length; i++) drawStroke(localStrokes[i], w, h);
    if (activeStroke) drawStroke(activeStroke, w, h);
    if (activeRope) drawRopeLatch(activeRope, w, h);
  }

  function drawStroke(stroke, w, h) {
    if (!stroke || !stroke.points || stroke.points.length === 0) return;
    var color = stroke.color || ANNO_STROKE_COLOR;
    var width = typeof stroke.width === "number" ? stroke.width : ANNO_STROKE_WIDTH;
    annoCtx.strokeStyle = color;
    annoCtx.lineWidth = Math.max(1, width * w);
    annoCtx.lineCap = "round";
    annoCtx.lineJoin = "round";
    annoCtx.beginPath();
    var p0 = stroke.points[0];
    annoCtx.moveTo(p0[0] * w, p0[1] * h);
    if (stroke.points.length === 1) {
      annoCtx.lineTo(p0[0] * w + 0.01, p0[1] * h + 0.01);
    } else {
      for (var i = 1; i < stroke.points.length; i++) {
        var p = stroke.points[i];
        annoCtx.lineTo(p[0] * w, p[1] * h);
      }
    }
    annoCtx.stroke();
  }

  function findLocalStroke(id) {
    for (var i = 0; i < localStrokes.length; i++) {
      if (localStrokes[i].strokeId === id) return localStrokes[i];
    }
    return null;
  }

  function clientToNorm(e) {
    if (!letterboxWrap) return { x: 0, y: 0 };
    var rect = letterboxWrap.getBoundingClientRect();
    var w = rect.width || 1;
    var h = rect.height || 1;
    var x = (e.clientX - rect.left) / w;
    var y = (e.clientY - rect.top) / h;
    if (x < 0) x = 0;
    else if (x > 1) x = 1;
    if (y < 0) y = 0;
    else if (y > 1) y = 1;
    return { x: x, y: y };
  }

  function scheduleStrokeFlush() {
    if (strokeFlushScheduled) return;
    strokeFlushScheduled = true;
    var raf =
      window.requestAnimationFrame ||
      function (cb) {
        return setTimeout(cb, 16);
      };
    raf(function () {
      strokeFlushScheduled = false;
      if (!pendingStrokeId || !pendingStrokePoints || pendingStrokePoints.length === 0) return;
      var batch = pendingStrokePoints;
      pendingStrokePoints = [];
      session.sendStrokePatch(currentViewKey, pendingStrokeId, batch);
    });
  }

  // ── Focus Rope helpers (rendered as polylines so they ride the normal
  //    stroke pipeline; the latch is a local affordance only) ──────────
  function ropeBBox(rope) {
    var x0 = Math.min(rope.x0, rope.x1),
      y0 = Math.min(rope.y0, rope.y1);
    var x1 = Math.max(rope.x0, rope.x1),
      y1 = Math.max(rope.y0, rope.y1);
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  }
  function ropeToPoints(rope) {
    var b = ropeBBox(rope);
    var cx = (b.x0 + b.x1) / 2,
      cy = (b.y0 + b.y1) / 2;
    var rx = (b.x1 - b.x0) / 2,
      ry = (b.y1 - b.y0) / 2;
    var out = [];
    if (rope.shape === "box") {
      out.push([b.x0, b.y0]);
      out.push([b.x1, b.y0]);
      out.push([b.x1, b.y1]);
      out.push([b.x0, b.y1]);
      out.push([b.x0, b.y0]);
    } else {
      var n = ANNO_ROPE_CIRCLE_SAMPLES;
      for (var i = 0; i <= n; i++) {
        var t = (i / n) * Math.PI * 2;
        var x = cx + Math.cos(t) * rx;
        var y = cy + Math.sin(t) * ry;
        if (x < 0) x = 0;
        else if (x > 1) x = 1;
        if (y < 0) y = 0;
        else if (y > 1) y = 1;
        out.push([x, y]);
      }
    }
    return out;
  }
  function ropeLatchPos(rope) {
    var b = ropeBBox(rope);
    return { x: b.x1, y: b.y1 };
  }
  function ropePointInBBox(rope, pt) {
    var b = ropeBBox(rope);
    return pt.x >= b.x0 && pt.x <= b.x1 && pt.y >= b.y0 && pt.y <= b.y1;
  }
  // Latch hit radius: 24px (48px target) for touch/pen so the resize
  // handle meets the 44px minimum; mouse keeps the precise 20px zone.
  function latchHitRadiusPx(e) {
    var t = e && typeof e.pointerType === "string" ? e.pointerType : "";
    if (t === "touch" || t === "pen" || IS_COARSE_POINTER) return 24;
    return ANNO_LATCH_PX * 2;
  }
  function drawRopeLatch(rope, w, h) {
    if (!annoCtx) return;
    var lp = ropeLatchPos(rope);
    var px = lp.x * w,
      py = lp.y * h;
    var r = Math.max(5, Math.min(ANNO_LATCH_DRAW_PX, 16));
    annoCtx.beginPath();
    annoCtx.arc(px, py, r, 0, Math.PI * 2);
    annoCtx.fillStyle = rope.color || ANNO_STROKE_COLOR;
    annoCtx.fill();
    annoCtx.lineWidth = 2;
    annoCtx.strokeStyle = "#ffffff";
    annoCtx.stroke();
  }
  function ropeRegenerate(rope) {
    rope.points = ropeToPoints(rope);
  }
  function scheduleRopeFlush() {
    if (ropeFlushScheduled) return;
    ropeFlushScheduled = true;
    var raf =
      window.requestAnimationFrame ||
      function (cb) {
        return setTimeout(cb, 16);
      };
    raf(function () {
      ropeFlushScheduled = false;
      if (!activeRope) return;
      var s = session.getState();
      if ((s.role !== "agent" && s.role !== "visitor") || !s.isConnected) return;
      session.sendStrokeBegin(
        currentViewKey,
        activeRope.strokeId,
        activeRope.color,
        activeRope.width,
        activeRope.points,
      );
    });
  }
  function commitActiveRope() {
    if (!activeRope) return;
    var s = session.getState();
    if ((s.role === "agent" || s.role === "visitor") && s.isConnected) {
      session.sendStrokeBegin(
        currentViewKey,
        activeRope.strokeId,
        activeRope.color,
        activeRope.width,
        activeRope.points,
      );
      session.sendStrokeCommit(currentViewKey, activeRope.strokeId);
    }
    activeRope.committed = true; // sealed rope is now erasable (same obj in localStrokes)
    activeRope = null;
    ropeDragging = false;
    ropeLatchDragging = false;
    ropeMoveDragging = false;
    ropeMoveLast = null;
    redrawAllStrokes();
  }

  // Finish the in-flight freehand stroke: flush queued points, commit on
  // the wire, and promote it to localStrokes. Idempotent (no-op when no
  // stroke is active) so pointerup / pointercancel / lostpointercapture
  // can all route here without double-sending.
  function finishActiveDraw() {
    if (!activeStroke) return;
    if (pendingStrokePoints && pendingStrokePoints.length > 0) {
      session.sendStrokePatch(currentViewKey, pendingStrokeId, pendingStrokePoints);
    }
    pendingStrokePoints = null;
    session.sendStrokeCommit(currentViewKey, activeStroke.strokeId);
    activeStroke.committed = true; // eligible for the eraser only once sealed
    localStrokes.push(activeStroke);
    activeStroke = null;
    pendingStrokeId = null;
  }

  // End the in-flight rope drag (initial draw / latch-resize / move) and
  // resend the final shape. The rope itself stays active so its latch
  // remains grabbable; commitActiveRope() seals it on tool exit.
  function finishActiveRopeDrag() {
    if (!activeRope) return;
    if (!ropeDragging && !ropeLatchDragging && !ropeMoveDragging) return;
    ropeDragging = false;
    ropeLatchDragging = false;
    ropeMoveDragging = false;
    ropeMoveLast = null;
    var s = session.getState();
    if ((s.role === "agent" || s.role === "visitor") && s.isConnected) {
      session.sendStrokeBegin(
        currentViewKey,
        activeRope.strokeId,
        activeRope.color,
        activeRope.width,
        activeRope.points,
      );
    }
    redrawAllStrokes();
  }

  // Commit-or-abort for pen takeover, pointercancel, and
  // lostpointercapture. We COMMIT the in-flight gesture: the remote side
  // already holds its begin/patch packets, so committing is the only path
  // that leaves no orphan stroke on either end.
  function finalizeActiveGesture() {
    if (toolMode === "draw") finishActiveDraw();
    else if (toolMode === "rope") finishActiveRopeDrag();
  }

  function wipeAnnotations() {
    localStrokes = [];
    activeStroke = null;
    pendingStrokeId = null;
    pendingStrokePoints = null;
    activeRope = null;
    ropeDragging = false;
    ropeLatchDragging = false;
    ropeMoveDragging = false;
    ropeMoveLast = null;
    eraserActive = false;
    eraserDeletedIds = null;
    if (annoGuard) annoGuard.reset();
    if (remotePointer) remotePointer.style.display = "none";
    if (remotePointerHideTimer) {
      try {
        clearTimeout(remotePointerHideTimer);
      } catch (_e) {}
      remotePointerHideTimer = null;
    }
    redrawAllStrokes();
  }

  function applyNavLock(locked) {
    try {
      if (!navlockEl) return;
      if (locked) navlockEl.classList.add("locked");
      else navlockEl.classList.remove("locked");
    } catch (_e) {}
  }

  // ── Shared annotation floor (gesture-scoped, invisible) ─────────────
  // acquireLocalFloor: call at the START of a Draw/Rope/Eraser gesture.
  // Returns false (caller bails) when the peer holds the floor — the
  // invisible sequential-annotation rule. On success it broadcasts
  // nav_lock(true) so the peer freezes its Matterport and won't begin a
  // competing gesture, and arms a bounded local safety timeout.
  function acquireLocalFloor() {
    if (remoteGestureActive) return false;
    if (!localFloorHeld) {
      localFloorHeld = true;
      var s = session.getState();
      if ((s.role === "agent" || s.role === "visitor") && s.isConnected) {
        session.sendNavLock(currentViewKey, true);
      }
    }
    if (localFloorTimer) {
      try {
        clearTimeout(localFloorTimer);
      } catch (_e) {}
    }
    localFloorTimer = setTimeout(function () {
      releaseLocalFloor();
    }, FLOOR_SAFETY_MS);
    return true;
  }
  // releaseLocalFloor: idempotent; call on EVERY gesture-end path (pointerup,
  // pointercancel, lostpointercapture, tool change, disconnect) and from the
  // safety timeout. Broadcasts nav_lock(false) so the peer frees immediately.
  function releaseLocalFloor() {
    if (localFloorTimer) {
      try {
        clearTimeout(localFloorTimer);
      } catch (_e) {}
      localFloorTimer = null;
    }
    if (!localFloorHeld) return;
    localFloorHeld = false;
    var s = session.getState();
    if ((s.role === "agent" || s.role === "visitor") && s.isConnected) {
      session.sendNavLock(currentViewKey, false);
    }
  }
  // Push the safety watchdog out on owned-gesture activity so a long but
  // healthy stroke/rope/erase keeps the floor for its whole duration. The
  // timeout only fires ~FLOOR_SAFETY_MS after activity actually STOPS — the
  // genuine "pointerup/cancel never arrived" crash case — not mid-gesture.
  function refreshLocalFloor() {
    if (!localFloorHeld) return;
    if (localFloorTimer) {
      try {
        clearTimeout(localFloorTimer);
      } catch (_e) {}
    }
    localFloorTimer = setTimeout(function () {
      releaseLocalFloor();
    }, FLOOR_SAFETY_MS);
  }
  // setRemoteFloor: react to an inbound nav_lock. Freezes/unfreezes this
  // side's Matterport AND gates new local gesture starts. A bounded timeout
  // auto-clears so a peer that crashes mid-gesture can never lock this side
  // out; ongoing remote stroke activity refreshes it.
  function setRemoteFloor(active) {
    remoteGestureActive = active === true;
    applyNavLock(remoteGestureActive);
    if (remoteFloorTimer) {
      try {
        clearTimeout(remoteFloorTimer);
      } catch (_e) {}
      remoteFloorTimer = null;
    }
    if (remoteGestureActive) {
      remoteFloorTimer = setTimeout(function () {
        remoteGestureActive = false;
        applyNavLock(false);
        remoteFloorTimer = null;
      }, FLOOR_SAFETY_MS);
    }
  }
  function refreshRemoteFloor() {
    if (remoteGestureActive) setRemoteFloor(true);
  }

  // ── Eraser hit-testing (point-to-polyline distance, touch-tolerant) ──
  function pointSegDistPx(px, py, ax, ay, bx, by) {
    var vx = bx - ax,
      vy = by - ay,
      wx = px - ax,
      wy = py - ay;
    var c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.sqrt(wx * wx + wy * wy);
    var c2 = vx * vx + vy * vy;
    if (c2 <= c1) {
      var ex = px - bx,
        ey = py - by;
      return Math.sqrt(ex * ex + ey * ey);
    }
    var t = c1 / c2,
      projx = ax + t * vx,
      projy = ay + t * vy,
      dxp = px - projx,
      dyp = py - projy;
    return Math.sqrt(dxp * dxp + dyp * dyp);
  }
  function strokeHitTest(stroke, pt, rect, tolPx) {
    var pts = stroke && stroke.points;
    if (!pts || pts.length === 0) return false;
    var w = rect.width || 1,
      h = rect.height || 1;
    var px = pt.x * w,
      py = pt.y * h;
    var halfWidthPx =
      ((typeof stroke.width === "number" ? stroke.width : ANNO_STROKE_WIDTH) * w) / 2;
    var tol = Math.max(tolPx, halfWidthPx + tolPx * 0.5);
    if (pts.length === 1) {
      var dx0 = pts[0][0] * w - px,
        dy0 = pts[0][1] * h - py;
      return Math.sqrt(dx0 * dx0 + dy0 * dy0) <= tol;
    }
    for (var i = 1; i < pts.length; i++) {
      if (
        pointSegDistPx(px, py, pts[i - 1][0] * w, pts[i - 1][1] * h, pts[i][0] * w, pts[i][1] * h) <=
        tol
      )
        return true;
    }
    return false;
  }
  // Erase every COMMITTED stroke within tolerance of pt. In-flight
  // (uncommitted) local OR remote strokes are skipped. Each stroke is removed
  // at most once per eraser gesture; deletions sync via stroke_delete.
  function eraseAtPoint(pt, e) {
    if (!localStrokes.length) return;
    var rect = letterboxWrap
      ? letterboxWrap.getBoundingClientRect()
      : { width: 1, height: 1 };
    var tolPx = ANNO_ERASER_TOLERANCE_PX;
    var ptype = e && typeof e.pointerType === "string" ? e.pointerType : "";
    if (ptype === "touch" || ptype === "pen" || IS_COARSE_POINTER) tolPx = 24;
    var hitIds = [];
    for (var i = localStrokes.length - 1; i >= 0; i--) {
      var st = localStrokes[i];
      if (!st || st.committed !== true) continue;
      if (eraserDeletedIds && eraserDeletedIds[st.strokeId]) continue;
      if (strokeHitTest(st, pt, rect, tolPx)) {
        hitIds.push(st.strokeId);
        if (eraserDeletedIds) eraserDeletedIds[st.strokeId] = 1;
      }
    }
    if (hitIds.length === 0) return;
    localStrokes = localStrokes.filter(function (s) {
      return hitIds.indexOf(s.strokeId) < 0;
    });
    redrawAllStrokes();
    var s = session.getState();
    if ((s.role === "agent" || s.role === "visitor") && s.isConnected) {
      session.sendStrokeDelete(currentViewKey, hitIds);
    }
  }

  function handleClearLocallyAndBroadcast() {
    wipeAnnotations();
    var s = session.getState();
    if ((s.role === "agent" || s.role === "visitor") && s.isConnected) {
      session.sendClear(currentViewKey);
    }
  }

  function canAnnotateLocal() {
    var r = session.getState().role;
    return r === "agent" || r === "visitor";
  }

  // ── Canvas wiring (bidirectional: Host and Guest both annotate) ──────
  if (annoCanvas) {
    annoCanvas.addEventListener("pointerdown", function (e) {
      if (!canAnnotateLocal()) return;
      if (toolMode !== "draw" && toolMode !== "rope" && toolMode !== "eraser") return;
      // Sequential annotation: bail if the PEER currently holds the shared
      // floor; the instant their gesture ends we're free to start.
      if (remoteGestureActive) return;
      // Single-owner guard: rejects secondary touches outright; a Pencil
      // arriving mid-touch fires finalizeActiveGesture() first (clean
      // commit of the in-flight stroke) and then claims the gesture.
      // No guard (failed assembly) means no gesture, ever — setToolMode
      // already refuses draw/rope, this is the belt to that suspender.
      if (!annoGuard || !annoGuard.claim(e)) return;
      // Take the floor: broadcast nav_lock(true) so the peer pauses + freezes.
      acquireLocalFloor();
      if (toolMode === "draw") {
        var pt = clientToNorm(e);
        var sid = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 8);
        activeStroke = { strokeId: sid, color: ANNO_STROKE_COLOR, width: ANNO_STROKE_WIDTH, points: [[pt.x, pt.y]] };
        pendingStrokeId = sid;
        pendingStrokePoints = [];
        session.sendStrokeBegin(currentViewKey, sid, activeStroke.color, activeStroke.width, [[pt.x, pt.y]]);
        redrawAllStrokes();
        try {
          annoCanvas.setPointerCapture(e.pointerId);
        } catch (_e) {}
        e.preventDefault();
        return;
      }
      if (toolMode === "rope") {
        var rpt = clientToNorm(e);
        if (activeRope) {
          var lp = ropeLatchPos(activeRope);
          var rect = letterboxWrap ? letterboxWrap.getBoundingClientRect() : { width: 1, height: 1 };
          var dx = (rpt.x - lp.x) * rect.width;
          var dy = (rpt.y - lp.y) * rect.height;
          if (Math.sqrt(dx * dx + dy * dy) <= latchHitRadiusPx(e)) {
            ropeLatchDragging = true;
            try {
              annoCanvas.setPointerCapture(e.pointerId);
            } catch (_e) {}
            e.preventDefault();
            return;
          }
          // Inside the rope body (off the latch): drag moves the whole
          // rope — the touch affordance the resize-only latch lacked.
          if (ropePointInBBox(activeRope, rpt)) {
            ropeMoveDragging = true;
            ropeMoveLast = rpt;
            try {
              annoCanvas.setPointerCapture(e.pointerId);
            } catch (_e) {}
            e.preventDefault();
            return;
          }
          commitActiveRope();
        }
        var rsid = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 8);
        activeRope = {
          strokeId: rsid,
          color: ANNO_STROKE_COLOR,
          width: ANNO_STROKE_WIDTH,
          shape: ANNO_ROPE_SHAPE,
          x0: rpt.x,
          y0: rpt.y,
          x1: rpt.x,
          y1: rpt.y,
          points: [[rpt.x, rpt.y]],
        };
        ropeRegenerate(activeRope);
        localStrokes.push(activeRope);
        ropeDragging = true;
        scheduleRopeFlush();
        redrawAllStrokes();
        try {
          annoCanvas.setPointerCapture(e.pointerId);
        } catch (_e) {}
        e.preventDefault();
        return;
      }
      if (toolMode === "eraser") {
        eraserActive = true;
        eraserDeletedIds = {};
        try {
          annoCanvas.setPointerCapture(e.pointerId);
        } catch (_e) {}
        e.preventDefault();
        eraseAtPoint(clientToNorm(e), e); // tap-to-delete
        return;
      }
    });
    annoCanvas.addEventListener("pointermove", function (e) {
      if (!canAnnotateLocal()) return;
      if (toolMode === "pointer") {
        // Hover-driven; on touch only the primary finger drives the dot.
        if (e.isPrimary === false) return;
        var hp = clientToNorm(e);
        session.sendPointer(currentViewKey, hp.x, hp.y);
        return;
      }
      if (!annoGuard || !annoGuard.owns(e)) return;
      // Owned gesture: suppress any default WebKit handling for the move.
      e.preventDefault();
      refreshLocalFloor(); // keep the floor alive while this gesture is active
      if (toolMode === "draw" && activeStroke) {
        // Coalesced samples (120Hz Pencil) — oldest first, all appended
        // to the stroke and to the same outbound patch batch.
        var batch = collectNormPoints(e);
        if (!pendingStrokePoints) pendingStrokePoints = [];
        for (var bi = 0; bi < batch.length; bi++) {
          activeStroke.points.push([batch[bi].x, batch[bi].y]);
          pendingStrokePoints.push([batch[bi].x, batch[bi].y]);
        }
        scheduleStrokeFlush();
        redrawAllStrokes();
      } else if (toolMode === "rope" && activeRope && ropeMoveDragging) {
        var mpt = clientToNorm(e);
        var b = ropeBBox(activeRope);
        var mdx = mpt.x - ropeMoveLast.x;
        var mdy = mpt.y - ropeMoveLast.y;
        // Clamp the translation so the bbox never leaves [0,1] space.
        if (mdx < -b.x0) mdx = -b.x0;
        if (mdx > 1 - b.x1) mdx = 1 - b.x1;
        if (mdy < -b.y0) mdy = -b.y0;
        if (mdy > 1 - b.y1) mdy = 1 - b.y1;
        activeRope.x0 += mdx;
        activeRope.x1 += mdx;
        activeRope.y0 += mdy;
        activeRope.y1 += mdy;
        ropeMoveLast = mpt;
        ropeRegenerate(activeRope);
        scheduleRopeFlush();
        redrawAllStrokes();
      } else if (toolMode === "rope" && activeRope && (ropeDragging || ropeLatchDragging)) {
        var rpt2 = clientToNorm(e);
        activeRope.x1 = rpt2.x;
        activeRope.y1 = rpt2.y;
        ropeRegenerate(activeRope);
        scheduleRopeFlush();
        redrawAllStrokes();
      } else if (toolMode === "eraser" && eraserActive) {
        // Drag-erase: hit-test every coalesced sample so a fast sweep never
        // skips a stroke; eraserDeletedIds keeps each removal to one.
        var epts = collectNormPoints(e);
        for (var ei = 0; ei < epts.length; ei++) eraseAtPoint(epts[ei], e);
      }
    });
    annoCanvas.addEventListener("pointerup", function (e) {
      if (!canAnnotateLocal()) return;
      if (!annoGuard || !annoGuard.owns(e)) return;
      e.preventDefault();
      if (toolMode === "draw" && activeStroke) {
        finishActiveDraw();
      } else if (toolMode === "rope" && activeRope && (ropeDragging || ropeLatchDragging || ropeMoveDragging)) {
        finishActiveRopeDrag();
      } else if (toolMode === "eraser") {
        eraserActive = false;
        eraserDeletedIds = null;
      }
      annoGuard.release(e);
      try {
        annoCanvas.releasePointerCapture(e.pointerId);
      } catch (_e) {}
      releaseLocalFloor(); // gesture ended → free the peer immediately
    });
    // iOS system gestures can abort a touch mid-stroke (pointercancel) or
    // strip capture without a matching up (lostpointercapture). Both
    // finalize the in-flight gesture so neither side is left with an
    // orphan stroke, a stuck rope drag, or a permanently-claimed pointer.
    // A normal pointerup also fires lostpointercapture — by then the
    // guard has released, so this is a no-op on the happy path.
    function handlePointerAbort(e) {
      if (!annoGuard || !annoGuard.owns(e)) return;
      try {
        e.preventDefault();
      } catch (_e) {}
      finalizeActiveGesture();
      if (toolMode === "eraser") {
        eraserActive = false;
        eraserDeletedIds = null;
      }
      annoGuard.release(e);
      try {
        annoCanvas.releasePointerCapture(e.pointerId);
      } catch (_e) {}
      releaseLocalFloor(); // abort is a gesture-end path → free the peer
    }
    annoCanvas.addEventListener("pointercancel", handlePointerAbort);
    annoCanvas.addEventListener("lostpointercapture", handlePointerAbort);
    annoCanvas.addEventListener("pointerleave", function () {
      if (!canAnnotateLocal()) return;
      if (toolMode === "pointer") session.sendPointer(currentViewKey, null, null);
    });

    // WebKit gesture defenses: while Draw or Focus Rope is active, swallow
    // the raw touch sequence at the canvas (non-passive on purpose) so
    // Safari cannot run its long-press / magnifier / text-interaction
    // recognizers alongside the pointer stream. Pointer events are not
    // synthesized from touch, so drawing is unaffected. Scoped to the
    // canvas — never to inputs or the manual paste field.
    function blockTouchDuringGesture(e) {
      if (toolMode !== "draw" && toolMode !== "rope" && toolMode !== "eraser") return;
      try {
        e.preventDefault();
      } catch (_e) {}
    }
    try {
      var nonPassive = { passive: false };
      annoCanvas.addEventListener("touchstart", blockTouchDuringGesture, nonPassive);
      annoCanvas.addEventListener("touchmove", blockTouchDuringGesture, nonPassive);
      annoCanvas.addEventListener("touchend", blockTouchDuringGesture, nonPassive);
      annoCanvas.addEventListener("touchcancel", blockTouchDuringGesture, nonPassive);
    } catch (_e) {}
  }

  // Stage-scoped selection/menu defenses: the annotation stage is a
  // drawing surface, not a document — context menus, text selection, and
  // drag-start inside it fight the gesture recognizers on WebKit. Scoped
  // to the letterbox wrap only (the panel and its inputs live outside).
  if (letterboxWrap) {
    var killStageEvent = function (e) {
      // 2.0.2: only while an annotation tool is active — the stage must
      // behave like a normal viewer surface the rest of the time.
      if (!annotationToolActive()) return;
      try {
        e.preventDefault();
      } catch (_e) {}
      return false;
    };
    letterboxWrap.addEventListener("contextmenu", killStageEvent);
    letterboxWrap.addEventListener("selectstart", killStageEvent);
    letterboxWrap.addEventListener("dragstart", killStageEvent);
  }

  // Toolbar buttons (shown to both roles).
  if (annoToolbar) {
    annoToolbar.addEventListener("click", function (e) {
      var btn = e.target && e.target.closest ? e.target.closest(".anno-tool-btn") : null;
      if (!btn) return;
      var t = btn.getAttribute("data-tool");
      if (t === "pointer" || t === "draw" || t === "rope" || t === "eraser") {
        setToolMode(t);
        return;
      }
      if (btn === clearBtn) {
        handleClearLocallyAndBroadcast();
        return;
      }
      if (btn.id === "anno-exit-btn") {
        handleClearLocallyAndBroadcast();
        setToolMode("none");
        try {
          var st = session.getState();
          if ((st.role === "agent" || st.role === "visitor") && st.isConnected) {
            session.sendNavLock(currentViewKey, false);
          }
        } catch (_e) {}
        return;
      }
    });
  }

  // Annotation-unavailable surface for the fail-closed state: the gesture
  // tools are visibly disabled (setToolMode refuses them regardless), so
  // a broken assembly degrades to an obvious, honest "drawing is off"
  // rather than a quietly unsafe canvas. Pointer + Clear stay usable.
  if (!ANNO_INPUT_OK) {
    var annoDisabledIds = ["anno-draw-btn", "anno-rope-btn"];
    for (var adi = 0; adi < annoDisabledIds.length; adi++) {
      var adBtn = document.getElementById(annoDisabledIds[adi]);
      if (adBtn) {
        adBtn.disabled = true;
        adBtn.setAttribute("title", "Annotation drawing unavailable in this session");
      }
    }
  }

  // Stroke color picker (whitelist-guarded).
  var annoColorSelect = document.getElementById("anno-color-select");
  var annoColorSwatch = document.getElementById("anno-color-swatch");
  if (annoColorSelect) {
    annoColorSelect.value = ANNO_STROKE_COLOR;
    annoColorSelect.addEventListener("change", function () {
      var v = String(annoColorSelect.value || "").toLowerCase();
      if (!ANNO_COLOR_WHITELIST[v]) {
        annoColorSelect.value = ANNO_STROKE_COLOR;
        return;
      }
      ANNO_STROKE_COLOR = v;
      if (annoColorSwatch) annoColorSwatch.style.background = v;
      if (activeRope) {
        activeRope.color = v;
        scheduleRopeFlush();
        redrawAllStrokes();
      }
    });
  }

  // Focus Rope shape picker (whitelist-guarded).
  var annoShapeSelect = document.getElementById("anno-shape-select");
  if (annoShapeSelect) {
    annoShapeSelect.value = ANNO_ROPE_SHAPE;
    annoShapeSelect.addEventListener("change", function () {
      var v = String(annoShapeSelect.value || "").toLowerCase();
      if (!ANNO_ROPE_SHAPE_WHITELIST[v]) {
        annoShapeSelect.value = ANNO_ROPE_SHAPE;
        return;
      }
      ANNO_ROPE_SHAPE = v;
      if (activeRope) {
        activeRope.shape = v;
        ropeRegenerate(activeRope);
        scheduleRopeFlush();
        redrawAllStrokes();
      }
    });
  }

  // Hotkeys — fire for whichever role is connected, unless typing.
  document.addEventListener("keydown", function (e) {
    var s = session.getState();
    if ((s.role !== "agent" && s.role !== "visitor") || !s.isConnected) return;
    var tgt = e.target;
    if (tgt && (tgt.tagName === "INPUT" || tgt.tagName === "TEXTAREA" || tgt.isContentEditable)) return;
    var k = (e.key || "").toLowerCase();
    if (k === "p") {
      setToolMode("pointer");
      e.preventDefault();
    } else if (k === "d") {
      setToolMode("draw");
      e.preventDefault();
    } else if (k === "r") {
      setToolMode("rope");
      e.preventDefault();
    } else if (k === "e") {
      setToolMode("eraser");
      e.preventDefault();
    } else if (k === "c") {
      handleClearLocallyAndBroadcast();
      e.preventDefault();
    } else if (e.key === "Escape") {
      setToolMode("none");
      e.preventDefault();
    }
  });

  if (typeof ResizeObserver === "function" && letterboxWrap) {
    try {
      var ro = new ResizeObserver(function () {
        scheduleCanvasResize();
      });
      ro.observe(letterboxWrap);
    } catch (_e) {
      window.addEventListener("resize", scheduleCanvasResize);
    }
  } else if (letterboxWrap) {
    window.addEventListener("resize", scheduleCanvasResize);
  }
  // visualViewport + orientation: geometry changes the ResizeObserver /
  // window-resize paths can miss on mobile (iOS URL-bar collapse,
  // rotation, keyboard). All triggers coalesce through one rAF in
  // scheduleCanvasResize and no-op until the canvas is lazily allocated.
  if (typeof annoBindViewportEvents === "function") {
    annoBindViewportEvents(window, scheduleCanvasResize);
  }

  // ── Location sync (clipboard auto-share, both roles) ─────────────────
  var LOC_SYNC_POLL_THROTTLE_MS = 800;
  var LOC_SYNC_SUCCESS_RESET_MS = 1800;
  var LOC_SYNC_TIPS_HIDE_DELAY_MS = 250;
  var SYNC_SUPPRESS_MS = 500;
  var locSyncLastPollTs = 0;
  var lastReadClipText = "";
  var lastSentLocationKey = "";
  var lastSentLocationTs = 0;
  var lastOwnSendTs = 0;
  var syncResetTimer = null;
  var tipsTimer = null;

  var LOC_SYNC_LABELS = {
    idle: "Sync ready",
    syncing: "Syncing…",
    success: "Synced",
    waiting: "Connecting…",
  };

  // Whether ANY ambient (non-manual) clipboard read may run right now.
  // Layered, all fail-closed:
  //   - missing anno-input module → cannot verify the platform → never;
  //   - iOS/iPadOS WebKit → never (native Paste callout, the root cause
  //     of the annotation-interruption bug);
  //   - any annotation tool active (Draw / Focus Rope / Pointer) → never,
  //     on EVERY platform — a clipboard prompt mid-gesture is exactly the
  //     interruption this exists to prevent.
  // The manual paste field bypasses this on purpose: it reads its own
  // input value, never the clipboard API.
  function annotationToolActive() {
    return toolMode === "draw" || toolMode === "rope" || toolMode === "pointer";
  }
  function ambientClipboardAllowed() {
    if (!ANNO_INPUT_OK) return false;
    if (IS_IOS_WEBKIT) return false;
    if (annotationToolActive()) return false;
    return true;
  }

  // Desktop clipboard-read permission, tracked WITHOUT calling readText()
  // — probing via read is exactly what raises the Paste callout / prompt.
  // "unknown" (Permissions API absent or query unsupported) keeps the
  // mouse pointerenter fast-path OFF; focus/visibility ambient reads keep
  // their legacy desktop behavior behind ambientClipboardAllowed().
  var clipPermissionState = "unknown";
  (function trackClipboardPermission() {
    if (IS_IOS_WEBKIT) return;
    try {
      if (navigator && navigator.permissions && typeof navigator.permissions.query === "function") {
        var q = navigator.permissions.query({ name: "clipboard-read" });
        if (q && typeof q.then === "function") {
          q.then(
            function (st) {
              if (!st || typeof st.state !== "string") return;
              clipPermissionState = st.state;
              try {
                st.onchange = function () {
                  clipPermissionState = st.state;
                };
              } catch (_e) {}
            },
            function () {
              // query rejected (name unsupported) — stay "unknown"
            },
          );
        }
      }
    } catch (_e) {}
  })();

  function showTips() {
    if (!tipsEl) return;
    if (tipsTimer) {
      try {
        clearTimeout(tipsTimer);
      } catch (_e) {}
      tipsTimer = null;
    }
    tipsEl.hidden = false;
  }
  function scheduleHideTips() {
    if (!tipsEl) return;
    if (tipsTimer) {
      try {
        clearTimeout(tipsTimer);
      } catch (_e) {}
    }
    tipsTimer = setTimeout(function () {
      if (tipsEl) tipsEl.hidden = true;
      tipsTimer = null;
    }, LOC_SYNC_TIPS_HIDE_DELAY_MS);
  }
  function hideTips() {
    if (tipsEl) tipsEl.hidden = true;
    if (tipsTimer) {
      try {
        clearTimeout(tipsTimer);
      } catch (_e) {}
      tipsTimer = null;
    }
  }

  function setPulseState(name) {
    if (!syncBtn) return;
    var state = LOC_SYNC_LABELS[name] ? name : "idle";
    syncBtn.setAttribute("data-state", state);
    if (syncLabelEl) syncLabelEl.textContent = LOC_SYNC_LABELS[state];
    if (syncResetTimer) {
      try {
        clearTimeout(syncResetTimer);
      } catch (_e) {}
      syncResetTimer = null;
    }
  }
  function scheduleSyncIdleReset() {
    if (syncResetTimer) {
      try {
        clearTimeout(syncResetTimer);
      } catch (_e) {}
    }
    syncResetTimer = setTimeout(function () {
      var cur = syncBtn ? syncBtn.getAttribute("data-state") : "idle";
      if (cur === "success") setPulseState("idle");
    }, LOC_SYNC_SUCCESS_RESET_MS);
  }
  function resetLocationSyncUi() {
    locSyncLastPollTs = 0;
    lastReadClipText = "";
    lastSentLocationKey = "";
    lastSentLocationTs = 0;
    lastOwnSendTs = 0;
    hideTips();
    setPulseState("waiting");
  }

  function parseMatterportLocationUrl(text) {
    if (!text || typeof text !== "string") return null;
    var trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > 2000) return null;
    var u;
    try {
      u = new URL(trimmed);
    } catch (_e) {
      return null;
    }
    if (!/(^|\.)matterport\.com$/i.test(u.hostname || "")) return null;
    var ss = u.searchParams.get("ss");
    var sr = u.searchParams.get("sr") || "";
    if (!ss || !/^\d+$/.test(ss)) return null;
    if (sr && !/^-?\d*\.?\d+,-?\d*\.?\d+$/.test(sr)) return null;
    return { ss: ss, sr: sr };
  }

  function attemptSendLocation(parsed) {
    if (!parsed) return false;
    var key = parsed.ss + "|" + parsed.sr;
    var now = Date.now();
    if (currentViewKey && key === currentViewKey) {
      setPulseState("success");
      scheduleSyncIdleReset();
      return true;
    }
    if (key === lastSentLocationKey && now - lastSentLocationTs < 5000) {
      setPulseState("success");
      scheduleSyncIdleReset();
      return true;
    }
    var ok = false;
    var role = session.getState().role;
    try {
      if (role === "visitor") ok = session.shareLocationWithAgent(parsed.ss, parsed.sr);
      else if (role === "agent") ok = session.teleportVisitor(parsed.ss, parsed.sr);
    } catch (_e) {
      ok = false;
    }
    if (ok) {
      lastSentLocationKey = key;
      lastSentLocationTs = now;
      lastOwnSendTs = now;
      setPulseState("success");
      scheduleSyncIdleReset();
      return true;
    }
    setPulseState("idle");
    return false;
  }

  // ── Voice status (mic capability + live connection) ──────────────────
  function setVoiceStatus(label, kind) {
    if (!voiceStatus) return;
    voiceStatus.textContent = label;
    voiceStatus.setAttribute("data-voice", kind || "off");
  }

  // Report microphone availability WITHOUT prompting: a capability check
  // plus a (best-effort) Permissions API query. The controller does the
  // real getUserMedia and falls back to a silent track, so this is purely
  // to set expectations ("blocked" / "unavailable" / "ready").
  function reportVoiceCapability() {
    if (!voiceStatus) return;
    if (IS_IOS_WEBKIT) {
      // Deferred voice: nothing was requested at connect by design — the
      // microphone activates only from the Enable voice tap (a direct
      // user gesture, as WebKit prefers).
      setVoiceStatus("Voice is off — tap Enable voice to talk.", "warn");
      return;
    }
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      setVoiceStatus("Microphone unavailable here — you can still tour together silently.", "warn");
      return;
    }
    var queried = false;
    try {
      if (navigator.permissions && typeof navigator.permissions.query === "function") {
        var q = navigator.permissions.query({ name: "microphone" });
        if (q && typeof q.then === "function") {
          queried = true;
          q.then(
            function (st) {
              if (st && st.state === "denied") {
                setVoiceStatus("Microphone blocked — others cannot hear you. Allow mic access to talk.", "warn");
              } else {
                setVoiceStatus("Microphone ready — connecting voice…", "ok");
              }
            },
            function () {
              setVoiceStatus("Microphone ready — connecting voice…", "ok");
            },
          );
        }
      }
    } catch (_e) {
      queried = false;
    }
    if (!queried) setVoiceStatus("Microphone ready — connecting voice…", "ok");
  }

  // ── Enable voice (deferred-voice sessions; a direct user gesture) ────
  // The P0 rule: voice startup must never ride the connect transition on
  // iOS. The tap acquires the mic, answers a held offer (host) or places
  // the call (guest). Failure leaves the data session fully intact.
  if (enableVoiceBtn) {
    enableVoiceBtn.addEventListener("click", function () {
      if (typeof session.startVoice !== "function") return;
      enableVoiceBtn.disabled = true;
      setVoiceStatus("Connecting voice…", "ok");
      session.startVoice().then(
        function (ok) {
          if (!ok) {
            enableVoiceBtn.disabled = false;
            setVoiceStatus(
              "Voice has not started yet — check mic permission, or have the other side tap Enable voice too, then retry.",
              "warn",
            );
            return;
          }
          // Success: a call is negotiating. The remote_stream state
          // change flips the status to "Voice connected" and hides this
          // button; if the call instead dies BEFORE streaming, the
          // voiceCallActive falling edge below re-enables the retry.
          voiceAttemptPending = true;
          var nowState = session.getState();
          if (nowState.voiceCallActive === false && !nowState.remoteStream) {
            // The call already died between resolution and this handler.
            voiceAttemptPending = false;
            enableVoiceBtn.disabled = false;
            setVoiceStatus("Voice did not connect — tap Enable voice to retry.", "warn");
          }
        },
        function () {
          enableVoiceBtn.disabled = false;
          setVoiceStatus("Could not start voice — you can still tour together silently.", "warn");
        },
      );
    });
  }

  function readClipboardAndSend() {
    if (!ambientClipboardAllowed()) return;
    var s = session.getState();
    if ((s.role !== "visitor" && s.role !== "agent") || !s.isConnected) return;
    if (!navigator || !navigator.clipboard || typeof navigator.clipboard.readText !== "function") return;
    var p;
    try {
      p = navigator.clipboard.readText();
    } catch (_e) {
      return;
    }
    if (!p || typeof p.then !== "function") return;
    p.then(
      function (text) {
        if (typeof text !== "string") return;
        if (text === lastReadClipText) return;
        var parsed = parseMatterportLocationUrl(text);
        if (!parsed) {
          lastReadClipText = text;
          return;
        }
        setPulseState("syncing");
        if (attemptSendLocation(parsed)) lastReadClipText = text;
      },
      function () {
        // Read rejected (denied / no focus). Stay silent; retry later.
      },
    );
  }

  function schedulePoll() {
    if (!ambientClipboardAllowed()) return;
    if (document.hidden) return;
    var s = session.getState();
    if ((s.role !== "visitor" && s.role !== "agent") || !s.isConnected) return;
    var now = Date.now();
    if (now - locSyncLastPollTs < LOC_SYNC_POLL_THROTTLE_MS) return;
    locSyncLastPollTs = now;
    readClipboardAndSend();
  }

  if (syncBtn) {
    syncBtn.addEventListener("mouseenter", showTips);
    syncBtn.addEventListener("mouseleave", scheduleHideTips);
    syncBtn.addEventListener("focus", showTips);
    syncBtn.addEventListener("blur", scheduleHideTips);
  }
  if (tipsEl) {
    tipsEl.addEventListener("mouseenter", showTips);
    tipsEl.addEventListener("mouseleave", scheduleHideTips);
  }
  window.addEventListener("focus", schedulePoll);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) schedulePoll();
  });
  if (letterboxWrap) {
    // Ambient read on stage entry: a REAL mouse only, and only when the
    // desktop clipboard-read permission is already confirmed granted via
    // the Permissions API — never as a readText() permission probe, and
    // never for touch/pen (those are annotation hands, not sync intent).
    letterboxWrap.addEventListener("pointerenter", function (e) {
      if (!e || e.pointerType !== "mouse") return;
      if (clipPermissionState !== "granted") return;
      schedulePoll();
    });
    letterboxWrap.addEventListener("pointerenter", function () {
      var st = session.getState();
      if (st.role !== "visitor" && st.role !== "agent") return;
      var ae = document.activeElement;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      if (frame) {
        try {
          frame.focus({ preventScroll: true });
        } catch (_e) {
          try {
            frame.focus();
          } catch (_e2) {}
        }
      }
    });
  }
  try {
    if (navigator && navigator.clipboard && typeof navigator.clipboard.addEventListener === "function") {
      navigator.clipboard.addEventListener("clipboardchange", schedulePoll);
    }
  } catch (_e) {}

  function preGrantClipboard() {
    // NEVER on iOS/iPadOS: this readText() probe IS the native Paste
    // callout. Also skipped when the platform detector is unavailable
    // (fail closed). Desktop keeps the session-start prompt (it runs
    // inside the Host/Join click gesture) so later ambient reads are
    // silent instead of prompting mid-tour.
    if (IS_IOS_WEBKIT || !ANNO_INPUT_OK) return;
    try {
      if (navigator && navigator.clipboard && typeof navigator.clipboard.readText === "function") {
        navigator.clipboard.readText().then(
          function () {},
          function () {},
        );
      }
    } catch (_e) {}
  }

  // ── Teleport / iframe rewrite (single iframe) ────────────────────────
  function rewriteIframeForTeleport(baseUrl, ss, sr) {
    if (!baseUrl) return baseUrl;
    var stripped = baseUrl.replace(/[?&](ss|sr|qs|play|title|brand)=[^&]*/g, function (m) {
      return m.charAt(0) === "?" ? "?" : "";
    });
    stripped = stripped.replace(/\?&/g, "?").replace(/[?&]$/, "");
    var sep = stripped.indexOf("?") === -1 ? "?" : "&";
    var qs = "ss=" + encodeURIComponent(ss);
    if (sr) qs += "&sr=" + encodeURIComponent(sr);
    qs += "&qs=1&play=1&title=0&brand=0";
    return stripped + sep + qs;
  }

  function applyTeleport(ss, sr) {
    if (!frame || !MP_BASE) return;
    currentViewKey = (ss || "") + "|" + (sr || "");
    wipeAnnotations();
    try {
      frame.src = rewriteIframeForTeleport(MP_BASE, ss, sr);
    } catch (_e) {}
  }

  // ── Tour stops (optional; Host only) ─────────────────────────────────
  function renderStops() {
    if (!stopsWrap) return;
    stopsWrap.innerHTML = "";
    if (!STOPS.length) {
      var empty = document.createElement("div");
      empty.className = "lt-stops-empty";
      empty.textContent = "No saved stops yet — press U inside the tour and copy the link to bring your guest along.";
      stopsWrap.appendChild(empty);
      return;
    }
    var connected = session.getState().isConnected;
    STOPS.forEach(function (stop) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lt-stop-btn";
      btn.textContent = stop.name || "Stop";
      btn.disabled = !connected;
      btn.addEventListener("click", function () {
        var sent = session.teleportVisitor(stop.ss, stop.sr || "");
        if (sent) {
          lastOwnSendTs = Date.now();
          applyTeleport(stop.ss, stop.sr || "");
        }
      });
      stopsWrap.appendChild(btn);
    });
  }

  // ── Invite / share-the-PIN ───────────────────────────────────────────
  function currentInviteText() {
    var pin = session.getState().pin;
    var url = shareUrl();
    var lines = ["Join my live tour of " + SHARE_TITLE + " on Frontiers3D:", url];
    if (pin) lines.push("Tour PIN: " + pin);
    return lines.join("\n");
  }
  if (inviteBtn) {
    inviteBtn.addEventListener("click", function () {
      var text = currentInviteText();
      var done = function (msg) {
        setText(inviteStatus, msg);
        setTimeout(function () {
          setText(inviteStatus, "");
        }, 2500);
      };
      if (navigator && typeof navigator.share === "function") {
        navigator
          .share({ title: SHARE_TITLE, text: text, url: shareUrl() })
          .then(
            function () {
              done("Invite shared.");
            },
            function () {
              // share cancelled / failed -> fall back to clipboard
              copyInvite(text, done);
            },
          );
        return;
      }
      copyInvite(text, done);
    });
  }
  function copyInvite(text, done) {
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).then(
        function () {
          done("Invite copied to clipboard.");
        },
        function () {
          done("Copy failed — select and copy manually.");
        },
      );
    } else {
      done("Copy unavailable in this browser.");
    }
  }

  // ── Role / panel wiring ──────────────────────────────────────────────
  if (launchBtn) {
    launchBtn.addEventListener("click", togglePanel);
  }
  if (panelClose) {
    panelClose.addEventListener("click", closePanel);
  }
  if (backLinks) {
    for (var bi = 0; bi < backLinks.length; bi++) {
      backLinks[bi].addEventListener("click", function () {
        // Only allowed before a session is live; tears nothing down.
        if (session.getState().isConnected) return;
        try {
          session.dispose();
        } catch (_e) {}
        session = newSession();
        session.subscribe(onState);
        resetUiToIdle();
      });
    }
  }

  if (guestChooseBtn) {
    guestChooseBtn.addEventListener("click", function () {
      hide(roleChoose);
      hide(hostBlock);
      show(guestBlock);
      if (pinInput) {
        try {
          pinInput.focus();
        } catch (_e) {}
      }
    });
  }

  if (hostStartBtn) {
    hostStartBtn.addEventListener("click", function () {
      hide(roleChoose);
      hide(guestBlock);
      show(hostBlock);
      hostStartBtn.disabled = true;
      setText(hostStatus, "Preparing Live Tour…");
      resetMilestoneLog();
      // Pre-grant must stay synchronous inside the click — a
      // then-callback is not a user gesture.
      preGrantClipboard();
      ensurePeerJs().then(
        function () {
          setText(hostStatus, "Reserving session…");
          session.initializeAsAgent().catch(function () {
            // surfaced via subscribe()
          });
        },
        function () {
          hostStartBtn.disabled = false;
          setText(hostStatus, "Live Tour could not load (network issue). Click Host to retry.");
        },
      );
    });
  }

  if (joinBtn && pinInput) {
    joinBtn.addEventListener("click", function () {
      var pin = (pinInput.value || "").replace(/\D/g, "").slice(0, 4);
      if (pin.length !== 4) {
        setText(guestStatus, "Enter the 4-digit PIN from your host.");
        return;
      }
      joinBtn.disabled = true;
      setText(guestStatus, "Preparing Live Tour…");
      resetMilestoneLog();
      preGrantClipboard();
      ensurePeerJs().then(
        function () {
          setText(guestStatus, "Connecting…");
          session.joinAsVisitor(pin).catch(function () {
            // surfaced via subscribe()
          });
        },
        function () {
          joinBtn.disabled = false;
          setText(guestStatus, "Live Tour could not load (network issue). Click Join to retry.");
        },
      );
    });
    pinInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        joinBtn.click();
      }
    });
    pinInput.addEventListener("input", function () {
      pinInput.value = (pinInput.value || "").replace(/\D/g, "").slice(0, 4);
    });
  }

  function teardownSession() {
    try {
      session.dispose();
    } catch (_e) {}
    if (leaveBtns) {
      for (var i = 0; i < leaveBtns.length; i++) leaveBtns[i].hidden = true;
    }
    wasConnected = false;
    setBodyLetterboxClass(false, false);
    setToolMode("none");
    wipeAnnotations();
    releaseAnnoCanvas();
    currentViewKey = "";
    lastPointerSeq = 0;
    lastStrokeSeq = 0;
    lastClearSeq = 0;
    lastNavLockSeq = 0;
    lastStrokeDeleteSeq = 0;
    // Disconnect is a gesture-end path: release any floor this side holds and
    // clear any the peer held so neither side is left frozen/locked out.
    try {
      releaseLocalFloor();
    } catch (_e) {}
    try {
      setRemoteFloor(false);
    } catch (_e) {}
    eraserActive = false;
    eraserDeletedIds = null;
    resetLocationSyncUi();
    resetUiToIdle();
    session = newSession();
    session.subscribe(onState);
  }

  if (leaveBtns) {
    for (var li = 0; li < leaveBtns.length; li++) {
      leaveBtns[li].addEventListener("click", teardownSession);
    }
  }

  // ── State subscriber ─────────────────────────────────────────────────
  function onState(state) {
    if (pinValue && state.pin) pinValue.textContent = state.pin;

    if (state.role === "agent" && hostStatus) {
      if (state.status === "initializing") setText(hostStatus, "Reserving session…");
      else if (state.status === "waiting") setText(hostStatus, "Share the PIN with your guest.");
      else if (state.status === "connected") setText(hostStatus, "Connected. Your guest is with you.");
      else if (state.status === "ended") setText(hostStatus, "Session ended.");
      else if (state.status === "error") setText(hostStatus, state.error || "Live tour is unavailable right now.");
      if (state.status === "error" && hostStartBtn) hostStartBtn.disabled = false;
      // Render stops once we have a PIN; refresh disabled state cheaply.
      if (state.pin && stopsWrap) {
        if (!stopsWrap.firstChild) renderStops();
        var sbtns = stopsWrap.querySelectorAll(".lt-stop-btn");
        for (var i = 0; i < sbtns.length; i++) sbtns[i].disabled = !state.isConnected;
      }
    }

    if (state.role === "visitor" && guestStatus) {
      if (state.status === "connecting") setText(guestStatus, "Connecting…");
      else if (state.status === "connected") setText(guestStatus, "Connected to your host.");
      else if (state.status === "ended") {
        setText(guestStatus, "Session ended.");
        if (joinBtn) joinBtn.disabled = false;
      } else if (state.status === "error") {
        setText(guestStatus, state.error || "Could not connect. Check the PIN and try again.");
        if (joinBtn) joinBtn.disabled = false;
      }
    }

    if (!wasConnected && state.isConnected && state.status === "connected") {
      wasConnected = true;
      var isHost = state.role === "agent";
      if (leaveBtns) {
        for (var l = 0; l < leaveBtns.length; l++) leaveBtns[l].hidden = false;
      }
      if (statusChip) statusChip.hidden = false;
      markMilestone("layout_started");
      // A live tour is itself an interaction that needs stable gestures —
      // ask the parent to switch off native Device fullscreen on iPad.
      emitInteractionActive();
      setBodyLetterboxClass(true, isHost);
      // No annotation-canvas allocation here (P0 iPad fix): the buffer
      // is created lazily on first Draw/Rope use or first remote stroke,
      // never inside the already-heavy connect transition.
      // Surface the live extras (voice status) and set initial voice
      // expectations.
      show(liveExtras);
      reportVoiceCapability();
      // Deferred voice (iOS): voice did not auto-start; offer the
      // explicit gesture-driven activation.
      if (IS_IOS_WEBKIT && enableVoiceBtn && !state.remoteStream) {
        show(enableVoiceBtn);
      }
      // Guest: collapse the panel so the tour fills the screen. Host keeps
      // the panel so they can use stops / invite. Both can reopen via the
      // Explore Together button.
      if (!isHost) closePanel();
    }
    setHudButtonState(state);

    if (wasConnected && (state.status === "ended" || state.status === "error")) {
      setTimeout(teardownSession, 0);
    }

    // Voice attach.
    if (audioEl) {
      try {
        if (state.remoteStream && audioEl.srcObject !== state.remoteStream) {
          audioEl.srcObject = state.remoteStream;
          var pp = audioEl.play();
          if (pp && typeof pp.then === "function") {
            pp.then(
              function () {
                markMilestone("audio_playing");
              },
              function () {},
            );
          }
        } else if (!state.remoteStream && audioEl.srcObject) {
          audioEl.srcObject = null;
        }
      } catch (_e) {}
    }

    // Voice connection reflection: a remoteStream means the peer audio path
    // is up (the controller falls back to a silent track when the local mic
    // is blocked, so this fires for both sides regardless of mic state).
    if (state.remoteStream && !voiceConnected) {
      voiceConnected = true;
      voiceAttemptPending = false;
      setVoiceStatus("Voice connected — you can talk now.", "live");
      if (enableVoiceBtn) {
        enableVoiceBtn.hidden = true;
        enableVoiceBtn.disabled = false;
      }
    } else if (!state.remoteStream && voiceConnected) {
      voiceConnected = false;
      if (state.isConnected) {
        reportVoiceCapability();
        // The established voice path dropped: re-offer the explicit
        // restart on deferred-voice sessions (the button was hidden on
        // connect, and the status above tells the user to tap it).
        if (IS_IOS_WEBKIT && enableVoiceBtn) {
          enableVoiceBtn.hidden = false;
          enableVoiceBtn.disabled = false;
        }
      }
    }

    // P2 (PR #149 review): a media call that dies BEFORE producing a
    // remote stream (negotiation failure, peer disconnect) must hand the
    // Enable voice control back — without this, the only recovery was
    // leaving and rejoining the data session. Strict `=== false` so
    // controllers that predate voiceCallActive never trigger it.
    if (
      voiceAttemptPending &&
      !state.remoteStream &&
      state.voiceCallActive === false &&
      !voiceConnected
    ) {
      voiceAttemptPending = false;
      if (enableVoiceBtn && state.isConnected) {
        enableVoiceBtn.hidden = false;
        enableVoiceBtn.disabled = false;
        setVoiceStatus("Voice did not connect — tap Enable voice to retry.", "warn");
      }
    }

    // Guest follows host teleports (dedupe by ts; last-sender-wins).
    if (state.role === "visitor" && state.incomingTeleportEvent && state.incomingTeleportEvent.ts !== lastTeleportTs) {
      lastTeleportTs = state.incomingTeleportEvent.ts;
      if (lastOwnSendTs === 0 || Date.now() - lastOwnSendTs >= SYNC_SUPPRESS_MS) {
        applyTeleport(state.incomingTeleportEvent.ss, state.incomingTeleportEvent.sr);
        lastSentLocationKey = state.incomingTeleportEvent.ss + "|" + state.incomingTeleportEvent.sr;
        lastSentLocationTs = Date.now();
      }
    }

    // Host auto-follows guest location shares (dedupe by ts).
    if (state.role === "agent" && state.incomingLocationShareEvent && state.incomingLocationShareEvent.ts !== lastShareTs) {
      lastShareTs = state.incomingLocationShareEvent.ts;
      if (lastOwnSendTs === 0 || Date.now() - lastOwnSendTs >= SYNC_SUPPRESS_MS) {
        applyTeleport(state.incomingLocationShareEvent.ss, state.incomingLocationShareEvent.sr);
        lastSentLocationKey = state.incomingLocationShareEvent.ss + "|" + state.incomingLocationShareEvent.sr;
        lastSentLocationTs = Date.now();
        if (letterboxWrap) {
          try {
            letterboxWrap.classList.add("follow-pulse");
            setTimeout(function () {
              if (letterboxWrap) letterboxWrap.classList.remove("follow-pulse");
            }, 1500);
          } catch (_e) {}
        }
      }
    }

    // Pulse pill connection reflection.
    if ((state.role === "visitor" || state.role === "agent") && syncBtn) {
      var curState = syncBtn.getAttribute("data-state");
      if (!state.isConnected) {
        if (curState !== "syncing") setPulseState("waiting");
      } else if (curState === "waiting") {
        setPulseState("idle");
      }
    }

    // Annotation receive paths.
    var canReceive = state.role === "agent" || state.role === "visitor";
    var pev = state.incomingPointerEvent;
    if (pev && pev.seq !== lastPointerSeq) {
      lastPointerSeq = pev.seq;
      if (canReceive && remotePointer && letterboxWrap) {
        if (pev.x == null || pev.y == null) {
          remotePointer.style.display = "none";
          if (remotePointerHideTimer) {
            try {
              clearTimeout(remotePointerHideTimer);
            } catch (_e) {}
            remotePointerHideTimer = null;
          }
        } else {
          var rect = letterboxWrap.getBoundingClientRect();
          remotePointer.style.left = pev.x * rect.width + "px";
          remotePointer.style.top = pev.y * rect.height + "px";
          remotePointer.style.display = "block";
          if (remotePointerHideTimer) {
            try {
              clearTimeout(remotePointerHideTimer);
            } catch (_e) {}
          }
          remotePointerHideTimer = setTimeout(function () {
            if (remotePointer) remotePointer.style.display = "none";
          }, ANNO_REMOTE_POINTER_TIMEOUT_MS);
        }
      }
    }

    var sev = state.incomingStrokeEvent;
    if (sev && sev.seq !== lastStrokeSeq) {
      lastStrokeSeq = sev.seq;
      if (canReceive) {
        // A remote annotation is the other lazy-allocation trigger.
        ensureAnnoCanvasAllocated();
        if (sev.kind === "begin") {
          var existingBegin = findLocalStroke(sev.strokeId);
          if (existingBegin) {
            if (sev.points) existingBegin.points = sev.points.slice();
            if (typeof sev.color === "string") existingBegin.color = sev.color;
            if (typeof sev.width === "number") existingBegin.width = sev.width;
          } else {
            localStrokes.push({
              strokeId: sev.strokeId,
              color: sev.color || ANNO_STROKE_COLOR,
              width: typeof sev.width === "number" ? sev.width : ANNO_STROKE_WIDTH,
              points: sev.points ? sev.points.slice() : [],
            });
          }
          redrawAllStrokes();
        } else if (sev.kind === "patch") {
          var existing = findLocalStroke(sev.strokeId);
          if (existing && sev.points) {
            for (var pi = 0; pi < sev.points.length; pi++) existing.points.push(sev.points[pi]);
            redrawAllStrokes();
          }
        } else if (sev.kind === "commit") {
          // Commit seals the stroke: mark it erasable. Until now it was an
          // in-flight remote stroke and the eraser deliberately skipped it.
          var committedRemote = findLocalStroke(sev.strokeId);
          if (committedRemote) committedRemote.committed = true;
        }
        // Ongoing remote stroke activity refreshes the floor safety timer so
        // a long remote gesture keeps this side paused until it actually ends.
        if (sev.kind === "begin" || sev.kind === "patch") refreshRemoteFloor();
      }
    }

    var cev = state.incomingClearEvent;
    if (cev && cev.seq !== lastClearSeq) {
      lastClearSeq = cev.seq;
      if (canReceive) {
        wipeAnnotations();
        setRemoteFloor(false);
      }
    }

    var nlev = state.incomingNavLockEvent;
    if (nlev && nlev.seq !== lastNavLockSeq) {
      lastNavLockSeq = nlev.seq;
      // nav_lock IS the shared annotation floor: freeze this side's Matterport
      // AND block new local gesture starts for its duration. setRemoteFloor
      // arms a bounded safety timeout so a crashed peer can't lock us out.
      if (canReceive) setRemoteFloor(nlev.locked === true);
    }

    var dev = state.incomingStrokeDeleteEvent;
    if (dev && dev.seq !== lastStrokeDeleteSeq) {
      lastStrokeDeleteSeq = dev.seq;
      // Idempotent erase: drop any matching ids; unknown / already-removed
      // ids change nothing (no redraw), so duplicate/stale deletes are safe.
      if (canReceive && dev.strokeIds && dev.strokeIds.length) {
        var beforeLen = localStrokes.length;
        localStrokes = localStrokes.filter(function (s) {
          return dev.strokeIds.indexOf(s.strokeId) < 0;
        });
        if (localStrokes.length !== beforeLen) redrawAllStrokes();
      }
    }
  }

  // Tint the accent-driven affordances created at runtime.
  try {
    if (ACCENT && remotePointer) remotePointer.style.background = ACCENT;
  } catch (_e) {}

  session.subscribe(onState);
})();
