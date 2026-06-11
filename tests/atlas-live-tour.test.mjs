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
    "annoCollabEligible", // desktop-only collaboration gate (fail-closed)
    "ensurePeerJs", // lazy SRI-pinned PeerJS loader (intent-gated)
    "f3d-peerjs-loader", // inert dep-span config the loader reads
    "clipboard-read", // Permissions API query — never a readText() probe
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

function runGlue({ withController, peer }) {
  const { els, document } = makeFakeDom();
  const calls = { subscribe: 0, init: 0, join: null, dispose: 0, lastSubscriber: null };
  const window = {
    __ATLAS_LT_CONFIG: { accent: "#818cf8", matterportBaseUrl: "https://my.matterport.com/show/?m=abc&play=1", shareTitle: "Test Space", stops: [] },
    addEventListener() {},
    location: { href: "https://example.com/test/" },
    matchMedia: DESKTOP_MM,
  };
  const navigator = desktopNav(); // no clipboard / share — exercises the graceful guards
  const createLiveSession = withController ? () => makeController(calls) : undefined;
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "window",
    "document",
    "navigator",
    "createLiveSession",
    "ResizeObserver",
    "Peer",
    BODY,
  );
  fn(window, document, navigator, createLiveSession, undefined, peer);
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

test("init subscribes to the controller and drives Host/Guest handlers", async () => {
  // Peer is provided, so ensurePeerJs() short-circuits; the handlers are
  // still a microtask away (intent → ensure → controller).
  const { els, calls } = runGlue({ withController: true, peer: function FakePeer() {} });
  assert.equal(calls.subscribe, 1, "should subscribe to controller state");

  // Host a tour → controller.initializeAsAgent()
  els["lt-host-start-btn"].fire("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.init, 1, "Host a tour should initialize as Host");
  assert.equal(els["lt-host-block"].hidden, false, "host block becomes visible");

  // Join with a 4-digit PIN → controller.joinAsVisitor("1234")
  els["lt-pin-input"].value = "1234";
  els["lt-join-btn"].fire("click");
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls.join, "1234", "Join should pass the sanitized 4-digit PIN");
});

test("join rejects a non-4-digit PIN without calling the controller", () => {
  const { els, calls } = runGlue({ withController: true });
  els["lt-pin-input"].value = "12"; // too short
  els["lt-join-btn"].fire("click");
  assert.equal(calls.join, null, "short PIN must not reach the controller");
  assert.match(els["lt-guest-status"].textContent, /4-digit PIN/);
});

// Eligible-desktop environment defaults: the desktop-only collaboration
// gate (annoCollabEligible) must pass for the behavioral harnesses, so
// every default window carries fine-pointer + hover media queries and a
// desktop navigator identity. Gate tests override these.
const DESKTOP_MM = (q) => ({ matches: q === "(pointer: fine)" || q === "(hover: hover)" });
const desktopNav = (extra) =>
  Object.assign(
    {
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      platform: "Win32",
      maxTouchPoints: 0,
    },
    extra || {},
  );

// ── 4. Connected-controller harness (Host + Guest) ───────────────────────
function makeConnectedController(role, spy) {
  // Stroke spies are optional extras (some tests pass only teleport/share);
  // default them so the pointer tests can assert ink.
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
    sendClear: () => {
      (spy.clear || (spy.clear = [])).push(true);
      return true;
    },
    sendNavLock: (vk, locked) => {
      (spy.navlock || (spy.navlock = [])).push({ vk, locked });
      return true;
    },
    sendStrokeDelete: (vk, ids) => {
      (spy.deletes || (spy.deletes = [])).push({ vk, ids: ids.slice() });
      return true;
    },
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
    matchMedia: DESKTOP_MM,
  };
  const navigator = desktopNav();
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
    matchMedia: DESKTOP_MM,
  };
  const navigator = desktopNav();
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
    matchMedia: DESKTOP_MM,
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
  fn(window, document, desktopNav(), () => makeConnectedController(role, spy), undefined);
  const fireDoc = (ev, payload) =>
    (document._h[ev] || []).forEach((f) =>
      f(Object.assign({ preventDefault() {}, target: null, key: "" }, payload || {})),
    );
  return { els, spy, fireDoc, canvas: els["anno-canvas"] };
}

test("fail closed without anno-input: the gate cannot verify, collaboration is fully disabled", () => {
  const { els, spy, fireDoc, canvas } = runGlueWithoutAnnoInput();
  // annoCollabEligible lives in the kernel; with the kernel absent the
  // desktop-only gate fails closed and neutralizes every affordance.
  assert.equal(els["lt-launch-btn"].hidden, true, "launch button neutralized");
  assert.equal(els["lt-panel"].hidden, true, "panel neutralized");
  assert.equal(els["anno-toolbar"].hidden, true, "toolbar neutralized");
  // No tool can engage and nothing reaches the controller.
  fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", touchEv(1, 100, 100));
  canvas.fire("pointermove", touchEv(1, 150, 150));
  canvas.fire("pointerup", touchEv(1, 150, 150));
  assert.equal(spy.begin.length, 0, "no stroke without the kernel");
  fireDoc("keydown", { key: "p" });
  assert.equal(canvas.classList.contains("pointer-mode"), false, "no tool wiring at all");
});

// ── 7. iOS clipboard isolation ────────────────────────────────────────────
// On iOS/iPadOS WebKit, navigator.clipboard.readText() raises the native
// Paste callout and interrupts annotation gestures. These tests prove the
// ambient location-sync system performs ZERO automatic readText calls on
// iOS-like navigators across every historical trigger.
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
      matchMedia: DESKTOP_MM,
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
    "Peer",
    BODY,
  );
  fn(window, document, nav, controllerFactory, undefined, undefined);
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

test("iOS (iPhone): ineligible — zero readText, no controller, every affordance neutralized", () => {
  const { calls, nav } = iphoneNav();
  const spy = { teleport: [], share: [] };
  let factoryCalls = 0;
  const h = runGlueWithNav(nav, () => {
    factoryCalls += 1;
    return makeConnectedController("visitor", spy);
  });
  // Every historical ambient trigger fires into a page with no collab wiring:
  const lb = h.document.getElementById("anno-letterbox-wrap");
  lb.fire("pointerenter", { pointerType: "mouse" });
  lb.fire("pointerenter", { pointerType: "touch" });
  h.fireWin("focus");
  h.fireDoc("visibilitychange");
  h.fireDoc("keydown", { key: "d" });
  const cv = h.document.getElementById("anno-canvas");
  cv.fire("pointerdown", touchEv(1, 100, 100));
  cv.fire("pointermove", touchEv(1, 200, 200));
  cv.fire("pointerup", touchEv(1, 200, 200));
  assert.equal(calls.readText, 0, "iOS must never auto-read the clipboard");
  assert.equal(factoryCalls, 0, "the session controller is never constructed");
  for (const id of ["lt-launch-btn", "lt-panel", "anno-toolbar", "anno-canvas", "loc-sync", "lt-audio"]) {
    assert.equal(h.document.getElementById(id).hidden, true, `#${id} neutralized`);
  }
});

test("iOS (iPad desktop mode, incl. trackpad): host/join are unreachable — desktop-only gate", () => {
  const { calls, nav } = ipadDesktopNav();
  let factoryCalls = 0;
  const h = runGlueWithNav(nav, () => {
    factoryCalls += 1;
    return makeController({ subscribe: 0, init: 0, join: null, dispose: 0, lastSubscriber: null });
  });
  // The buttons were neutralized and never wired — clicks are inert.
  h.document.getElementById("lt-host-start-btn").fire("click");
  h.document.getElementById("lt-pin-input").value = "1234";
  h.document.getElementById("lt-join-btn").fire("click");
  assert.equal(factoryCalls, 0, "the session controller is never constructed");
  assert.equal(calls.readText, 0, "no clipboard probe of any kind");
  assert.equal(h.document.getElementById("lt-launch-btn").hidden, true, "launch button neutralized");
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

// ── 8. Desktop-only gate parity + lazy PeerJS loader ─────────────────────
test("Android (ineligible): every affordance neutralized, no controller, no wiring", () => {
  const c = clipboardReadSpy();
  const nav = {
    platform: "Linux armv81",
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
    maxTouchPoints: 5,
    userAgentData: { mobile: true },
    clipboard: c.clipboard,
  };
  let factoryCalls = 0;
  const h = runGlueWithNav(
    nav,
    () => {
      factoryCalls += 1;
      return makeConnectedController("visitor", { teleport: [], share: [] });
    },
    { matchMedia: (q) => ({ matches: q === "(pointer: coarse)" }) },
  );
  assert.equal(factoryCalls, 0, "no session controller on Android");
  assert.equal(c.calls.readText, 0, "no clipboard work on Android");
  for (const id of ["lt-launch-btn", "lt-panel", "anno-toolbar", "anno-canvas", "loc-sync", "loc-sync-tips", "lt-audio", "remote-pointer", "lt-navlock"]) {
    assert.equal(h.document.getElementById(id).hidden, true, `#${id} neutralized`);
  }
});

test("eligible desktop: the launch button is revealed; no PeerJS work until Host intent", () => {
  const { nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const h = runGlueWithNav(nav, () => makeConnectedController("agent", spy));
  assert.equal(h.document.getElementById("lt-launch-btn").hidden, false, "launch button revealed");
  const injected = [];
  h.document.head = { appendChild: (n) => { injected.push(n); return n; } };
  assert.equal(injected.length, 0, "nothing injected at page load");
});

test("Host intent lazily injects ONE SRI-pinned PeerJS script (deduped across clicks)", () => {
  const { nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const h = runGlueWithNav(nav, () => makeConnectedController("agent", spy));
  const injected = [];
  h.document.head = { appendChild: (n) => { injected.push(n); return n; } };
  const cfg = h.document.getElementById("f3d-peerjs-loader");
  cfg.attrs["data-src"] = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";
  cfg.attrs["data-integrity"] = "sha384-TESTSRI";
  cfg.attrs["data-crossorigin"] = "anonymous";
  const host = h.document.getElementById("lt-host-start-btn");
  host.fire("click", { preventDefault() {} });
  host.fire("click", { preventDefault() {} });
  assert.equal(injected.length, 1, "concurrent Host clicks share ONE in-flight load");
  assert.equal(injected[0].src, "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js");
  assert.equal(injected[0].integrity, "sha384-TESTSRI", "SRI pin travels onto the injected tag");
  assert.equal(injected[0].crossOrigin, "anonymous");
});

test("PeerJS load failure surfaces a visible retry state and resets the dedupe", async () => {
  const { nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const h = runGlueWithNav(nav, () => makeConnectedController("agent", spy));
  const injected = [];
  h.document.head = { appendChild: (n) => { injected.push(n); return n; } };
  const cfg = h.document.getElementById("f3d-peerjs-loader");
  cfg.attrs["data-src"] = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";
  const host = h.document.getElementById("lt-host-start-btn");
  host.fire("click", { preventDefault() {} });
  assert.equal(injected.length, 1);
  injected[0].onerror(new Error("network"));
  await new Promise((r) => setTimeout(r, 0));
  assert.match(
    h.document.getElementById("lt-host-status").textContent,
    /could not load/i,
    "failure is visible on the host status line",
  );
  assert.equal(host.disabled, false, "Host re-enables for a retry");
  host.fire("click", { preventDefault() {} });
  assert.equal(injected.length, 2, "the next click retries with a fresh load");
});

// A head that records parentNode + supports removeChild, so the failed-script
// removal is observable (the injected[]-only heads above don't model detach).
function trackingHead() {
  const children = [];
  const head = {
    children,
    appendChild(n) { n.parentNode = head; children.push(n); return n; },
    removeChild(n) {
      const i = children.indexOf(n);
      if (i >= 0) children.splice(i, 1);
      if (n.parentNode === head) n.parentNode = null;
      return n;
    },
  };
  return head;
}

test("a failed PeerJS load is removed from the DOM with handlers detached; retry injects exactly one fresh script", async () => {
  const { nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const h = runGlueWithNav(nav, () => makeConnectedController("agent", spy));
  const head = trackingHead();
  h.document.head = head;
  const cfg = h.document.getElementById("f3d-peerjs-loader");
  cfg.attrs["data-src"] = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";
  const host = h.document.getElementById("lt-host-start-btn");

  host.fire("click", { preventDefault() {} });
  assert.equal(head.children.length, 1, "one script injected on Host intent");
  const first = head.children[0];

  first.onerror(new Error("network"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(head.children.length, 0, "the failed script is removed from the DOM");
  assert.equal(first.parentNode, null, "the failed script is detached from its parent");
  assert.equal(first.onload, null, "onload handler detached");
  assert.equal(first.onerror, null, "onerror handler detached");

  host.fire("click", { preventDefault() {} });
  assert.equal(head.children.length, 1, "retry injects exactly one fresh script (no stacking)");
  assert.notStrictEqual(head.children[0], first, "retry uses a brand-new <script> element");
});

test("a timed-out PeerJS load is removed and ignores a late load; retry injects exactly one fresh script", async () => {
  const { nav } = desktopGrantedNav();
  const spy = { teleport: [], share: [] };
  const h = runGlueWithNav(nav, () => makeConnectedController("agent", spy));
  const head = trackingHead();
  h.document.head = head;
  const cfg = h.document.getElementById("f3d-peerjs-loader");
  cfg.attrs["data-src"] = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";
  const host = h.document.getElementById("lt-host-start-btn");

  // Capture the loader's 12s watchdog without waiting on the wall clock.
  const realSetTimeout = globalThis.setTimeout;
  let watchdog = null;
  globalThis.setTimeout = (cb, ms) => { if (ms === 12000) { watchdog = cb; return 4242; } return realSetTimeout(cb, ms); };
  let first;
  try {
    host.fire("click", { preventDefault() {} });
    assert.equal(head.children.length, 1, "one script injected on Host intent");
    assert.equal(typeof watchdog, "function", "the loader armed a 12s watchdog");
    first = head.children[0];
    watchdog(); // simulate the timeout firing
    assert.equal(head.children.length, 0, "the timed-out script is removed from the DOM");
    assert.equal(first.onload, null, "late load is inert: onload handler detached");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
  await new Promise((r) => realSetTimeout(r, 0));
  host.fire("click", { preventDefault() {} });
  assert.equal(head.children.length, 1, "retry injects exactly one fresh script (no stacking)");
  assert.notStrictEqual(head.children[0], first, "retry uses a brand-new <script> element");
});

// ── Shared sequential annotation + Eraser (gesture floor) — Builder parity ──
// Pointer events carry a preventDefault stub (the glue calls it on owned moves).
const aev = (id, x, y) => ({ pointerId: id, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, preventDefault() {} });
function wiredAtlasGlue(role) {
  const spy = { teleport: [], share: [] };
  const wired = subscribeFiring(makeConnectedController(role || "agent", spy));
  const h = runGlueWithNav(desktopGrantedNav().nav, () => wired.controller);
  const emit = (patch) => wired.emit(Object.assign({}, wired.controller.getState(), patch || {}));
  return { h, spy, emit, canvas: h.canvas, fireDoc: h.fireDoc };
}

test("atlas shared scene: a local stroke and a remote stroke coexist; either peer can erase either", () => {
  const { h, spy, emit, canvas } = wiredAtlasGlue("agent");
  h.fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", aev(1, 128, 72));
  canvas.fire("pointermove", aev(1, 256, 144));
  canvas.fire("pointerup", aev(1, 256, 144));
  assert.equal(spy.commit.length, 1, "local stroke committed");
  const localId = spy.begin[0].sid;
  emit({ incomingStrokeEvent: { kind: "begin", viewKey: "", seq: 1, strokeId: "remote1", points: [[0.6, 0.6], [0.7, 0.7]] } });
  emit({ incomingStrokeEvent: { kind: "commit", viewKey: "", seq: 2, strokeId: "remote1" } });
  h.fireDoc("keydown", { key: "e" });
  canvas.fire("pointerdown", aev(2, 832, 468)); canvas.fire("pointerup", aev(2, 832, 468)); // remote1
  canvas.fire("pointerdown", aev(3, 192, 108)); canvas.fire("pointerup", aev(3, 192, 108)); // local
  const deleted = (spy.deletes || []).map((d) => d.ids).flat();
  assert.ok(deleted.includes("remote1"), "peer-authored stroke erasable");
  assert.ok(deleted.includes(localId), "locally-authored stroke erasable");
});

test("atlas sequential annotation: a peer gesture blocks a new local stroke until it ends", () => {
  const { h, spy, emit, canvas } = wiredAtlasGlue("agent");
  emit({ incomingNavLockEvent: { viewKey: "", locked: true, seq: 1, ts: 1 } });
  h.fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", aev(1, 128, 72));
  assert.equal(spy.begin.length, 0, "no local stroke while the peer holds the floor");
  emit({ incomingNavLockEvent: { viewKey: "", locked: false, seq: 2, ts: 2 } });
  canvas.fire("pointerdown", aev(2, 128, 72));
  canvas.fire("pointermove", aev(2, 256, 144));
  canvas.fire("pointerup", aev(2, 256, 144));
  assert.equal(spy.begin.length, 1, "free the instant the peer's gesture ends");
});

test("atlas local floor releases on pointerup, pointercancel, and tool change", () => {
  const { h, spy, canvas } = wiredAtlasGlue("agent");
  const locks = () => (spy.navlock || []).map((n) => n.locked);
  h.fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", aev(1, 128, 72));
  assert.deepEqual(locks(), [true]);
  canvas.fire("pointerup", aev(1, 128, 72));
  assert.deepEqual(locks(), [true, false], "pointerup releases");
  canvas.fire("pointerdown", aev(2, 128, 72));
  canvas.fire("pointercancel", aev(2, 128, 72));
  assert.deepEqual(locks(), [true, false, true, false], "pointercancel releases");
  canvas.fire("pointerdown", aev(3, 128, 72));
  h.fireDoc("keydown", { key: "p" });
  assert.deepEqual(locks(), [true, false, true, false, true, false], "tool change releases");
});

test("atlas near-simultaneous starts resolve safely: in-flight completes, then sequential", () => {
  const { h, spy, emit, canvas } = wiredAtlasGlue("agent");
  h.fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", aev(1, 128, 72));
  assert.equal(spy.begin.length, 1);
  emit({ incomingNavLockEvent: { viewKey: "", locked: true, seq: 1, ts: 1 } });
  canvas.fire("pointermove", aev(1, 256, 144));
  canvas.fire("pointerup", aev(1, 256, 144));
  assert.equal(spy.commit.length, 1, "in-flight stroke completes, no corruption");
  canvas.fire("pointerdown", aev(2, 128, 72));
  assert.equal(spy.begin.length, 1, "new stroke blocked while peer holds the floor");
  emit({ incomingNavLockEvent: { viewKey: "", locked: false, seq: 2, ts: 2 } });
});

test("atlas eraser drag removes each intersected committed stroke exactly once", () => {
  const { h, spy, canvas } = wiredAtlasGlue("agent");
  h.fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", aev(1, 128, 72)); canvas.fire("pointermove", aev(1, 160, 72)); canvas.fire("pointerup", aev(1, 160, 72));
  const a = spy.begin[0].sid;
  canvas.fire("pointerdown", aev(2, 640, 72)); canvas.fire("pointermove", aev(2, 672, 72)); canvas.fire("pointerup", aev(2, 672, 72));
  const b = spy.begin[1].sid;
  h.fireDoc("keydown", { key: "e" });
  canvas.fire("pointerdown", aev(3, 128, 72));
  canvas.fire("pointermove", aev(3, 144, 72)); // still over A → no re-delete
  canvas.fire("pointermove", aev(3, 640, 72)); // over B
  canvas.fire("pointerup", aev(3, 640, 72));
  const deleted = (spy.deletes || []).map((d) => d.ids).flat();
  assert.deepEqual(deleted.slice().sort(), [a, b].sort(), "each stroke deleted exactly once");
});

test("atlas eraser skips an in-flight (uncommitted) remote stroke, then erases it once committed", () => {
  const { h, spy, emit, canvas } = wiredAtlasGlue("agent");
  emit({ incomingStrokeEvent: { kind: "begin", viewKey: "", seq: 1, strokeId: "r1", points: [[0.3, 0.3], [0.4, 0.4]] } });
  h.fireDoc("keydown", { key: "e" });
  canvas.fire("pointerdown", aev(1, 448, 252)); canvas.fire("pointerup", aev(1, 448, 252));
  assert.equal((spy.deletes || []).length, 0, "uncommitted remote stroke not erasable");
  emit({ incomingStrokeEvent: { kind: "commit", viewKey: "", seq: 2, strokeId: "r1" } });
  canvas.fire("pointerdown", aev(2, 448, 252)); canvas.fire("pointerup", aev(2, 448, 252));
  assert.deepEqual((spy.deletes || []).map((d) => d.ids).flat(), ["r1"], "erasable once committed");
});

test("atlas inbound stroke_delete removes the matching stroke; unknown ids are a no-op", () => {
  const { h, spy, emit, canvas } = wiredAtlasGlue("agent");
  h.fireDoc("keydown", { key: "d" });
  canvas.fire("pointerdown", aev(1, 128, 72)); canvas.fire("pointermove", aev(1, 256, 144)); canvas.fire("pointerup", aev(1, 256, 144));
  const a = spy.begin[0].sid;
  emit({ incomingStrokeDeleteEvent: { viewKey: "", seq: 1, strokeIds: [a], ts: 1 } });
  emit({ incomingStrokeDeleteEvent: { viewKey: "", seq: 2, strokeIds: ["ghost"], ts: 2 } });
  h.fireDoc("keydown", { key: "e" });
  canvas.fire("pointerdown", aev(2, 192, 108)); canvas.fire("pointerup", aev(2, 192, 108));
  assert.equal((spy.deletes || []).length, 0, "A already removed by the inbound delete");
});

test("atlas remote floor auto-clears on the bounded safety timeout", () => {
  const realSetTimeout = globalThis.setTimeout;
  let floorTimer = null;
  globalThis.setTimeout = (cb, ms) => { if (ms === 8000) { floorTimer = cb; return 7777; } return realSetTimeout(cb, ms); };
  try {
    const { h, spy, emit, canvas } = wiredAtlasGlue("agent");
    emit({ incomingNavLockEvent: { viewKey: "", locked: true, seq: 1, ts: 1 } });
    h.fireDoc("keydown", { key: "d" });
    canvas.fire("pointerdown", aev(1, 128, 72));
    assert.equal(spy.begin.length, 0, "blocked while peer holds the floor");
    assert.equal(typeof floorTimer, "function", "safety timeout armed");
    floorTimer();
    canvas.fire("pointerdown", aev(2, 128, 72));
    canvas.fire("pointermove", aev(2, 256, 144));
    canvas.fire("pointerup", aev(2, 256, 144));
    assert.equal(spy.begin.length, 1, "safety timeout frees this side");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("atlas long ACTIVE gesture keeps the floor: owned moves refresh the watchdog (no mid-gesture release)", () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let armed = 0;
  globalThis.setTimeout = (cb, ms) => { if (ms === 8000) { armed += 1; return 1000 + armed; } return realSetTimeout(cb, ms); };
  globalThis.clearTimeout = (id) => { if (typeof id === "number" && id >= 1000) return; return realClearTimeout(id); };
  try {
    const { h, spy, canvas } = wiredAtlasGlue("agent");
    h.fireDoc("keydown", { key: "d" });
    canvas.fire("pointerdown", aev(1, 128, 72));        // acquire → arm #1
    assert.equal(armed, 1, "watchdog armed on gesture start");
    canvas.fire("pointermove", aev(1, 160, 100));       // activity → re-arm
    canvas.fire("pointermove", aev(1, 200, 140));       // activity → re-arm
    assert.ok(armed >= 3, "owned moves refresh (re-arm) the safety watchdog");
    assert.deepEqual((spy.navlock || []).map((n) => n.locked), [true], "floor still held — no spurious release mid-gesture");
    canvas.fire("pointerup", aev(1, 200, 140));
    assert.deepEqual((spy.navlock || []).map((n) => n.locked), [true, false], "released only on pointerup");
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});
