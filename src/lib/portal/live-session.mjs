// Live Guided Tour P2P controller. Loaded into the exported HTML
// runtime. Wraps the global `Peer` constructor (PeerJS UMD bundle,
// loaded via CDN <script> tag) to drive a single Agent <-> Visitor
// session: a reliable WebRTC DataChannel for teleport + annotation
// packets and a MediaConnection for two-way voice.
//
// Wire format (DataChannel JSON, all packets share the channel):
//   { type: "teleport", ss, sr }
//   { type: "pointer", viewKey, seq, x, y, ts }
//   { type: "stroke_begin", viewKey, seq, strokeId, color, width, points, ts }
//   { type: "stroke_patch", viewKey, seq, strokeId, points, ts }
//   { type: "stroke_commit", viewKey, seq, strokeId, ts }
//   { type: "clear", viewKey, seq, ts }
//
// `viewKey` is derived from the most recent teleport (ss + "|" + sr)
// on both ends; receivers drop annotation packets whose viewKey
// differs from their current one — kills late-arriving frames from a
// previous Matterport sweep. `seq` is a single monotonic counter per
// sender; receivers drop any packet with seq <= last seen. Pointer
// sends are coalesced through a frame-rate scheduler (rAF in the
// browser) and are additionally guarded by dataConn.bufferedAmount so
// the channel never backs up under a flood of mousemove events.
//
// Same constraints as the other .mjs runtime modules in this folder:
// no imports, no TypeScript syntax, no single-quote string literals,
// ES5-ish style (var, function). The single trailing `export { ... }`
// block is stripped at injection time so this source can be inlined
// verbatim into the outer IIFE of the generated HTML.

var LIVE_SESSION_AGENT_PREFIX = "TourAgent-";
var LIVE_SESSION_VISITOR_PREFIX = "TourGuest-";

// 4-digit numeric PIN, zero-padded so a leading-zero PIN like 0123
// stays 4 chars wide on the wire and on screen.
function _generatePin() {
  var n = Math.floor(Math.random() * 10000);
  var s = String(n);
  while (s.length < 4) s = "0" + s;
  return s;
}

function _generateVisitorSuffix() {
  // 8-char base36 random tail. Collision chance is negligible for the
  // ephemeral lifetime of a single tour session.
  return Math.random().toString(36).slice(2, 10) || "anon";
}

function _isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function _coerceString(v) {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

// Acquire the local microphone with consistent audio constraints.
// Resolves to `null` (never rejects) if the user declines, the API is
// unavailable, or the page is not in a secure context — callers fall
// back to a silent track so PeerJS still establishes the audio path.
function _getMicStream() {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    !navigator.mediaDevices.getUserMedia
  ) {
    return Promise.resolve(null);
  }
  return navigator.mediaDevices
    .getUserMedia({ audio: true, video: false })
    .then(function (stream) {
      return stream;
    })
    .catch(function () {
      return null;
    });
}

// Some browsers reject `peer.call(id)` without a real MediaStream.
// Build a single silent audio track via the WebAudio API as a graceful
// fallback when the mic is unavailable. Returns `null` if even that
// fails (e.g. WebAudio blocked) — callers must tolerate a null stream.
function _silentTrackStream() {
  try {
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    var ctx = new Ctor();
    var dst = ctx.createMediaStreamDestination();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(dst);
    osc.start();
    return dst.stream;
  } catch (e) {
    return null;
  }
}

// Best-effort console logger gated by `debug` option. Never throws.
function _makeLogger(debug) {
  return function () {
    if (!debug) return;
    try {
      var args = ["[live-session]"];
      for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
      if (typeof console !== "undefined" && console.log) {
        console.log.apply(console, args);
      }
    } catch (e) {
      // swallow — logging must never break the tour
    }
  };
}

// Drop a pointer send when the DataChannel has more than this many
// bytes already queued. 64 KiB is well below the SCTP send buffer cap
// in every browser PeerJS supports — staying under it keeps latency
// low enough for live cursor tracking. Stroke packets ignore this
// guard so we never lose ink.
var LIVE_SESSION_POINTER_BACKPRESSURE_BYTES = 65536;

// Factory for a single live-session controller. Each call returns an
// independent state machine; the page is expected to keep at most one
// alive at a time.
//
// options:
//   debug: boolean — verbose console output for development
//   pinAttempts: number — how many random PINs to try if the broker
//     reports the id is taken (default 5)
//   PeerCtor: function — dependency injection seam used by tests; in
//     the browser we read `window.Peer` if not provided.
//   schedule: function(cb) — frame scheduler for the pointer
//     coalescer. Defaults to `requestAnimationFrame` in the browser,
//     `setTimeout(cb, 16)` otherwise. Tests pass a manual scheduler
//     to drive coalescing deterministically.
function createLiveSession(options) {
  var opts = options || {};
  var log = _makeLogger(!!opts.debug);
  var pinAttempts = typeof opts.pinAttempts === "number" ? opts.pinAttempts : 5;
  var PeerCtor =
    typeof opts.PeerCtor === "function"
      ? opts.PeerCtor
      : typeof Peer === "function"
        ? Peer
        : null;
  var scheduler =
    typeof opts.schedule === "function"
      ? opts.schedule
      : typeof requestAnimationFrame === "function"
        ? function (cb) {
            requestAnimationFrame(cb);
          }
        : function (cb) {
            setTimeout(cb, 16);
          };

  var state = {
    role: null,
    status: "idle",
    pin: null,
    peerId: null,
    error: null,
    isConnected: false,
    remoteStream: null,
    incomingTeleportEvent: null,
    incomingPointerEvent: null,
    incomingStrokeEvent: null,
    incomingClearEvent: null,
    incomingNavLockEvent: null,
    incomingLocationShareEvent: null,
  };

  var listeners = [];
  var peer = null;
  var dataConn = null;
  var mediaCall = null;
  var localMicStream = null;
  var disposed = false;

  // Annotation channel bookkeeping. _sendSeq is the agent's monotonic
  // counter stamped on every outbound annotation packet. _lastRecvSeq
  // is the receiver's watermark — any packet whose seq doesn't exceed
  // it is dropped (out-of-order arrival under a reliable channel
  // shouldn't happen, but we guard so a buggy peer can't replay).
  // _currentViewKey is updated automatically from teleport packets on
  // both ends; annotation packets whose viewKey diverges are dropped
  // so late frames from a stale Matterport sweep don't leak through.
  var _sendSeq = 0;
  var _lastRecvSeq = 0;
  var _currentViewKey = "";

  // Pointer coalescer. The runtime can call sendPointer many times
  // per frame (mousemove fires at the input device's poll rate); we
  // only flush the latest position on the next scheduler tick.
  var _pendingPointer = null;
  var _flushScheduled = false;

  function _patch(next) {
    var merged = {};
    for (var k in state) {
      if (Object.prototype.hasOwnProperty.call(state, k)) merged[k] = state[k];
    }
    for (var p in next) {
      if (Object.prototype.hasOwnProperty.call(next, p)) merged[p] = next[p];
    }
    state = merged;
    _emit();
  }

  function _emit() {
    var snapshot = state;
    for (var i = 0; i < listeners.length; i++) {
      try {
        listeners[i](snapshot);
      } catch (e) {
        log("listener threw", e);
      }
    }
  }

  function getState() {
    return state;
  }

  function subscribe(fn) {
    if (typeof fn !== "function") {
      return function () {};
    }
    listeners.push(fn);
    try {
      fn(state);
    } catch (e) {
      log("initial subscribe fire threw", e);
    }
    return function () {
      var idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  function _ensurePeerCtor() {
    if (typeof PeerCtor === "function") return true;
    var late =
      typeof Peer === "function"
        ? Peer
        : typeof window !== "undefined" && typeof window.Peer === "function"
          ? window.Peer
          : null;
    if (typeof late === "function") {
      PeerCtor = late;
      return true;
    }
    _patch({
      status: "error",
      error: "PeerJS isn't loaded yet. Check your network connection.",
    });
    return false;
  }

  // ── Agent ──────────────────────────────────────────────────────────
  function initializeAsAgent() {
    if (disposed) return Promise.reject(new Error("session disposed"));
    if (!_ensurePeerCtor()) {
      return Promise.reject(new Error(state.error || "peer-unavailable"));
    }
    if (peer && state.role === "agent") {
      return Promise.resolve({ pin: state.pin, peerId: state.peerId });
    }
    _patch({ role: "agent", status: "initializing", error: null });
    return _claimAgentPin(0);
  }

  function _claimAgentPin(attempt) {
    if (attempt >= pinAttempts) {
      var msg = "Could not reserve a session PIN. Please try again.";
      _patch({ status: "error", error: msg });
      return Promise.reject(new Error(msg));
    }
    var pin = _generatePin();
    var id = LIVE_SESSION_AGENT_PREFIX + pin;
    return new Promise(function (resolve, reject) {
      var p;
      try {
        p = new PeerCtor(id);
      } catch (e) {
        reject(e);
        return;
      }

      var settled = false;

      function _onOpen() {
        if (settled) return;
        settled = true;
        peer = p;
        _wireAgentPeer();
        _patch({ pin: pin, peerId: id, status: "waiting" });
        resolve({ pin: pin, peerId: id });
      }

      function _onError(err) {
        if (settled) return;
        var t = err && err.type ? err.type : (err && err.message) || "unknown";
        log("agent peer error", t);
        try {
          p.destroy();
        } catch (e) {
          // ignore — we're tearing down regardless
        }
        if (t === "unavailable-id") {
          settled = true;
          _claimAgentPin(attempt + 1).then(resolve, reject);
          return;
        }
        settled = true;
        _patch({
          status: "error",
          error: "Couldn't connect to the live-tour signaling service.",
        });
        reject(err instanceof Error ? err : new Error(t));
      }

      p.on("open", _onOpen);
      p.on("error", _onError);
    });
  }

  function _wireAgentPeer() {
    if (!peer) return;
    peer.on("connection", function (conn) {
      _attachDataConnection(conn);
    });
    peer.on("call", function (call) {
      _answerIncomingCall(call);
    });
    peer.on("disconnected", function () {
      log("peer disconnected from broker");
    });
    peer.on("close", function () {
      _patch({ status: "ended", isConnected: false });
    });
    peer.on("error", function (err) {
      var t = (err && err.type) || (err && err.message) || "peer-error";
      log("peer error", t);
      _patch({ error: t });
    });
  }

  function _attachDataConnection(conn) {
    dataConn = conn;
    conn.on("open", function () {
      _patch({ status: "connected", isConnected: true });
    });
    conn.on("data", function (data) {
      _handleIncomingData(data);
    });
    conn.on("close", function () {
      if (dataConn === conn) {
        dataConn = null;
        _patch({ isConnected: false, status: "ended" });
      }
    });
    conn.on("error", function (err) {
      var t = (err && err.type) || (err && err.message) || "data-error";
      log("data conn error", t);
      _patch({ error: t });
    });
  }

  function _answerIncomingCall(call) {
    _getMicStream().then(function (stream) {
      localMicStream = stream || _silentTrackStream();
      try {
        if (localMicStream) call.answer(localMicStream);
        else call.answer();
      } catch (e) {
        log("call.answer failed", e);
      }
      mediaCall = call;
      call.on("stream", function (remoteStream) {
        _patch({ remoteStream: remoteStream });
      });
      call.on("close", function () {
        if (mediaCall === call) {
          mediaCall = null;
          _patch({ remoteStream: null });
        }
      });
      call.on("error", function (err) {
        var t = (err && err.type) || (err && err.message) || "call-error";
        log("call error", t);
        _patch({ error: t });
      });
    });
  }

  // ── Visitor ────────────────────────────────────────────────────────
  function joinAsVisitor(pinInput) {
    if (disposed) return Promise.reject(new Error("session disposed"));
    if (!_ensurePeerCtor()) {
      return Promise.reject(new Error(state.error || "peer-unavailable"));
    }
    var clean = _coerceString(pinInput).replace(/\D/g, "").slice(0, 4);
    if (clean.length !== 4) {
      var msg = "Enter the 4-digit PIN from your agent.";
      _patch({ status: "error", error: msg });
      return Promise.reject(new Error(msg));
    }
    if (peer && state.role === "visitor") {
      return Promise.resolve({ pin: state.pin, peerId: state.peerId });
    }
    var visitorId = LIVE_SESSION_VISITOR_PREFIX + _generateVisitorSuffix();
    var agentId = LIVE_SESSION_AGENT_PREFIX + clean;
    _patch({
      role: "visitor",
      status: "connecting",
      pin: clean,
      peerId: visitorId,
      error: null,
    });
    return new Promise(function (resolve, reject) {
      var p;
      try {
        p = new PeerCtor(visitorId);
      } catch (e) {
        reject(e);
        return;
      }
      peer = p;
      var settled = false;

      p.on("open", function () {
        var conn = p.connect(agentId, { reliable: true });
        _attachDataConnection(conn);
        _getMicStream().then(function (stream) {
          localMicStream = stream || _silentTrackStream();
          var call = null;
          try {
            if (localMicStream) {
              call = p.call(agentId, localMicStream);
            }
          } catch (e) {
            log("p.call failed", e);
          }
          if (call) {
            mediaCall = call;
            call.on("stream", function (remoteStream) {
              _patch({ remoteStream: remoteStream });
            });
            call.on("close", function () {
              if (mediaCall === call) {
                mediaCall = null;
                _patch({ remoteStream: null });
              }
            });
            call.on("error", function (err) {
              var t = (err && err.type) || (err && err.message) || "call-error";
              log("visitor call error", t);
              _patch({ error: t });
            });
          }
        });
        if (!settled) {
          settled = true;
          resolve({ pin: clean, peerId: visitorId });
        }
      });

      p.on("error", function (err) {
        var t = (err && err.type) || (err && err.message) || "peer-error";
        log("visitor peer error", t);
        var human =
          t === "peer-unavailable"
            ? "No active session for that PIN. Ask your agent to start one."
            : "Couldn't connect to the live tour. " + t;
        _patch({ status: "error", error: human, isConnected: false });
        if (!settled) {
          settled = true;
          reject(err instanceof Error ? err : new Error(t));
        }
      });

      p.on("close", function () {
        _patch({ status: "ended", isConnected: false });
      });
    });
  }

  // ── Shared ─────────────────────────────────────────────────────────
  function _handleIncomingData(payload) {
    if (!_isPlainObject(payload)) return;
    var type = payload.type;
    if (type === "teleport") {
      var ss = _coerceString(payload.ss).trim();
      var sr = _coerceString(payload.sr).trim();
      if (!ss) return;
      // Always update the internal viewKey so the annotation receive
      // filter stays correct — annotation packets carry the viewKey
      // and we drop stale ones regardless of role.
      _currentViewKey = ss + "|" + sr;
      // Role-direction guard: `teleport` is an agent → visitor packet.
      // An agent receiving its own teleport (echo / loopback / test
      // arrangement) must NOT patch incomingTeleportEvent — doing so
      // would trigger the agent's parent-code reload branch and cause
      // an unintended iframe refresh on the wrong side.
      if (state.role !== "visitor") return;
      _patch({
        incomingTeleportEvent: { ss: ss, sr: sr, ts: Date.now() },
      });
      return;
    }
    if (type === "location_share") {
      // Visitor → Agent: an offered location. Receiver-side validation
      // mirrors `teleport` (non-empty ss required); we deliberately do
      // NOT update _currentViewKey here — accepting the share is the
      // agent's UX decision, not an automatic protocol action.
      var lss = _coerceString(payload.ss).trim();
      var lsr = _coerceString(payload.sr).trim();
      if (!lss) return;
      // Role-direction guard: `location_share` is a visitor → agent
      // packet. A visitor receiving its own share bounced back (echo /
      // loopback) must NOT patch incomingLocationShareEvent — even
      // though the parent code's auto-follow branch is also role-gated,
      // sealing this at the controller boundary is the strongest
      // defense against the visitor's iframe reloading unexpectedly.
      if (state.role !== "agent") return;
      _patch({
        incomingLocationShareEvent: { ss: lss, sr: lsr, ts: Date.now() },
      });
      return;
    }
    if (
      type === "pointer" ||
      type === "stroke_begin" ||
      type === "stroke_patch" ||
      type === "stroke_commit" ||
      type === "clear" ||
      type === "nav_lock"
    ) {
      var seq = +payload.seq || 0;
      if (seq <= _lastRecvSeq) return;
      var vk = _coerceString(payload.viewKey);
      // Empty viewKey on either end means "no teleport yet" — accept;
      // mismatch when both sides have a key means stale frame, drop.
      if (vk && _currentViewKey && vk !== _currentViewKey) return;
      _lastRecvSeq = seq;
      var ts = +payload.ts || Date.now();
      if (type === "pointer") {
        _patch({
          incomingPointerEvent: {
            viewKey: vk,
            seq: seq,
            x: typeof payload.x === "number" ? payload.x : null,
            y: typeof payload.y === "number" ? payload.y : null,
            ts: ts,
          },
        });
        return;
      }
      if (type === "clear") {
        _patch({
          incomingClearEvent: { viewKey: vk, seq: seq, ts: ts },
        });
        return;
      }
      if (type === "nav_lock") {
        _patch({
          incomingNavLockEvent: {
            viewKey: vk,
            locked: payload.locked === true,
            seq: seq,
            ts: ts,
          },
        });
        return;
      }
      var kind =
        type === "stroke_begin"
          ? "begin"
          : type === "stroke_patch"
            ? "patch"
            : "commit";
      var ev = {
        kind: kind,
        viewKey: vk,
        seq: seq,
        strokeId: _coerceString(payload.strokeId),
        ts: ts,
      };
      if (typeof payload.color === "string") ev.color = payload.color;
      if (typeof payload.width === "number") ev.width = payload.width;
      if (Array.isArray(payload.points)) ev.points = payload.points;
      _patch({ incomingStrokeEvent: ev });
    }
  }

  // Agent-only: send a teleport packet to the connected visitor. Returns
  // true on a successful send. Silently fails (returns false) when not
  // in agent role, when no data channel is open, or when the underlying
  // send throws — callers should treat the boolean as a hint, not as an
  // ack of delivery.
  function teleportVisitor(ss, sr) {
    if (state.role !== "agent") return false;
    if (!dataConn || !state.isConnected) return false;
    var ssClean = _coerceString(ss).trim();
    var srClean = _coerceString(sr).trim();
    if (!ssClean) return false;
    var packet = { type: "teleport", ss: ssClean, sr: srClean };
    try {
      dataConn.send(packet);
      _currentViewKey = ssClean + "|" + srClean;
      return true;
    } catch (e) {
      log("send failed", e);
      return false;
    }
  }

  // Visitor-only: hand the agent the visitor's current Matterport
  // coordinates (typically parsed from the clipboard URL Matterport
  // emits when the user presses `U` → "Copy to clipboard"). The agent
  // does NOT auto-teleport on receive — they get a notification and
  // choose to follow — so this is a soft, opt-in offer over the wire.
  function shareLocationWithAgent(ss, sr) {
    if (state.role !== "visitor") return false;
    if (!dataConn || !state.isConnected) return false;
    var ssClean = _coerceString(ss).trim();
    var srClean = _coerceString(sr).trim();
    if (!ssClean) return false;
    var packet = { type: "location_share", ss: ssClean, sr: srClean, ts: Date.now() };
    try {
      dataConn.send(packet);
      return true;
    } catch (e) {
      log("location_share send failed", e);
      return false;
    }
  }

  function _canSendAnnotation() {
    return state.role === "agent" && !!dataConn && state.isConnected;
  }

  function _bufferedAmount() {
    if (!dataConn) return 0;
    var ba = dataConn.bufferedAmount;
    return typeof ba === "number" ? ba : 0;
  }

  function _scheduleFlush() {
    if (_flushScheduled) return;
    _flushScheduled = true;
    try {
      scheduler(_flushPendingPointer);
    } catch (e) {
      _flushScheduled = false;
      log("scheduler threw", e);
    }
  }

  function _flushPendingPointer() {
    _flushScheduled = false;
    var p = _pendingPointer;
    _pendingPointer = null;
    if (!p) return;
    if (!_canSendAnnotation()) return;
    if (_bufferedAmount() > LIVE_SESSION_POINTER_BACKPRESSURE_BYTES) return;
    var seq = ++_sendSeq;
    var packet = {
      type: "pointer",
      viewKey: _coerceString(p.viewKey),
      seq: seq,
      x: typeof p.x === "number" ? p.x : null,
      y: typeof p.y === "number" ? p.y : null,
      ts: Date.now(),
    };
    try {
      dataConn.send(packet);
    } catch (e) {
      log("pointer send failed", e);
    }
  }

  // Agent-only: queue a pointer update. Coalesced through `scheduler`
  // so a flood of mousemove events still produces at most one packet
  // per frame. Returns true if the call was queued, false if the
  // session isn't in a position to send (wrong role, no channel).
  function sendPointer(viewKey, x, y) {
    if (!_canSendAnnotation()) return false;
    _pendingPointer = { viewKey: viewKey, x: x, y: y };
    _scheduleFlush();
    return true;
  }

  function _sendStroke(type, viewKey, strokeId, extra) {
    if (!_canSendAnnotation()) return false;
    var sid = _coerceString(strokeId);
    if (!sid) return false;
    var seq = ++_sendSeq;
    var packet = {
      type: type,
      viewKey: _coerceString(viewKey),
      seq: seq,
      strokeId: sid,
      ts: Date.now(),
    };
    if (extra) {
      for (var k in extra) {
        if (Object.prototype.hasOwnProperty.call(extra, k)) packet[k] = extra[k];
      }
    }
    try {
      dataConn.send(packet);
      return true;
    } catch (e) {
      log("stroke send failed", e);
      return false;
    }
  }

  function sendStrokeBegin(viewKey, strokeId, color, width, points) {
    var extra = {};
    if (typeof color === "string") extra.color = color;
    if (typeof width === "number") extra.width = width;
    if (Array.isArray(points) && points.length > 0) extra.points = points;
    return _sendStroke("stroke_begin", viewKey, strokeId, extra);
  }

  function sendStrokePatch(viewKey, strokeId, points) {
    if (!Array.isArray(points) || points.length === 0) return false;
    return _sendStroke("stroke_patch", viewKey, strokeId, { points: points });
  }

  function sendStrokeCommit(viewKey, strokeId) {
    return _sendStroke("stroke_commit", viewKey, strokeId, null);
  }

  function sendClear(viewKey) {
    if (!_canSendAnnotation()) return false;
    var seq = ++_sendSeq;
    var packet = {
      type: "clear",
      viewKey: _coerceString(viewKey),
      seq: seq,
      ts: Date.now(),
    };
    try {
      dataConn.send(packet);
      return true;
    } catch (e) {
      log("clear send failed", e);
      return false;
    }
  }

  function sendNavLock(viewKey, locked) {
    if (!_canSendAnnotation()) return false;
    var seq = ++_sendSeq;
    var packet = {
      type: "nav_lock",
      viewKey: _coerceString(viewKey),
      locked: locked === true,
      seq: seq,
      ts: Date.now(),
    };
    try {
      dataConn.send(packet);
      return true;
    } catch (e) {
      log("nav_lock send failed", e);
      return false;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    listeners.length = 0;
    if (mediaCall) {
      try {
        mediaCall.close();
      } catch (e) {
        // ignore
      }
    }
    if (dataConn) {
      try {
        dataConn.close();
      } catch (e) {
        // ignore
      }
    }
    if (localMicStream && typeof localMicStream.getTracks === "function") {
      try {
        var tracks = localMicStream.getTracks();
        for (var i = 0; i < tracks.length; i++) {
          try {
            tracks[i].stop();
          } catch (e) {
            // ignore
          }
        }
      } catch (e) {
        // ignore
      }
    }
    if (peer) {
      try {
        peer.destroy();
      } catch (e) {
        // ignore
      }
    }
    peer = null;
    dataConn = null;
    mediaCall = null;
    localMicStream = null;
    _sendSeq = 0;
    _lastRecvSeq = 0;
    _currentViewKey = "";
    _pendingPointer = null;
    _flushScheduled = false;
    state = {
      role: null,
      status: "idle",
      pin: null,
      peerId: null,
      error: null,
      isConnected: false,
      remoteStream: null,
      incomingTeleportEvent: null,
      incomingPointerEvent: null,
      incomingStrokeEvent: null,
      incomingClearEvent: null,
      incomingNavLockEvent: null,
      incomingLocationShareEvent: null,
    };
  }

  return {
    getState: getState,
    subscribe: subscribe,
    initializeAsAgent: initializeAsAgent,
    joinAsVisitor: joinAsVisitor,
    teleportVisitor: teleportVisitor,
    shareLocationWithAgent: shareLocationWithAgent,
    sendPointer: sendPointer,
    sendStrokeBegin: sendStrokeBegin,
    sendStrokePatch: sendStrokePatch,
    sendStrokeCommit: sendStrokeCommit,
    sendClear: sendClear,
    sendNavLock: sendNavLock,
    dispose: dispose,
  };
}

export { createLiveSession };
