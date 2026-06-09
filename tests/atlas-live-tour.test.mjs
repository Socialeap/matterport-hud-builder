#!/usr/bin/env node

// Tests for the Atlas Curated Showcase "Explore Together" shared-tour glue
// (src/lib/atlas-live-tour-runtime.mjs). The glue REUSES the tested
// createLiveSession controller (covered by tests/live-session.test.mjs); here
// we verify the glue itself is browser-safe, parses, exposes the expected
// wiring, and drives the controller from the Host/Guest UI handlers — all
// against a hand-rolled fake DOM, no browser or network.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  findForbiddenTokens,
  stripExports,
} from "../src/lib/portal/ask-runtime-transformer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(__dirname, "..", "src", "lib", "atlas-live-tour-runtime.mjs");
const RAW = readFileSync(SOURCE, "utf8");
const GLUE = stripExports(RAW);

// The shared mobile-input helpers are injected just before the glue in the
// generated HTML (atlas-live-tour.ts), so the fake-DOM runs concatenate the
// real module the same way — the pointer tests below exercise the genuine
// guard, not the glue's assembly-regression fallback.
const ANNO_INPUT_SOURCE = path.join(__dirname, "..", "src", "lib", "portal", "anno-input.mjs");
const ANNO_INPUT = stripExports(readFileSync(ANNO_INPUT_SOURCE, "utf8"));
const BODY = ANNO_INPUT + "\n" + GLUE;

// ── 1. Browser-safety gate (same rules as the other runtime .mjs files) ──
test("glue passes the browser-safety token gate", () => {
  const offenders = findForbiddenTokens(GLUE);
  assert.deepEqual(offenders, [], `forbidden tokens: ${offenders.join(", ")}`);
});

test("glue contains no single-quote string literals", () => {
  // The shared comment-stripper only tracks " and ` delimiters, so a single
  // quote would corrupt the forbidden-token scan. Enforce none in source.
  const lines = RAW.split("\n");
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("//")) continue;
    if (t.indexOf(String.fromCharCode(39)) !== -1) bad.push(i + 1);
  }
  assert.deepEqual(bad, [], `single-quote on lines: ${bad.join(", ")}`);
});

test("glue parses cleanly as a function body", () => {
  assert.doesNotThrow(() => {
    // eslint-disable-next-line no-new-func
    new Function(GLUE);
  });
});

// ── 2. Required wiring is present ────────────────────────────────────────
test("glue wires the reused controller API + Atlas config hook", () => {
  for (const needle of [
    "window.__ATLAS_LT_CONFIG",
    "createLiveSession({", // session factory (deferVoice + onDiagnostic opts)
    "deferVoice: IS_IOS_WEBKIT",
    "onDiagnostic: markMilestone",
    "startVoice",
    "lt-enable-voice-btn",
    "ensureAnnoCanvasAllocated",
    "annoBudgetDpr",
    "anno-tool-active", // 2.0.2 conditional wrapper hardening
    "markMilestone",
    "resetMilestoneLog",
    "initializeAsAgent()",
    "joinAsVisitor(pin)",
    "shareLocationWithAgent",
    "teleportVisitor",
    "sendPointer",
    "sendStrokeBegin",
    "sendStrokeCommit",
    "sendClear",
    "sendNavLock",
    "parseMatterportLocationUrl",
    "matterport", // location-sync host guard (regex: /(^|\\.)matterport\\.com$/i)
    // Mobile-input hardening (anno-input.mjs consumers + abort paths).
    "createAnnoPointerGuard",
    "annoCollectPoints",
    "annoClampDpr",
    "annoIsCoarsePointer",
    "annoBindViewportEvents",
    "pointercancel",
    "lostpointercapture",
    "ropeMoveDragging",
    "latchHitRadiusPx",
    "ANNO_INPUT_OK", // fail-closed gate when anno-input is missing
    // iOS clipboard isolation + WebKit gesture defenses.
    "annoIsIosWebKit",
    "ambientClipboardAllowed",
    "clipboard-read", // Permissions API query — never a readText() probe
    "Sync copied view", // iOS idle label: the explicit tap-to-sync CTA
    "explicitSyncTap", // iOS explicit tap handler (the only user-gesture read)
    "setTransientState", // reading/nolink/denied/notconnected state machine
    "Reading copied link", // the explicit-read in-flight state label
    "contextmenu",
    "selectstart",
    "dragstart",
    "touchstart",
    // Interaction-active emit → parent fullscreen handoff (runtime 2.0.3).
    "emitInteractionActive",
    "f3d:interaction-active",
  ]) {
    assert.ok(GLUE.includes(needle), `expected glue to reference: ${needle}`);
  }
});

// ── 3. Fake-DOM smoke + behaviour ────────────────────────────────────────
function fakeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, on) => (on === undefined ? (set.has(c) ? set.delete(c) : set.add(c)) : on ? set.add(c) : set.delete(c)),
    contains: (c) => set.has(c),
  };
}

function FakeEl(id) {
  this.id = id;
  this._h = Object.create(null);
  this.classList = fakeClassList();
  this.style = {};
  this.attrs = Object.create(null);
  this.hidden = false;
  this.disabled = false;
  this.value = "";
  this.textContent = "";
  this.innerHTML = "";
  this.firstChild = null;
  this._children = [];
}
FakeEl.prototype.addEventListener = function (ev, fn) {
  (this._h[ev] || (this._h[ev] = [])).push(fn);
};
FakeEl.prototype.removeEventListener = function () {};
FakeEl.prototype.setAttribute = function (k, v) {
  this.attrs[k] = v;
};
FakeEl.prototype.getAttribute = function (k) {
  return this.attrs[k] === undefined ? null : this.attrs[k];
};
FakeEl.prototype.querySelector = function () {
  return null;
};
FakeEl.prototype.querySelectorAll = function () {
  return [];
};
FakeEl.prototype.appendChild = function (c) {
  this._children.push(c);
  this.firstChild = this._children[0];
  return c;
};
FakeEl.prototype.getContext = function () {
  // Method-complete-enough 2D context stub: the glue redraws strokes and
  // the rope latch on every pointer sample in the behavioral tests below.
  if (!this._ctx) {
    const noop = () => {};
    this._ctx = {
      clearRect: noop,
      setTransform: noop,
      beginPath: noop,
      moveTo: noop,
      lineTo: noop,
      stroke: noop,
      arc: noop,
      fill: noop,
    };
  }
  return this._ctx;
};
FakeEl.prototype.setPointerCapture = function (id) {
  this._captured = id;
};
FakeEl.prototype.releasePointerCapture = function (id) {
  if (this._captured === id) this._captured = null;
};
FakeEl.prototype.focus = function () {};
FakeEl.prototype.getBoundingClientRect = function () {
  return { left: 0, top: 0, width: 1280, height: 720 };
};
FakeEl.prototype.fire = function (ev, payload) {
  const e = Object.assign({ preventDefault() {}, target: {}, key: "" }, payload || {});
  (this._h[ev] || []).forEach((f) => f(e));
};

function makeFakeDom() {
  const els = Object.create(null);
  const document = {
    _h: Object.create(null),
    getElementById(id) {
      if (!els[id]) els[id] = new FakeEl(id);
      return els[id];
    },
    querySelectorAll() {
      return [];
    },
    createElement(tag) {
      return new FakeEl(tag);
    },
    addEventListener(ev, fn) {
      (this._h[ev] || (this._h[ev] = [])).push(fn);
    },
    body: { classList: fakeClassList() },
    hidden: false,
    activeElement: null,
  };
  return { els, document };
}

function makeController(calls) {
  const idleState = {
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
  return {
    getState: () => idleState,
    subscribe: (fn) => {
      calls.subscribe += 1;
      calls.lastSubscriber = fn;
      return () => {};
    },
    initializeAsAgent: () => {
      calls.init += 1;
      return Promise.resolve({ pin: "1234", peerId: "host" });
    },
    joinAsVisitor: (pin) => {
      calls.join = pin;
      return Promise.resolve({ pin, peerId: "guest" });
    },
    teleportVisitor: () => true,
    shareLocationWithAgent: () => true,
    sendPointer: () => true,
    sendStrokeBegin: () => true,
    sendStrokePatch: () => true,
    sendStrokeCommit: () => true,
    sendClear: () => true,
    sendNavLock: () => true,
    dispose: () => {
      calls.dispose += 1;
    },
  };
}

function runGlue({ withController }) {
  const { els, document } = makeFakeDom();
  const calls = { subscribe: 0, init: 0, join: null, dispose: 0, lastSubscriber: null };
  const window = {
    __ATLAS_LT_CONFIG: { accent: "#818cf8", matterportBaseUrl: "https://my.matterport.com/show/?m=abc&play=1", shareTitle: "Test Space", stops: [] },
    addEventListener() {},
    location: { href: "https://example.com/test/" },
  };
  const navigator = {}; // no clipboard / share — exercises the graceful guards
  const createLiveSession = withController ? () => makeController(calls) : undefined;
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "window",
    "document",
    "navigator",
    "createLiveSession",
    "ResizeObserver",
    BODY,
  );
  fn(window, document, navigator, createLiveSession, undefined);
  return { els, document, calls };
}

test("init is a no-op-safe when the controller is absent (PeerJS missing)", () => {
  let result;
  assert.doesNotThrow(() => {
    result = runGlue({ withController: false });
  });
  // The Explore Together button is disabled rather than throwing.
  assert.equal(result.els["lt-launch-btn"].disabled, true);
});

test("init subscribes to the controller and drives Host/Guest handlers", () => {
  const { els, calls } = runGlue({ withController: true });
  assert.equal(calls.subscribe, 1, "should subscribe to controller state");

  // Host a tour → controller.initializeAsAgent()
  els["lt-host-start-btn"].fire("click");
  assert.equal(calls.init, 1, "Host a tour should initialize as Host");
  assert.equal(els["lt-host-block"].hidden, false, "host block becomes visible");

  // Join with a 4-digit PIN → controller.joinAsVisitor("1234")
  els["lt-pin-input"].value = "1234";
  els["lt-join-btn"].fire("click");
  assert.equal(calls.join, "1234", "Join should pass the sanitized 4-digit PIN");
});

test("join rejects a non-4-digit PIN without calling the controller", () => {
  const { els, calls } = runGlue({ withController: true });
  els["lt-pin-input"].value = "12"; // too short
  els["lt-join-btn"].fire("click");
  assert.equal(calls.join, null, "short PIN must not reach the controller");
  assert.match(els["lt-guest-status"].textContent, /4-digit PIN/);
});

// ── 4. Manual paste-to-sync fallback (Host + Guest) ──────────────────────
// When clipboard auto-read is blocked/unavailable, the user pastes the
// Matterport "Link to location" URL. It must parse with the same parser the
// auto-poll uses and route through the same controller send path
// (shareLocationWithAgent for Guest, teleportVisitor for Host).
function makeConnectedController(role, spy) {
  // Stroke spies are optional extras (the manual-sync tests pass only
  // teleport/share); default them so the pointer tests can assert ink.
  spy.begin = spy.begin || [];
  spy.patch = spy.patch || [];
  spy.commit = spy.commit || [];
  const state = {
    role,
    status: "connected",
    pin: "1234",
    peerId: "peer",
    error: null,
    isConnected: true,
    remoteStream: null,
    incomingTeleportEvent: null,
    incomingPointerEvent: null,
    incomingStrokeEvent: null,
    incomingClearEvent: null,
    incomingNavLockEvent: null,
    incomingLocationShareEvent: null,
  };
  return {
    getState: () => state,
    subscribe: () => () => {},
    initializeAsAgent: () => Promise.resolve({ pin: "1234", peerId: "host" }),
    joinAsVisitor: (pin) => Promise.resolve({ pin, peerId: "guest" }),
    teleportVisitor: (ss, sr) => {
      spy.teleport.push([ss, sr]);
      return true;
    },
    shareLocationWithAgent: (ss, sr) => {
      spy.share.push([ss, sr]);
      return true;
    },
    sendPointer: () => true,
    sendStrokeBegin: (vk, sid, color, width, points) => {
      spy.begin.push({ sid, points: Array.isArray(points) ? points.map((p) => p.slice()) : [] });
      return true;
    },
    sendStrokePatch: (vk, sid, points) => {
      spy.patch.push({ sid, points: Array.isArray(points) ? points.map((p) => p.slice()) : [] });
      return true;
    },
    sendStrokeCommit: (vk, sid) => {
      spy.commit.push(sid);
      return true;
    },
    sendClear: () => true,
    sendNavLock: () => true,
    startVoice: () => {
      spy.startVoice = (spy.startVoice || 0) + 1;
      return Promise.resolve(true);
    },
    dispose: () => {},
  };
}

function runGlueWith(createLiveSession) {
  const { els, document } = makeFakeDom();
  const window = {
    __ATLAS_LT_CONFIG: {
      accent: "#818cf8",
      matterportBaseUrl: "https://my.matterport.com/show/?m=abc&play=1",
      shareTitle: "Test Space",
      stops: [],
    },
    addEventListener() {},
    location: { href: "https://example.com/test/" },
  };
  const navigator = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "window",
    "document",
    "navigator",
    "createLiveSession",
    "ResizeObserver",
    BODY,
  );
  fn(window, document, navigator, createLiveSession, undefined);
  return { els, document };
}

test("manual paste-to-sync routes a valid Matterport URL through the Guest send path", () => {
  const spy = { teleport: [], share: [] };
  const { els } = runGlueWith(() => makeConnectedController("visitor", spy));
  els["lt-manual-sync-input"].value =
    "https://my.matterport.com/show/?m=abc&ss=42&sr=-1.5,2.25";
  els["lt-manual-sync-btn"].fire("click");
  assert.deepEqual(
    spy.share,
    [["42", "-1.5,2.25"]],
    "guest should share the parsed ss/sr with the host",
  );
  assert.deepEqual(spy.teleport, [], "guest must not call teleportVisitor");
  assert.equal(els["lt-manual-sync-input"].value, "", "input clears after a successful sync");
  assert.match(els["lt-manual-sync-status"].textContent, /Synced/);
});

test("manual paste-to-sync routes a valid Matterport URL through the Host send path", () => {
  const spy = { teleport: [], share: [] };
  const { els } = runGlueWith(() => makeConnectedController("agent", spy));
  els["lt-manual-sync-input"].value = "https://my.matterport.com/show/?m=abc&ss=7";
  els["lt-manual-sync-btn"].fire("click");
  assert.deepEqual(
    spy.teleport,
    [["7", ""]],
    "host should teleport the guest to the parsed location",
  );
  assert.deepEqual(spy.share, [], "host must not call shareLocationWithAgent");
});

test("manual paste-to-sync rejects an invalid URL without touching the controller", () => {
  const spy = { teleport: [], share: [] };
  const { els } = runGlueWith(() => makeConnectedController("visitor", spy));
  els["lt-manual-sync-input"].value = "https://example.com/not-matterport";
  els["lt-manual-sync-btn"].fire("click");
  assert.deepEqual(spy.share, [], "invalid URL must not reach the controller");
  assert.deepEqual(spy.teleport, []);
  assert.match(els["lt-manual-sync-status"].textContent, /not a valid Matterport/);
  assert.equal(
    els["lt-manual-sync-input"].value,
    "https://example.com/not-matterport",
    "rejected input is preserved so the user can fix it",
  );
});

test("manual paste-to-sync is inert until a tour is connected", () => {
  const spy = { teleport: [], share: [] };
  // withController:true uses the idle (disconnected) controller from runGlue.
  const { els } = runGlue({ withController: true });
  els["lt-manual-sync-input"].value =
    "https://my.matterport.com/show/?m=abc&ss=9";
  els["lt-manual-sync-btn"].fire("click");
  assert.match(els["lt-manual-sync-status"].textContent, /host a tour first/i);
  // The idle controller never records a send.
  assert.ok(!spy.share.length && !spy.teleport.length);
});

// ── 5. Mobile pointer hardening (anno-input guard wired into the glue) ───
// Connected controller + synchronous requestAnimationFrame so the rAF
// coalescers (stroke patch flush, rope flush) run inline; draw mode is
// entered via the "d" hotkey on the fake document.
function runGluePointer(role = "visitor") {
  const spy = { teleport: [], share: [], begin: [], patch: [], commit: [] };
  const { els, document } = makeFakeDom();
  const window = {
    __ATLAS_LT_CONFIG: {
      accent: "#818cf8",
      matterportBaseUrl: "https://my.matterport.com/show/?m=abc&play=1",
      shareTitle: "Test Space",
      stops: [],
    },
    addEventListener() {},
    requestAnimationFrame: (cb) => {
      cb();
      return 0;
    },
    devicePixelRatio: 2,
    location: { href: "https://example.com/test/" },
  };
  const navigator = {};
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "window",
    "document",
    "navigator",
    "createLiveSession",
    "ResizeObserver",
    BODY,
  );
  fn(window, document, navigator, () => makeConnectedController(role, spy), undefined);
  const fireDoc = (ev, payload) =>
    (document._h[ev] || []).forEach((f) =>
      f(Object.assign({ preventDefault() {}, target: null, key: "" }, payload || {})),
    );
  const canvas = els["anno-canvas"];
  return { els, spy, fireDoc, canvas };
}

const touchEv = (id, x, y, extra) =>
  Object.assign(
    { pointerId: id, pointerType: "touch", isPrimary: true, clientX: x, clientY: y },
    extra || {},
  );
const penEv = (id, x, y) => ({
  pointerId: id,
  pointerType: "pen",
  isPrimary: true,
  clientX: x,
  clientY: y,
});

test("touch draw: down begins, coalesced moves patch, up commits", () => {
  const { spy, fireDoc, canvas } = runGluePointer();
  fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", touchEv(1, 128, 72));
  assert.equal(spy.begin.length, 1, "stroke_begin sent on pointerdown");
  assert.equal(canvas._captured, 1, "pointer captured for the gesture");
  canvas.fire(
    "pointermove",
    touchEv(1, 256, 144, {
      getCoalescedEvents: () => [
        touchEv(1, 192, 108),
        touchEv(1, 256, 144),
      ],
    }),
  );
  assert.equal(spy.patch.length, 1, "patch flushed synchronously via rAF");
  assert.equal(spy.patch[0].points.length, 2, "both coalesced samples ride the patch");
  canvas.fire("pointerup", touchEv(1, 256, 144));
  assert.deepEqual(spy.commit, [spy.begin[0].sid], "stroke commits on pointerup");
  assert.equal(canvas._captured, null, "capture released");
});

test("a second finger can neither start nor corrupt an active stroke", () => {
  const { spy, fireDoc, canvas } = runGluePointer();
  fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", touchEv(1, 100, 100));
  assert.equal(spy.begin.length, 1);
  // Second touch is non-primary by definition while the first is down.
  canvas.fire("pointerdown", touchEv(2, 600, 600, { isPrimary: false }));
  assert.equal(spy.begin.length, 1, "second finger must not open a stroke");
  canvas.fire("pointermove", touchEv(2, 640, 640, { isPrimary: false }));
  assert.equal(spy.patch.length, 0, "second finger must not append points");
  canvas.fire("pointerup", touchEv(2, 640, 640, { isPrimary: false }));
  assert.equal(spy.commit.length, 0, "second finger must not commit");
  canvas.fire("pointerup", touchEv(1, 100, 100));
  assert.equal(spy.commit.length, 1, "owner commit still clean");
});

test("pointercancel finalizes the in-flight stroke instead of stranding it", () => {
  const { spy, fireDoc, canvas } = runGluePointer();
  fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", touchEv(1, 100, 100));
  canvas.fire("pointermove", touchEv(1, 150, 150));
  canvas.fire("pointercancel", { pointerId: 1 });
  assert.equal(spy.commit.length, 1, "cancel must commit (no orphan stroke remotely)");
  assert.equal(canvas._captured, null, "capture released on cancel");
  // The pointer is no longer owned: further moves are ignored…
  canvas.fire("pointermove", touchEv(1, 400, 400));
  assert.equal(spy.patch.length, 1, "no ink after cancel");
  // …and a fresh gesture starts cleanly.
  canvas.fire("pointerdown", touchEv(1, 200, 200));
  assert.equal(spy.begin.length, 2, "new stroke opens after a cancel");
});

test("lostpointercapture after a normal pointerup is a no-op (no double commit)", () => {
  const { spy, fireDoc, canvas } = runGluePointer();
  fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", touchEv(1, 100, 100));
  canvas.fire("pointerup", touchEv(1, 120, 120));
  canvas.fire("lostpointercapture", { pointerId: 1 });
  assert.equal(spy.commit.length, 1, "the browser-fired lostpointercapture must not re-commit");
});

test("lostpointercapture BEFORE pointerup finalizes exactly once; the later pointerup is inert", () => {
  const { spy, fireDoc, canvas } = runGluePointer();
  fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", touchEv(1, 100, 100));
  canvas.fire("pointermove", touchEv(1, 150, 150));
  // Capture stripped first (e.g. an iOS gesture steals the pointer) —
  // the abort path finalizes the stroke immediately…
  canvas.fire("lostpointercapture", { pointerId: 1 });
  assert.equal(spy.commit.length, 1, "lost capture finalizes the stroke once");
  const patchesAtAbort = spy.patch.length;
  // …and the late pointerup for the same pointer must be completely inert.
  canvas.fire("pointerup", touchEv(1, 160, 160));
  assert.equal(spy.commit.length, 1, "the trailing pointerup must not double-commit");
  assert.equal(spy.begin.length, 1, "the trailing pointerup must not open a stroke");
  assert.equal(spy.patch.length, patchesAtAbort, "the trailing pointerup must not add ink");
});

test("Pencil takes over from a palm touch: touch commits, pen draws fresh", () => {
  const { spy, fireDoc, canvas } = runGluePointer();
  fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", touchEv(1, 100, 100));
  assert.equal(spy.begin.length, 1);
  canvas.fire("pointerdown", penEv(2, 300, 300));
  assert.equal(spy.commit.length, 1, "palm stroke committed before the pen claims");
  assert.equal(spy.begin.length, 2, "pen opens its own stroke");
  canvas.fire("pointermove", touchEv(1, 110, 110));
  assert.equal(spy.patch.length, 0, "displaced palm touch is inert");
  canvas.fire("pointerup", penEv(2, 320, 320));
  assert.equal(spy.commit.length, 2, "pen stroke commits");
});

test("Focus Rope: body drag moves the rope; latch keeps resizing", () => {
  const { spy, fireDoc, canvas } = runGluePointer();
  fireDoc("keydown", { key: "r" });
  // Draw a rope: (100,100) → (400,300) in a 1280×720 letterbox.
  canvas.fire("pointerdown", touchEv(1, 100, 100));
  canvas.fire("pointermove", touchEv(1, 400, 300));
  canvas.fire("pointerup", touchEv(1, 400, 300));
  const baseline = spy.begin[spy.begin.length - 1];
  const minX = (entry) => Math.min(...entry.points.map((p) => p[0]));
  // Grab inside the body (well away from the bottom-right latch) and drag.
  canvas.fire("pointerdown", touchEv(1, 200, 200));
  canvas.fire("pointermove", touchEv(1, 250, 200));
  canvas.fire("pointerup", touchEv(1, 250, 200));
  const moved = spy.begin[spy.begin.length - 1];
  assert.equal(moved.sid, baseline.sid, "moving re-flushes the SAME rope stroke");
  assert.ok(
    Math.abs(minX(moved) - minX(baseline) - 50 / 1280) < 1e-6,
    "rope translated by the drag delta (50px → 50/1280 normalized)",
  );
  assert.equal(spy.commit.length, 0, "rope stays active (sealed on tool exit, not on drag end)");
});

// ── 6. Fail-closed when anno-input is missing from assembly ──────────────
// The glue must NOT fall back to permissive single-pointer behavior: Draw
// and Focus Rope are disabled outright, while viewing, the data session,
// the pointer tool, and location sync stay intact.
function runGlueWithoutAnnoInput(role = "visitor") {
  const spy = { teleport: [], share: [], begin: [], patch: [], commit: [] };
  const { els, document } = makeFakeDom();
  const window = {
    __ATLAS_LT_CONFIG: {
      accent: "#818cf8",
      matterportBaseUrl: "https://my.matterport.com/show/?m=abc&play=1",
      shareTitle: "Test Space",
      stops: [],
    },
    addEventListener() {},
    requestAnimationFrame: (cb) => {
      cb();
      return 0;
    },
    devicePixelRatio: 2,
    location: { href: "https://example.com/test/" },
  };
  // GLUE alone — the anno-input module is deliberately absent.
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "window",
    "document",
    "navigator",
    "createLiveSession",
    "ResizeObserver",
    GLUE,
  );
  fn(window, document, {}, () => makeConnectedController(role, spy), undefined);
  const fireDoc = (ev, payload) =>
    (document._h[ev] || []).forEach((f) =>
      f(Object.assign({ preventDefault() {}, target: null, key: "" }, payload || {})),
    );
  return { els, spy, fireDoc, canvas: els["anno-canvas"] };
}

test("fail closed without anno-input: Draw/Rope disabled, no permissive drawing", () => {
  const { els, spy, fireDoc, canvas } = runGlueWithoutAnnoInput();
  assert.equal(els["anno-draw-btn"].disabled, true, "Draw visibly disabled");
  assert.equal(els["anno-rope-btn"].disabled, true, "Focus Rope visibly disabled");
  assert.match(
    els["anno-draw-btn"].attrs.title,
    /unavailable/i,
    "annotation-unavailable state surfaced",
  );
  // Hotkeys cannot re-enter the gated modes…
  fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", touchEv(1, 100, 100));
  canvas.fire("pointermove", touchEv(1, 150, 150));
  canvas.fire("pointerup", touchEv(1, 150, 150));
  assert.equal(spy.begin.length, 0, "no stroke may open without the pointer guard");
  assert.equal(spy.patch.length, 0);
  assert.equal(spy.commit.length, 0);
  fireDoc("keydown", { key: "r" });
  canvas.fire("pointerdown", touchEv(1, 100, 100));
  assert.equal(spy.begin.length, 0, "no rope may open without the pointer guard");
  // …while the pointer tool and the session itself stay functional.
  fireDoc("keydown", { key: "p" });
  assert.equal(canvas.classList.contains("pointer-mode"), true, "pointer tool still available");
  assert.doesNotThrow(() => canvas.fire("pointermove", touchEv(1, 200, 200)));
});

test("fail closed without anno-input: location sync stays fully functional", () => {
  const { els, spy } = runGlueWithoutAnnoInput("visitor");
  els["lt-manual-sync-input"].value =
    "https://my.matterport.com/show/?m=abc&ss=42&sr=-1.5,2.25";
  els["lt-manual-sync-btn"].fire("click");
  assert.deepEqual(spy.share, [["42", "-1.5,2.25"]], "manual sync unaffected by the fail-closed state");
});

// ── 7. iOS clipboard isolation ────────────────────────────────────────────
// On iOS/iPadOS WebKit, navigator.clipboard.readText() raises the native
// Paste callout and interrupts annotation gestures. These tests prove the
// ambient location-sync system performs ZERO automatic readText calls on
// iOS-like navigators across every historical trigger, while the manual
// paste fallback (which never touches the clipboard API) keeps working.
function clipboardReadSpy() {
  const calls = { readText: 0 };
  return {
    calls,
    clipboard: {
      readText() {
        calls.readText += 1;
        return Promise.resolve("");
      },
      writeText() {
        return Promise.resolve();
      },
    },
  };
}

function iphoneNav() {
  const c = clipboardReadSpy();
  return {
    calls: c.calls,
    nav: {
      platform: "iPhone",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
      clipboard: c.clipboard,
    },
  };
}

function ipadDesktopNav() {
  const c = clipboardReadSpy();
  return {
    calls: c.calls,
    nav: {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
      clipboard: c.clipboard,
    },
  };
}

function desktopGrantedNav() {
  const c = clipboardReadSpy();
  return {
    calls: c.calls,
    nav: {
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      maxTouchPoints: 0,
      clipboard: c.clipboard,
      permissions: {
        query: () => Promise.resolve({ state: "granted" }),
      },
    },
  };
}

// Runner with a navigator override, a handler-recording window (so the
// "focus" ambient trigger can be fired), and a seeded sync pill so the
// connected-state label copy is assertable.
function runGlueWithNav(nav, controllerFactory, winExtra) {
  const { els, document } = makeFakeDom();
  const pill = document.getElementById("loc-sync");
  pill.attrs["data-state"] = "waiting";
  const pillLabel = new FakeEl("loc-sync-label");
  pill.querySelector = () => pillLabel;
  // Mirror the generated HTML's initial state: the Enable voice button
  // ships with the `hidden` attribute (PANEL_HTML) and is only revealed
  // by the deferred-voice connect branch.
  document.getElementById("lt-enable-voice-btn").hidden = true;
  const window = Object.assign(
    {
      __ATLAS_LT_CONFIG: {
        accent: "#818cf8",
        matterportBaseUrl: "https://my.matterport.com/show/?m=abc&play=1",
        shareTitle: "Test Space",
        stops: [],
      },
      _h: Object.create(null),
      addEventListener(ev, fn) {
        (this._h[ev] || (this._h[ev] = [])).push(fn);
      },
      requestAnimationFrame: (cb) => {
        cb();
        return 0;
      },
      devicePixelRatio: 2,
      location: { href: "https://example.com/test/" },
    },
    winExtra || {},
  );
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "window",
    "document",
    "navigator",
    "createLiveSession",
    "ResizeObserver",
    BODY,
  );
  fn(window, document, nav, controllerFactory, undefined);
  const fireWin = (ev) => (window._h[ev] || []).forEach((f) => f({}));
  const fireDoc = (ev, payload) =>
    (document._h[ev] || []).forEach((f) =>
      f(Object.assign({ preventDefault() {}, target: null, key: "" }, payload || {})),
    );
  return {
    els,
    pillLabel,
    fireWin,
    fireDoc,
    document,
    canvas: els["anno-canvas"],
    letterbox: els["anno-letterbox-wrap"],
  };
}

test("iOS (iPhone): zero readText across stage entry, focus, visibility, and drawing", () => {
  const { calls, nav } = iphoneNav();
  const spy = { teleport: [], share: [] };
  const { pillLabel, fireWin, fireDoc, canvas, letterbox } = runGlueWithNav(nav, () => {
    // Fire the initial state so onState runs its connected branch (the
    // pill label copy under test is applied there).
    const c = makeConnectedController("visitor", spy);
    c.subscribe = (fn) => {
      fn(c.getState());
      return () => {};
    };
    return c;
  });
  // Every historical ambient trigger:
  letterbox.fire("pointerenter", { pointerType: "mouse" });
  letterbox.fire("pointerenter", { pointerType: "touch" });
  fireWin("focus");
  fireDoc("visibilitychange");
  // Full drawing gesture (the interruption scenario):
  fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", touchEv(1, 100, 100));
  canvas.fire("pointermove", touchEv(1, 200, 200));
  canvas.fire("pointerup", touchEv(1, 200, 200));
  assert.equal(calls.readText, 0, "iOS must never auto-read the clipboard");
  // Honest pill copy on iOS: the pill invites the explicit tap (the only
  // sanctioned, user-gesture clipboard read) — never an ambient-sync claim.
  assert.equal(pillLabel.textContent, "Sync copied view");
});

test("iOS (iPad desktop mode): zero readText from starting or joining a session", () => {
  const { calls, nav } = ipadDesktopNav();
  const trackedCalls = { subscribe: 0, init: 0, join: null, dispose: 0, lastSubscriber: null };
  const { els } = runGlueWithNav(nav, () => makeController(trackedCalls));
  // Host path runs preGrantClipboard() before initializeAsAgent…
  els["lt-host-start-btn"].fire("click");
  assert.equal(trackedCalls.init, 1, "host start reached the controller");
  // …and the guest join path runs it too.
  els["lt-pin-input"].value = "1234";
  els["lt-join-btn"].fire("click");
  assert.equal(trackedCalls.join, "1234", "join reached the controller");
  assert.equal(calls.readText, 0, "preGrant probe must be disabled on iOS");
});

test("iOS: manual paste fallback still syncs without touching the clipboard API", () => {
  const { calls, nav } = iphoneNav();
  const spy = { teleport: [], share: [] };
  const { els } = runGlueWithNav(nav, () => makeConnectedController("visitor", spy));
  els["lt-manual-sync-input"].value =
    "https://my.matterport.com/show/?m=abc&ss=42&sr=-1.5,2.25";
  els["lt-manual-sync-btn"].fire("click");
  assert.deepEqual(spy.share, [["42", "-1.5,2.25"]], "manual sync works on iOS");
  assert.equal(calls.readText, 0, "manual sync reads the input field, never the clipboard");
});

test("desktop control: granted real-mouse stage entry reads; touch/pen never does", async () => {
  const { calls, nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const { letterbox } = runGlueWithNav(nav, () => makeConnectedController("visitor", spy));
  // Let the Permissions API query settle (it is the ONLY permission
  // mechanism — granted state is confirmed without any readText probe).
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.readText, 0, "permission tracking alone must not read");
  letterbox.fire("pointerenter", { pointerType: "touch" });
  letterbox.fire("pointerenter", { pointerType: "pen" });
  assert.equal(calls.readText, 0, "touch/pen stage entry never reads");
  letterbox.fire("pointerenter", { pointerType: "mouse" });
  assert.equal(calls.readText, 1, "granted mouse entry performs the ambient read");
});

test("any active annotation tool suppresses ambient reads on every platform", async () => {
  const { calls, nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const { fireWin, fireDoc } = runGlueWithNav(nav, () => makeConnectedController("visitor", spy));
  await new Promise((r) => setTimeout(r, 0));
  // Draw active → all ambient triggers inert.
  fireDoc("keydown", { key: "d" });
  fireWin("focus");
  fireDoc("visibilitychange");
  assert.equal(calls.readText, 0, "no ambient reads while Draw is active");
  // Pointer tool active → still inert.
  fireDoc("keydown", { key: "p" });
  fireWin("focus");
  assert.equal(calls.readText, 0, "no ambient reads while Pointer is active");
  // Tool exited → desktop ambient behavior resumes.
  fireDoc("keydown", { key: "Escape" });
  fireWin("focus");
  assert.equal(calls.readText, 1, "ambient read resumes after the tool exits");
});

// ── 8. P0 iPad connect-crash hardening (runtime 2.0.2) ───────────────────
function fakeStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _dump: () => Object.fromEntries(m),
  };
}

function subscribeFiring(controller) {
  let push = null;
  controller.subscribe = (fn) => {
    push = fn;
    fn(controller.getState());
    return () => {};
  };
  return { controller, emit: (state) => push && push(state) };
}

test("lazy canvas: NOTHING is allocated at connect; Draw allocates on demand", () => {
  const { calls, nav } = desktopGrantedNav();
  void calls;
  const spy = { teleport: [], share: [] };
  const storage = fakeStorage();
  const wired = subscribeFiring(makeConnectedController("visitor", spy));
  const { fireDoc, canvas } = runGlueWithNav(nav, () => wired.controller, {
    sessionStorage: storage,
  });
  // Connected branch ran (subscribe fired with isConnected) — the canvas
  // backing store must still be untouched.
  assert.equal(canvas.width, undefined, "no buffer allocation at PIN connect");
  assert.match(
    String(storage.getItem("f3d_lt_last_milestone")),
    /^layout_started@/,
    "layout milestone marked without a canvas allocation",
  );
  fireDoc("keydown", { key: "d" });
  assert.equal(canvas.width, 2560, "Draw selection allocates at the clamped desktop DPR (1280×2)");
  assert.equal(canvas.height, 1440);
  assert.match(
    String(storage.getItem("f3d_lt_last_milestone")),
    /^canvas_allocated@/,
    "allocation milestone recorded",
  );
});

test("lazy canvas: a remote stroke is the other allocation trigger", () => {
  const { nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const wired = subscribeFiring(makeConnectedController("visitor", spy));
  const { canvas } = runGlueWithNav(nav, () => wired.controller);
  assert.equal(canvas.width, undefined, "still unallocated after connect");
  wired.emit(
    Object.assign({}, wired.controller.getState(), {
      incomingStrokeEvent: { kind: "begin", viewKey: "", seq: 1, strokeId: "r1", points: [[0.1, 0.1]] },
    }),
  );
  assert.equal(canvas.width, 2560, "incoming remote ink allocates the buffer");
});

test("iOS canvas DPR is capped at 1.5", () => {
  const { nav } = iphoneNav();
  const spy = { teleport: [], share: [] };
  const { fireDoc, canvas } = runGlueWithNav(nav, () => makeConnectedController("visitor", spy));
  fireDoc("keydown", { key: "d" });
  // window.devicePixelRatio is 2 in the runner; iOS cap forces 1.5.
  assert.equal(canvas.width, 1920, "1280 × 1.5 — not 1280 × 2");
  assert.equal(canvas.height, 1080, "720 × 1.5");
});

test("crash forensics: the prior session's last milestone is displayed on load", () => {
  const { nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const storage = fakeStorage({ f3d_lt_last_milestone: "mic_requested@1717000000000" });
  const { els } = runGlueWithNav(nav, () => makeConnectedController("visitor", spy), {
    sessionStorage: storage,
  });
  assert.equal(els["lt-diag"].hidden, false, "diagnostic line surfaces after a crash/reload");
  assert.match(els["lt-diag"].textContent, /mic_requested/);
  assert.ok(
    !els["lt-diag"].textContent.includes("@"),
    "timestamp suffix is stripped from the display",
  );
});

test("iOS: Enable voice appears on connect and drives session.startVoice()", () => {
  const { nav } = iphoneNav();
  const spy = { teleport: [], share: [] };
  const wired = subscribeFiring(makeConnectedController("visitor", spy));
  const { els } = runGlueWithNav(nav, () => wired.controller);
  assert.equal(els["lt-enable-voice-btn"].hidden, false, "deferred voice offers the explicit action");
  els["lt-enable-voice-btn"].fire("click");
  assert.equal(spy.startVoice, 1, "the tap calls the controller startVoice (user gesture)");
});

test("iOS: Enable voice re-enables when the call dies before streaming (P2)", async () => {
  const { nav } = iphoneNav();
  const spy = { teleport: [], share: [] };
  const wired = subscribeFiring(makeConnectedController("visitor", spy));
  // startVoice succeeds and wires a call: reflect that in controller state.
  wired.controller.startVoice = () => {
    wired.controller.getState().voiceCallActive = true;
    return Promise.resolve(true);
  };
  const { els } = runGlueWithNav(nav, () => wired.controller);
  const btn = els["lt-enable-voice-btn"];
  btn.fire("click");
  await new Promise((r) => setImmediate(r));
  assert.equal(btn.disabled, true, "negotiating: control held");
  // The call dies before any remote stream (negotiation failure / peer
  // disconnect): the controller emits the voiceCallActive falling edge.
  wired.emit(
    Object.assign({}, wired.controller.getState(), {
      voiceCallActive: false,
      remoteStream: null,
    }),
  );
  assert.equal(btn.disabled, false, "retry control handed back");
  assert.equal(btn.hidden, false, "and visible again");
  assert.match(
    els["lt-voice-status"].textContent,
    /retry/i,
    "status explains the retry affordance",
  );
});

test("desktop: Enable voice stays hidden (voice auto-starts there)", () => {
  const { nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const wired = subscribeFiring(makeConnectedController("visitor", spy));
  const { els } = runGlueWithNav(nav, () => wired.controller);
  assert.equal(els["lt-enable-voice-btn"].hidden, true);
});

test("the anno-tool-active body class tracks tool engagement (2.0.2 wrapper gate)", () => {
  const { nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const { fireDoc, document } = runGlueWithNav(nav, () => makeConnectedController("visitor", spy));
  assert.equal(document.body.classList.contains("anno-tool-active"), false, "inactive at rest");
  fireDoc("keydown", { key: "d" });
  assert.equal(document.body.classList.contains("anno-tool-active"), true, "engages with Draw");
  fireDoc("keydown", { key: "Escape" });
  assert.equal(
    document.body.classList.contains("anno-tool-active"),
    false,
    "released on tool exit — Matterport navigation untouched again",
  );
});

test("wrapper gesture CSS is conditional in the generated stylesheet (2.0.2)", () => {
  const src = readFileSync(path.join(__dirname, "..", "src", "lib", "atlas-live-tour.ts"), "utf8");
  assert.ok(
    src.includes("body.anno-tool-active #anno-letterbox-wrap{touch-action:none"),
    "hardening must be scoped to the tool-active state",
  );
  assert.ok(
    !src.includes("#anno-letterbox-wrap{position:absolute;inset:0;touch-action"),
    "the base wrapper rule must NOT carry permanent touch-action (the 2.0.1 defect)",
  );
});

// ── 9. Bounded runtime sentinels (U0 — locate replaceable spans by range) ─
test("the Atlas runtime spans are wrapped in bounded f3d sentinels", () => {
  const src = readFileSync(path.join(__dirname, "..", "src", "lib", "atlas-live-tour.ts"), "utf8");
  assert.ok(src.includes('f3dWrapHtml("dep:peerjs"'), "PeerJS dependency must be sentinel-wrapped");
  assert.ok(src.includes("f3dWrapCss("), "runtime CSS must be sentinel-wrapped");
  // Each replaceable markup region gets a UNIQUE span so every marker name
  // identifies exactly one byte range (no three-identical-markup ambiguity).
  for (const span of ["markup:stage", "markup:toolbar", "markup:panel"]) {
    assert.ok(src.includes(`f3dWrapHtml("${span}"`), `runtime markup must use unique span ${span}`);
  }
  assert.ok(!src.includes('f3dWrapHtml("markup"'), "bare ambiguous markup span must be gone");
  for (const marker of [
    "f3d:runtime-js:kernel BEGIN v=1 family=atlas",
    "f3d:runtime-js:kernel END",
    "f3d:runtime-js:glue BEGIN v=1 family=atlas",
    "f3d:runtime-js:glue END",
  ]) {
    assert.ok(src.includes(marker), `missing JS sentinel: ${marker}`);
  }
  // The family marker travels through the generic contract (atlas-curation-
  // server splices buildRuntimeMetaTags("atlas")); the wrappers here must
  // never wrap the Matterport config payload (window.__ATLAS_LT_CONFIG).
  const cfgIdx = src.indexOf("window.__ATLAS_LT_CONFIG=");
  const kernelIdx = src.indexOf("f3d:runtime-js:kernel BEGIN");
  assert.ok(cfgIdx !== -1 && kernelIdx !== -1 && cfgIdx < kernelIdx, "config stays outside the JS sentinels");
});

// ── 7. Mobile Sync View: explicit "Sync copied view" tap (iOS) ───────────
// On iOS the loc-sync pill is an explicit tap-to-sync button. A clipboard read
// happens ONLY from that click (a user gesture) — never from focus /
// visibilitychange / pointerenter (ambientClipboardAllowed() === false on iOS).
// Parity with the Builder family (tests/builder-mobile-sync.test.mjs).
function makeIosClipboard(opts) {
  return {
    reads: 0,
    _text: opts.clipText !== undefined ? opts.clipText : "",
    _reject: !!opts.clipReject,
    _h: Object.create(null),
    readText() {
      this.reads += 1;
      return this._reject ? Promise.reject(new Error("NotAllowedError")) : Promise.resolve(this._text);
    },
    addEventListener(ev, fn) { (this._h[ev] || (this._h[ev] = [])).push(fn); },
  };
}
function makeIdleController(spy) {
  spy.teleport = spy.teleport || [];
  spy.share = spy.share || [];
  const state = {
    role: "none", status: "idle", pin: null, peerId: null, error: null, isConnected: false,
    remoteStream: null, incomingTeleportEvent: null, incomingPointerEvent: null,
    incomingStrokeEvent: null, incomingClearEvent: null, incomingNavLockEvent: null,
    incomingLocationShareEvent: null,
  };
  return {
    getState: () => state, subscribe: () => () => {},
    initializeAsAgent: () => Promise.resolve({ pin: "1234", peerId: "host" }),
    joinAsVisitor: (pin) => Promise.resolve({ pin, peerId: "guest" }),
    teleportVisitor: () => true, shareLocationWithAgent: () => true,
    sendPointer: () => true, sendStrokeBegin: () => true, sendStrokePatch: () => true,
    sendStrokeCommit: () => true, sendClear: () => true, sendNavLock: () => true, dispose: () => {},
  };
}
function runAtlasSync(opts = {}) {
  const role = opts.role || "visitor";
  const spy = { teleport: [], share: [] };
  const { els, document } = makeFakeDom();
  const clip = makeIosClipboard(opts);
  const UA = {
    ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  const platform = opts.platform || "ios";
  const navigator = {
    userAgent: UA[platform],
    platform: platform === "ios" ? "iPhone" : platform === "android" ? "Linux armv8l" : "Win32",
    maxTouchPoints: platform === "desktop" ? 0 : 5,
    clipboard: opts.noClipboard ? undefined : clip,
  };
  const window = {
    __ATLAS_LT_CONFIG: {
      accent: "#818cf8",
      matterportBaseUrl: "https://my.matterport.com/show/?m=abc&play=1",
      shareTitle: "Test Space",
      stops: [],
    },
    _h: Object.create(null),
    addEventListener(ev, fn) { (this._h[ev] || (this._h[ev] = [])).push(fn); },
    removeEventListener() {},
    requestAnimationFrame: (cb) => { cb(); return 0; },
    devicePixelRatio: 2,
    matchMedia: (q) => ({ matches: !!opts.coarse && String(q).indexOf("coarse") !== -1, addEventListener() {}, removeEventListener() {} }),
    location: { href: "https://example.com/test/" },
  };
  const controller = opts.connected === false ? makeIdleController(spy) : makeConnectedController(role, spy);
  // eslint-disable-next-line no-new-func
  const fn = new Function("window", "document", "navigator", "createLiveSession", "ResizeObserver", BODY);
  fn(window, document, navigator, () => controller, undefined);
  const fireWin = (ev) => (window._h[ev] || []).forEach((f) => f({}));
  const fireDoc = (ev, payload) =>
    (document._h[ev] || []).forEach((f) => f(Object.assign({ preventDefault() {} }, payload || {})));
  return { els, spy, clip, fireWin, fireDoc };
}
const syncTick = () => new Promise((r) => setTimeout(r, 0));
const ATLAS_VALID = "https://my.matterport.com/show/?m=ABCdef12345&ss=42&sr=-1.23,0.45";
const atlasPillState = (h) => h.els["loc-sync"].getAttribute("data-state");

test("Atlas iOS: explicit tap reads the clipboard ONCE and sends (visitor → shareLocationWithAgent)", async () => {
  const h = runAtlasSync({ role: "visitor", clipText: ATLAS_VALID });
  h.els["loc-sync"].fire("click", { preventDefault() {} });
  assert.equal(atlasPillState(h), "reading", "tap shows the reading state immediately");
  await syncTick();
  assert.equal(h.clip.reads, 1, "exactly one clipboard read, from the click");
  assert.deepEqual(h.spy.share, [["42", "-1.23,0.45"]]);
  assert.equal(atlasPillState(h), "success");
});

test("Atlas iOS: explicit tap sends via teleportVisitor (agent)", async () => {
  const h = runAtlasSync({ role: "agent", clipText: ATLAS_VALID });
  h.els["loc-sync"].fire("click", { preventDefault() {} });
  await syncTick();
  assert.deepEqual(h.spy.teleport, [["42", "-1.23,0.45"]]);
});

test("Atlas iOS: ambient lifecycle events NEVER read the clipboard", () => {
  const h = runAtlasSync({ role: "visitor", clipText: ATLAS_VALID });
  h.fireWin("focus");
  h.fireDoc("visibilitychange");
  const lb = h.els["anno-letterbox-wrap"];
  lb.fire("pointerenter", { pointerType: "mouse", preventDefault() {} });
  lb.fire("pointerenter", { pointerType: "touch", preventDefault() {} });
  assert.equal(h.clip.reads, 0, "ambient triggers must not read the clipboard on iOS");
  assert.equal(h.spy.share.length + h.spy.teleport.length, 0);
});

test("Atlas iOS: non-Matterport / oversized clipboards are rejected (no transmit)", async () => {
  const bad = runAtlasSync({ role: "visitor", clipText: "https://example.com/?ss=42&sr=1,2" });
  bad.els["loc-sync"].fire("click", { preventDefault() {} });
  await syncTick();
  assert.equal(bad.spy.share.length, 0, "non-Matterport host is never transmitted");
  assert.equal(atlasPillState(bad), "nolink");
  const huge = runAtlasSync({ role: "visitor", clipText: "https://my.matterport.com/show/?m=a&ss=1&x=" + "9".repeat(2100) });
  huge.els["loc-sync"].fire("click", { preventDefault() {} });
  await syncTick();
  assert.equal(huge.spy.share.length, 0, "a 2KB+ clipboard is rejected");
});

test("Atlas iOS: not-connected and read-denied surface honest states, never transmit", async () => {
  const off = runAtlasSync({ role: "visitor", connected: false, clipText: ATLAS_VALID });
  off.els["loc-sync"].fire("click", { preventDefault() {} });
  await syncTick();
  assert.equal(off.clip.reads, 0, "the connection guard precedes any clipboard read");
  assert.equal(atlasPillState(off), "notconnected");
  const denied = runAtlasSync({ role: "visitor", clipReject: true });
  denied.els["loc-sync"].fire("click", { preventDefault() {} });
  await syncTick();
  assert.equal(denied.spy.share.length, 0);
  assert.equal(atlasPillState(denied), "denied");
});

test("Atlas Android (coarse pointer, non-iOS): the pill is a tap-to-sync button and transmits", async () => {
  const h = runAtlasSync({ platform: "android", coarse: true, role: "visitor", clipText: ATLAS_VALID });
  h.els["loc-sync"].fire("click", { preventDefault() {} });
  await syncTick();
  assert.equal(h.clip.reads, 1, "Android / coarse-pointer tap reads the clipboard from the gesture");
  assert.deepEqual(h.spy.share, [["42", "-1.23,0.45"]]);
});

test("Atlas desktop (fine pointer, non-iOS): tapping the pill does nothing (ambient-only, press-U intact)", async () => {
  const h = runAtlasSync({ platform: "desktop", coarse: false, role: "visitor", clipText: ATLAS_VALID });
  h.els["loc-sync"].fire("click", { preventDefault() {} });
  await syncTick();
  assert.equal(h.clip.reads, 0, "desktop pill installs no tap handler — a click reads nothing");
  assert.equal(h.spy.share.length + h.spy.teleport.length, 0, "and transmits nothing");
});
