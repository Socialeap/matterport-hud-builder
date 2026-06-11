#!/usr/bin/env node

// U0 — BEHAVIORAL coverage for the Builder/portal live-tour glue.
//
// The Builder glue lives inside the giant template literal in
// portal.functions.ts (it has natural access to `frame`/config there), so we
// EXTRACT it for testing using the f3d:runtime-js:glue sentinels, un-escape
// the template-literal escapes, inject the REAL anno-input.mjs kernel + a fake
// createLiveSession, and run it against a hand-rolled fake DOM — the same
// technique tests/atlas-live-tour.test.mjs uses against its standalone .mjs.
// This exercises the genuine pointer guard + WebKit defenses, not a stub.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripExports } from "../src/lib/portal/ask-runtime-transformer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(__dirname, "..", ...p), "utf8");
const PORTAL = read("src", "lib", "portal.functions.ts");
const ANNO_INPUT = stripExports(read("src", "lib", "portal", "anno-input.mjs"));

// ── Extract the glue between its sentinels and make it runnable ───────────
function sliceBetween(src, beginNeedle, endNeedle) {
  const a = src.indexOf(beginNeedle);
  const b = src.indexOf(endNeedle, a);
  assert.ok(a !== -1 && b !== -1, `sentinels ${beginNeedle} / ${endNeedle} must exist`);
  // From the end of the BEGIN line to the start of the END line.
  const from = src.indexOf("\n", a) + 1;
  return src.slice(from, b);
}
// Un-escape the template-literal escapes (\\ → \, \` → `, \${ → ${) and
// neutralize any leftover ${...} interpolation, mirroring verify-portal-html's
// parseRuntimeIIFE so the extracted JS parses and runs as real code.
function deTemplate(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    if (src[i] === "$" && src[i + 1] === "{") {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") depth -= 1;
        if (depth === 0) break;
        i += 1;
      }
      i += 1;
      out += "null";
      continue;
    }
    if (src[i] === "\\" && (src[i + 1] === "$" || src[i + 1] === "`" || src[i + 1] === "\\")) {
      out += src[i + 1];
      i += 2;
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}
const GLUE = deTemplate(
  sliceBetween(PORTAL, "// f3d:runtime-js:glue BEGIN", "// f3d:runtime-js:glue END"),
);
// The package's OUTER IIFE provides a few locals the live-guide glue closes
// over: the property list + current index (renderStops / teleport) — stub the
// data ones so onState runs end-to-end. (`frame` is supplied as a Function
// param below.)
const OUTER_STUBS = 'var props=[{ name:"Canary", iframeUrl:"", liveTourStops:[] }]; var current=0;';
// anno-input kernel defines the guard/coalesce/clamp helpers as locals; the
// glue (a nested IIFE) closes over all of these exactly as it does in the
// package.
const BODY = OUTER_STUBS + "\n" + ANNO_INPUT + "\n" + GLUE;

test("the extracted Builder glue parses cleanly with the real kernel", () => {
  assert.doesNotThrow(() => {
    // eslint-disable-next-line no-new-func
    new Function("window", "document", "navigator", "createLiveSession", "ResizeObserver", "frame", BODY);
  });
});

// ── Fake DOM ──────────────────────────────────────────────────────────────
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
}
FakeEl.prototype.addEventListener = function (ev, fn) {
  (this._h[ev] || (this._h[ev] = [])).push(fn);
};
FakeEl.prototype.removeEventListener = function () {};
FakeEl.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
FakeEl.prototype.getAttribute = function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; };
FakeEl.prototype.querySelector = function () { return null; };
FakeEl.prototype.querySelectorAll = function () { return []; };
FakeEl.prototype.appendChild = function (c) { return c; };
FakeEl.prototype.getContext = function () {
  if (!this._ctx) {
    const noop = () => {};
    this._ctx = { clearRect: noop, setTransform: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, arc: noop, fill: noop };
  }
  return this._ctx;
};
FakeEl.prototype.setPointerCapture = function (id) { this._captured = id; };
FakeEl.prototype.releasePointerCapture = function (id) { if (this._captured === id) this._captured = null; };
FakeEl.prototype.focus = function () {};
FakeEl.prototype.getBoundingClientRect = function () { return { left: 0, top: 0, width: 1280, height: 720 }; };
FakeEl.prototype.fire = function (ev, e) { (this._h[ev] || []).forEach((f) => f(e)); };

function makeFakeDom() {
  const els = Object.create(null);
  const document = {
    _h: Object.create(null),
    getElementById(id) {
      if (!els[id]) els[id] = new FakeEl(id);
      return els[id];
    },
    querySelectorAll() { return []; },
    createElement(tag) { return new FakeEl(tag); },
    addEventListener(ev, fn) { (this._h[ev] || (this._h[ev] = [])).push(fn); },
    body: { classList: fakeClassList() },
    hidden: false,
    activeElement: null,
  };
  return { els, document };
}

// Connected controller with stroke spies (agent role → keyboard hotkeys work).
function makeConnectedController(role, spy) {
  const state = {
    role, status: "connected", pin: "1234", peerId: "peer", error: null,
    isConnected: true, remoteStream: null, voiceCallActive: false,
    incomingTeleportEvent: null, incomingPointerEvent: null, incomingStrokeEvent: null,
    incomingClearEvent: null, incomingNavLockEvent: null, incomingLocationShareEvent: null,
  };
  return {
    getState: () => state,
    subscribe: () => () => {},
    initializeAsAgent: () => Promise.resolve({ pin: "1234", peerId: "host" }),
    joinAsVisitor: (pin) => Promise.resolve({ pin, peerId: "guest" }),
    teleportVisitor: () => true,
    shareLocationWithAgent: () => true,
    sendPointer: () => true,
    sendStrokeBegin: (vk, sid, color, width, points) => {
      spy.begin.push({ sid, points: Array.isArray(points) ? points.map((p) => p.slice()) : [] });
      return true;
    },
    sendStrokePatch: (vk, sid, points) => {
      spy.patch.push({ sid, points: Array.isArray(points) ? points.map((p) => p.slice()) : [] });
      return true;
    },
    sendStrokeCommit: (vk, sid) => { spy.commit.push(sid); return true; },
    sendClear: () => { (spy.clear || (spy.clear = [])).push(true); return true; },
    sendNavLock: (vk, locked) => { (spy.navlock || (spy.navlock = [])).push({ vk, locked }); return true; },
    sendStrokeDelete: (vk, ids) => { (spy.deletes || (spy.deletes = [])).push({ vk, ids: ids.slice() }); return true; },
    dispose: () => {},
  };
}

function runGlue(role = "agent", opts = {}) {
  const spy = { begin: [], patch: [], commit: [], posts: [] };
  const { els, document } = makeFakeDom();
  const window = {
    addEventListener() {},
    requestAnimationFrame: (cb) => { cb(); return 0; },
    devicePixelRatio: 2,
    location: { href: "https://example.com/test/" },
    // Default harness environment: an ELIGIBLE desktop (fine primary
    // pointer + hover, no mobile identity) so the collaboration glue
    // wires up. Gate tests below override window/navigator to simulate
    // ineligible devices.
    matchMedia: (q) => ({ matches: q === "(pointer: fine)" || q === "(hover: hover)" }),
  };
  // Embedding context: a DISTINCT parent (the Atlas modal) records postMessage;
  // direct viewing (default) has parent === self, so the interaction emit is a
  // no-op and direct standalone viewing is unaffected.
  window.parent = opts.embedded
    ? { postMessage: (msg, origin) => spy.posts.push({ msg, origin }) }
    : window;
  if (opts.window) Object.assign(window, opts.window);
  const navigator = opts.navigator || {
    // Desktop identity; deliberately no clipboard — exercises the graceful guards.
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
    platform: "Win32",
    maxTouchPoints: 0,
  };
  const frame = new FakeEl("matterport-frame");
  spy.factoryCalls = 0;
  let _controller = null;
  let _push = null;
  const controllerFactory = () => {
    spy.factoryCalls += 1;
    const c = makeConnectedController(role, spy);
    _controller = c;
    // Capture the glue's onState subscriber so tests can push inbound
    // (remote-peer) state — strokes, nav_lock floor, stroke_delete.
    if (opts.fireConnect || opts.wireRemote) {
      const sub = c.subscribe;
      c.subscribe = (fn) => { _push = fn; fn(c.getState()); return sub(fn); };
    }
    return c;
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function("window", "document", "navigator", "createLiveSession", "ResizeObserver", "frame", BODY);
  fn(window, document, navigator, controllerFactory, undefined, frame);
  const fireDoc = (ev, payload) =>
    (document._h[ev] || []).forEach((f) => f(Object.assign({ preventDefault() {}, target: null, key: "" }, payload || {})));
  // emit(patch): push a new controller state (base merged with patch) through
  // the captured onState subscriber. Requires opts.wireRemote.
  const emit = (patch) => { if (_push && _controller) _push(Object.assign({}, _controller.getState(), patch || {})); };
  return { els, spy, fireDoc, emit, canvas: els["anno-canvas"], letterbox: els["anno-letterbox-wrap"], document };
}

// Event factory with a preventDefault spy.
function ev(id, x, y, type, extra) {
  return Object.assign(
    { pointerId: id, pointerType: type || "touch", isPrimary: true, clientX: x, clientY: y, _prevented: false, preventDefault() { this._prevented = true; } },
    extra || {},
  );
}
const enterDraw = (h) => h.fireDoc("keydown", { key: "d" });
const enterRope = (h) => h.fireDoc("keydown", { key: "r" });

// ── 1. Touch draw: coalesced patch, clean commit, capture released ───────
test("touch draw: down begins, coalesced moves patch, up commits, capture released", () => {
  const h = runGlue();
  enterDraw(h);
  const down = ev(1, 128, 72);
  h.canvas.fire("pointerdown", down);
  assert.equal(h.spy.begin.length, 1, "stroke_begin on pointerdown");
  assert.equal(h.canvas._captured, 1, "pointer captured");
  assert.ok(down._prevented, "owned pointerdown prevents default");
  const move = ev(1, 256, 144, "touch", { getCoalescedEvents: () => [ev(1, 192, 108), ev(1, 256, 144)] });
  h.canvas.fire("pointermove", move);
  assert.equal(h.spy.patch.length, 1, "patch flushed synchronously via rAF");
  assert.equal(h.spy.patch[0].points.length, 2, "both coalesced samples ride the patch");
  assert.ok(move._prevented, "owned pointermove prevents default");
  h.canvas.fire("pointerup", ev(1, 256, 144));
  assert.deepEqual(h.spy.commit, [h.spy.begin[0].sid], "commit on pointerup");
  assert.equal(h.canvas._captured, null, "capture released");
});

// ── 2. Single-owner guard: a second finger can't start or corrupt ────────
test("a second finger neither starts nor corrupts an active stroke", () => {
  const h = runGlue();
  enterDraw(h);
  h.canvas.fire("pointerdown", ev(1, 100, 100));
  assert.equal(h.spy.begin.length, 1);
  h.canvas.fire("pointerdown", ev(2, 600, 600, "touch", { isPrimary: false }));
  assert.equal(h.spy.begin.length, 1, "second finger must not open a stroke");
  h.canvas.fire("pointermove", ev(2, 640, 640, "touch", { isPrimary: false }));
  assert.equal(h.spy.patch.length, 0, "second finger must not append points");
  h.canvas.fire("pointerup", ev(2, 640, 640, "touch", { isPrimary: false }));
  assert.equal(h.spy.commit.length, 0, "second finger must not commit");
  h.canvas.fire("pointerup", ev(1, 100, 100));
  assert.equal(h.spy.commit.length, 1, "owner commit still clean");
});

// ── 3. Pencil takeover from a palm touch ─────────────────────────────────
test("Pencil takes over from a palm touch: touch commits, pen draws fresh", () => {
  const h = runGlue();
  enterDraw(h);
  h.canvas.fire("pointerdown", ev(1, 100, 100));
  assert.equal(h.spy.begin.length, 1);
  h.canvas.fire("pointerdown", ev(2, 300, 300, "pen"));
  assert.equal(h.spy.commit.length, 1, "palm stroke committed before the pen claims");
  assert.equal(h.spy.begin.length, 2, "pen opens its own stroke");
  h.canvas.fire("pointermove", ev(1, 110, 110));
  assert.equal(h.spy.patch.length, 0, "displaced palm touch is inert");
  h.canvas.fire("pointerup", ev(2, 320, 320, "pen"));
  assert.equal(h.spy.commit.length, 2, "pen stroke commits");
});

// ── 4. pointercancel + lostpointercapture ordering, no double commit ─────
test("pointercancel finalizes the stroke and a fresh gesture starts clean", () => {
  const h = runGlue();
  enterDraw(h);
  h.canvas.fire("pointerdown", ev(1, 100, 100));
  h.canvas.fire("pointermove", ev(1, 150, 150));
  h.canvas.fire("pointercancel", ev(1, 150, 150));
  assert.equal(h.spy.commit.length, 1, "cancel commits (no orphan stroke)");
  assert.equal(h.canvas._captured, null, "capture released on cancel");
  h.canvas.fire("pointermove", ev(1, 400, 400));
  assert.equal(h.spy.patch.length, 1, "no ink after cancel (pointer no longer owned)");
  h.canvas.fire("pointerdown", ev(1, 200, 200));
  assert.equal(h.spy.begin.length, 2, "a new stroke opens after a cancel");
});

test("lostpointercapture after a normal pointerup is a no-op (no double commit)", () => {
  const h = runGlue();
  enterDraw(h);
  h.canvas.fire("pointerdown", ev(1, 100, 100));
  h.canvas.fire("pointerup", ev(1, 120, 120));
  assert.equal(h.spy.commit.length, 1);
  h.canvas.fire("lostpointercapture", ev(1, 120, 120));
  assert.equal(h.spy.commit.length, 1, "the browser-fired lostpointercapture must not re-commit");
});

test("lostpointercapture BEFORE pointerup finalizes once; the late pointerup is inert", () => {
  const h = runGlue();
  enterDraw(h);
  h.canvas.fire("pointerdown", ev(1, 100, 100));
  h.canvas.fire("pointermove", ev(1, 150, 150));
  h.canvas.fire("lostpointercapture", ev(1, 150, 150));
  assert.equal(h.spy.commit.length, 1, "lost capture finalizes the stroke once");
  const patchesAtAbort = h.spy.patch.length;
  h.canvas.fire("pointerup", ev(1, 160, 160));
  assert.equal(h.spy.commit.length, 1, "trailing pointerup must not double-commit");
  assert.equal(h.spy.begin.length, 1, "trailing pointerup must not open a stroke");
  assert.equal(h.spy.patch.length, patchesAtAbort, "trailing pointerup must not add ink");
});

// ── 5. Focus Rope body drag ──────────────────────────────────────────────
test("Focus Rope: body drag moves the whole rope; the latch keeps resizing", () => {
  const h = runGlue();
  enterRope(h);
  h.canvas.fire("pointerdown", ev(1, 100, 100));
  h.canvas.fire("pointermove", ev(1, 400, 300));
  h.canvas.fire("pointerup", ev(1, 400, 300));
  const baseline = h.spy.begin[h.spy.begin.length - 1];
  const minX = (entry) => Math.min(...entry.points.map((p) => p[0]));
  // Grab inside the body (well away from the bottom-right latch) and drag +50px.
  h.canvas.fire("pointerdown", ev(1, 200, 200));
  h.canvas.fire("pointermove", ev(1, 250, 200));
  h.canvas.fire("pointerup", ev(1, 250, 200));
  const moved = h.spy.begin[h.spy.begin.length - 1];
  assert.equal(moved.sid, baseline.sid, "moving re-flushes the SAME rope stroke");
  assert.ok(Math.abs(minX(moved) - minX(baseline) - 50 / 1280) < 1e-6, "rope translated by the drag delta (50px → 50/1280)");
  assert.equal(h.spy.commit.length, 0, "rope stays active (sealed on tool exit, not on drag end)");
});

// ── 6. Conditional anno-tool-active body class ───────────────────────────
test("the anno-tool-active body class tracks tool engagement", () => {
  const h = runGlue();
  assert.equal(h.document.body.classList.contains("anno-tool-active"), false, "inactive at rest");
  enterDraw(h);
  assert.equal(h.document.body.classList.contains("anno-tool-active"), true, "engages with Draw");
  h.fireDoc("keydown", { key: "Escape" });
  assert.equal(h.document.body.classList.contains("anno-tool-active"), false, "released on tool exit — Matterport nav untouched again");
});

// ── 7. WebKit touch suppression is scoped to an active gesture ────────────
test("non-passive touch handlers preventDefault only while Draw/Rope is active", () => {
  const h = runGlue();
  // Idle: a raw touch on the canvas is NOT suppressed (Matterport gets it).
  const idle = ev(1, 100, 100);
  h.canvas.fire("touchstart", idle);
  assert.equal(idle._prevented, false, "idle touch is not suppressed");
  // Draw active: the raw touch sequence is swallowed at the canvas.
  enterDraw(h);
  const active = ev(1, 100, 100);
  h.canvas.fire("touchstart", active);
  assert.ok(active._prevented, "touch suppressed during a gesture");
  const activeMove = ev(1, 120, 120);
  h.canvas.fire("touchmove", activeMove);
  assert.ok(activeMove._prevented, "touchmove suppressed during a gesture");
});

// ── 8. Idle = normal Matterport navigation (nothing intercepted) ─────────
test("idle (no tool): pointer + stage events are not intercepted, so Matterport navigation is normal", () => {
  const h = runGlue(); // no tool selected → toolMode "none"
  const down = ev(1, 100, 100);
  h.canvas.fire("pointerdown", down);
  assert.equal(h.spy.begin.length, 0, "no stroke opens when idle");
  assert.equal(down._prevented, false, "idle pointerdown does not preventDefault");
  assert.equal(h.canvas._captured, undefined, "idle pointerdown does not capture");
  const menu = ev(0, 0, 0, "mouse");
  h.letterbox.fire("contextmenu", menu);
  assert.equal(menu._prevented, false, "context menu allowed when idle");
  const sel = ev(0, 0, 0, "mouse");
  h.letterbox.fire("selectstart", sel);
  assert.equal(sel._prevented, false, "selection allowed when idle");
});

test("stage events ARE killed while a tool is active", () => {
  const h = runGlue();
  enterDraw(h);
  const menu = ev(0, 0, 0, "mouse");
  h.letterbox.fire("contextmenu", menu);
  assert.ok(menu._prevented, "context menu blocked during annotation");
});

// ── 9. Runtime 2.0.3 interaction signal — parity, parent-only, direct-safe ─
const hasInteractionPost = (h) =>
  h.spy.posts.some((p) => p.msg && p.msg.type === "f3d:interaction-active");

test("Pointer / Draw / Focus Rope each post f3d:interaction-active to a distinct parent", () => {
  for (const key of ["p", "d", "r"]) {
    const h = runGlue("agent", { embedded: true });
    h.fireDoc("keydown", { key });
    assert.ok(hasInteractionPost(h), `tool '${key}' must signal the embedding app`);
    assert.equal(h.spy.posts[0].origin, "*", "posts on the f3d: namespace with a permissive target (parent origin-checks)");
  }
});

test("a first live-session connect posts f3d:interaction-active to the parent", () => {
  const h = runGlue("agent", { embedded: true, fireConnect: true });
  assert.ok(hasInteractionPost(h), "connect must signal the embedding app");
});

test("direct standalone viewing (no distinct parent) posts NOTHING — viewing is unaffected", () => {
  const h = runGlue("agent", { fireConnect: true }); // parent === self
  h.fireDoc("keydown", { key: "p" });
  h.fireDoc("keydown", { key: "d" });
  h.fireDoc("keydown", { key: "r" });
  assert.equal(h.spy.posts.length, 0, "a directly-opened presentation must never postMessage to itself");
});

// ── 10. Desktop-only Live Tour gate (annoCollabEligible) ─────────────────
// Ineligible devices must end up with NO collaboration affordance, NO
// session controller, NO PeerJS work and NO wired collaboration handlers.
// (In a real DOM the nodes are removed entirely; the fake DOM has no
// parentNode, so the glue's fallback hides them instead.)
const COLLAB_AFFORDANCE_IDS = [
  "hud-live-tour-btn",
  "live-tour-drawer",
  "live-tour-control-drawer",
  "drawer-live-guide",
  "loc-sync",
  "loc-sync-tips",
  "live-tour-navlock",
  "anno-toolbar",
  "anno-canvas",
  "remote-pointer",
  "lg-audio",
];

const IPAD_TRACKPAD_ENV = {
  navigator: {
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15",
    platform: "MacIntel",
    maxTouchPoints: 5,
  },
  // The paired trackpad reports a fine pointer — the gate must still refuse.
  window: { matchMedia: (q) => ({ matches: q === "(pointer: fine)" || q === "(hover: hover)" }) },
};
const IPHONE_ENV = {
  navigator: {
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    platform: "iPhone",
    maxTouchPoints: 5,
  },
  window: { matchMedia: (q) => ({ matches: q === "(pointer: coarse)" }) },
};
const ANDROID_ENV = {
  navigator: {
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36",
    platform: "Linux armv81",
    maxTouchPoints: 5,
    userAgentData: { mobile: true },
  },
  window: { matchMedia: (q) => ({ matches: q === "(pointer: coarse)" }) },
};

for (const [label, env] of [
  ["iPhone", IPHONE_ENV],
  ["Android", ANDROID_ENV],
  ["iPad with trackpad (fine pointer)", IPAD_TRACKPAD_ENV],
]) {
  test(`ineligible (${label}): every collaboration affordance is neutralized, nothing initializes`, () => {
    const h = runGlue("agent", env);
    for (const id of COLLAB_AFFORDANCE_IDS) {
      assert.equal(h.els[id].hidden, true, `#${id} must be neutralized`);
    }
    assert.equal(h.spy.factoryCalls, 0, "createLiveSession must never be constructed");
    // No collaboration handlers were wired anywhere.
    assert.equal((h.document.getElementById("lg-join-btn")._h.click || []).length, 0, "Join is not wired");
    assert.equal((h.document.getElementById("lg-start-btn")._h.click || []).length, 0, "Start is not wired");
    assert.equal((h.canvas._h.pointerdown || []).length, 0, "annotation canvas is not wired");
    // Tool hotkeys do nothing (no document-level collab listeners ran).
    h.fireDoc("keydown", { key: "d" });
    assert.equal(h.spy.begin.length, 0, "Draw cannot engage");
  });
}

test("eligible desktop: the gated launch affordances are revealed and wired", () => {
  const h = runGlue("agent");
  assert.equal(h.document.getElementById("drawer-live-guide").hidden, false, "live-guide section revealed");
  assert.equal(h.document.getElementById("hud-live-tour-btn").hidden, false, "HUD Live Tour button revealed");
  assert.equal(h.spy.factoryCalls, 1, "session controller constructed once");
  assert.ok((h.document.getElementById("lg-join-btn")._h.click || []).length > 0, "Join wired");
  assert.ok((h.document.getElementById("lg-start-btn")._h.click || []).length > 0, "Start wired");
});

// ── 11. Lazy PeerJS loader (pinned + SRI, intent-gated, deduped) ─────────
test("no PeerJS work happens at page load; Start triggers exactly one SRI-pinned injection (deduped)", () => {
  const injected = [];
  const h = runGlue("agent");
  h.document.head = { appendChild: (n) => { injected.push(n); return n; } };
  // Seed the inert loader config exactly as the generated head carries it.
  const cfg = h.document.getElementById("f3d-peerjs-loader");
  cfg.attrs["data-src"] = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";
  cfg.attrs["data-integrity"] = "sha384-TESTSRI";
  cfg.attrs["data-crossorigin"] = "anonymous";
  assert.equal(injected.length, 0, "nothing injected at page load");
  h.document.getElementById("lg-start-btn").fire("click", { preventDefault() {} });
  h.document.getElementById("lg-start-btn").fire("click", { preventDefault() {} });
  assert.equal(injected.length, 1, "concurrent Start clicks share ONE in-flight load");
  assert.equal(injected[0].src, "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js");
  assert.equal(injected[0].integrity, "sha384-TESTSRI", "SRI pin travels onto the injected tag");
  assert.equal(injected[0].crossOrigin, "anonymous");
});

test("PeerJS load failure surfaces a visible retry state and resets the dedupe", async () => {
  const injected = [];
  const h = runGlue("agent");
  h.document.head = { appendChild: (n) => { injected.push(n); return n; } };
  const cfg = h.document.getElementById("f3d-peerjs-loader");
  cfg.attrs["data-src"] = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";
  h.document.getElementById("lg-start-btn").fire("click", { preventDefault() {} });
  assert.equal(injected.length, 1);
  injected[0].onerror(new Error("network"));
  await new Promise((r) => setTimeout(r, 0));
  assert.match(h.document.getElementById("lg-agent-status").textContent, /could not load/i, "failure is visible");
  assert.equal(h.document.getElementById("lg-start-btn").disabled, false, "Start re-enables for a retry");
  h.document.getElementById("lg-start-btn").fire("click", { preventDefault() {} });
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
  const h = runGlue("agent");
  const head = trackingHead();
  h.document.head = head;
  const cfg = h.document.getElementById("f3d-peerjs-loader");
  cfg.attrs["data-src"] = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";

  h.document.getElementById("lg-start-btn").fire("click", { preventDefault() {} });
  assert.equal(head.children.length, 1, "one script injected on Host intent");
  const first = head.children[0];

  first.onerror(new Error("network"));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(head.children.length, 0, "the failed script is removed from the DOM");
  assert.equal(first.parentNode, null, "the failed script is detached from its parent");
  assert.equal(first.onload, null, "onload handler detached");
  assert.equal(first.onerror, null, "onerror handler detached");

  h.document.getElementById("lg-start-btn").fire("click", { preventDefault() {} });
  assert.equal(head.children.length, 1, "retry injects exactly one fresh script (no stacking)");
  assert.notStrictEqual(head.children[0], first, "retry uses a brand-new <script> element");
});

test("a timed-out PeerJS load is removed and ignores a late load; retry injects exactly one fresh script", async () => {
  const h = runGlue("agent");
  const head = trackingHead();
  h.document.head = head;
  const cfg = h.document.getElementById("f3d-peerjs-loader");
  cfg.attrs["data-src"] = "https://unpkg.com/peerjs@1.5.5/dist/peerjs.min.js";

  // Capture the loader's 12s watchdog without waiting on the wall clock.
  const realSetTimeout = globalThis.setTimeout;
  let watchdog = null;
  globalThis.setTimeout = (cb, ms) => { if (ms === 12000) { watchdog = cb; return 4242; } return realSetTimeout(cb, ms); };
  let first;
  try {
    h.document.getElementById("lg-start-btn").fire("click", { preventDefault() {} });
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
  h.document.getElementById("lg-start-btn").fire("click", { preventDefault() {} });
  assert.equal(head.children.length, 1, "retry injects exactly one fresh script (no stacking)");
  assert.notStrictEqual(head.children[0], first, "retry uses a brand-new <script> element");
});

// ── 12. Shared sequential annotation + Eraser (gesture floor) ────────────
const enterEraser = (h) => h.fireDoc("keydown", { key: "e" });
const m = (id, x, y) => ev(id, x, y, "mouse"); // letterbox is 1280×720 → norm = x/1280, y/720

test("shared scene: a local stroke and a remote stroke coexist; either peer can erase either", () => {
  const h = runGlue("agent", { wireRemote: true });
  enterDraw(h);
  h.canvas.fire("pointerdown", m(1, 128, 72));   // (0.1,0.1)
  h.canvas.fire("pointermove", m(1, 256, 144));  // (0.2,0.2)
  h.canvas.fire("pointerup", m(1, 256, 144));
  assert.equal(h.spy.commit.length, 1, "local stroke committed");
  const localId = h.spy.begin[0].sid;
  // Peer stroke arrives + commits in the same view.
  h.emit({ incomingStrokeEvent: { kind: "begin", viewKey: "", seq: 1, strokeId: "remote1", points: [[0.6, 0.6], [0.7, 0.7]] } });
  h.emit({ incomingStrokeEvent: { kind: "commit", viewKey: "", seq: 2, strokeId: "remote1" } });
  enterEraser(h);
  h.canvas.fire("pointerdown", m(2, 832, 468)); // (0.65,0.65) on remote1
  h.canvas.fire("pointerup", m(2, 832, 468));
  h.canvas.fire("pointerdown", m(3, 192, 108)); // (0.15,0.15) on local
  h.canvas.fire("pointerup", m(3, 192, 108));
  const deleted = (h.spy.deletes || []).map((d) => d.ids).flat();
  assert.ok(deleted.includes("remote1"), "a peer-authored committed stroke is erasable");
  assert.ok(deleted.includes(localId), "a locally-authored committed stroke is erasable");
});

test("shared scene (reverse order): a remote stroke then a local stroke coexist and both erase", () => {
  const h = runGlue("agent", { wireRemote: true });
  h.emit({ incomingStrokeEvent: { kind: "begin", viewKey: "", seq: 1, strokeId: "r2", points: [[0.6, 0.6], [0.7, 0.7]] } });
  h.emit({ incomingStrokeEvent: { kind: "commit", viewKey: "", seq: 2, strokeId: "r2" } });
  enterDraw(h);
  h.canvas.fire("pointerdown", m(1, 128, 72));
  h.canvas.fire("pointermove", m(1, 256, 144));
  h.canvas.fire("pointerup", m(1, 256, 144));
  const localId = h.spy.begin[0].sid;
  enterEraser(h);
  h.canvas.fire("pointerdown", m(2, 192, 108)); h.canvas.fire("pointerup", m(2, 192, 108));
  h.canvas.fire("pointerdown", m(3, 832, 468)); h.canvas.fire("pointerup", m(3, 832, 468));
  const deleted = (h.spy.deletes || []).map((d) => d.ids).flat();
  assert.ok(deleted.includes(localId) && deleted.includes("r2"), "both strokes present + erasable regardless of order");
});

test("sequential annotation: a peer gesture (nav_lock) blocks a new local stroke until it ends", () => {
  const h = runGlue("agent", { wireRemote: true });
  h.emit({ incomingNavLockEvent: { viewKey: "", locked: true, seq: 1, ts: 1 } });
  enterDraw(h);
  h.canvas.fire("pointerdown", m(1, 128, 72));
  assert.equal(h.spy.begin.length, 0, "no local stroke starts while the peer holds the floor");
  h.emit({ incomingNavLockEvent: { viewKey: "", locked: false, seq: 2, ts: 2 } });
  h.canvas.fire("pointerdown", m(2, 128, 72));
  h.canvas.fire("pointermove", m(2, 256, 144));
  h.canvas.fire("pointerup", m(2, 256, 144));
  assert.equal(h.spy.begin.length, 1, "the local stroke starts the instant the peer's gesture ends");
});

test("the local floor releases on pointerup, pointercancel, and tool change (nav_lock false each path)", () => {
  const h = runGlue("agent", { wireRemote: true });
  const locks = () => (h.spy.navlock || []).map((n) => n.locked);
  enterDraw(h);
  h.canvas.fire("pointerdown", m(1, 128, 72));
  assert.deepEqual(locks(), [true], "gesture start takes the floor");
  h.canvas.fire("pointerup", m(1, 128, 72));
  assert.deepEqual(locks(), [true, false], "pointerup releases the floor");
  h.canvas.fire("pointerdown", m(2, 128, 72));
  h.canvas.fire("pointercancel", m(2, 128, 72));
  assert.deepEqual(locks(), [true, false, true, false], "pointercancel releases the floor");
  // A new gesture takes it again; switching tool releases it.
  h.canvas.fire("pointerdown", m(3, 128, 72));
  assert.deepEqual(locks(), [true, false, true, false, true], "next gesture re-takes the floor");
  h.fireDoc("keydown", { key: "p" }); // tool change → release
  assert.deepEqual(locks(), [true, false, true, false, true, false], "tool change releases the floor");
});

test("near-simultaneous starts resolve safely: the in-flight local stroke completes, then it is sequential", () => {
  const h = runGlue("agent", { wireRemote: true });
  enterDraw(h);
  h.canvas.fire("pointerdown", m(1, 128, 72));
  assert.equal(h.spy.begin.length, 1, "local first gesture begins");
  // A near-simultaneous remote gesture arrives mid-stroke.
  h.emit({ incomingNavLockEvent: { viewKey: "", locked: true, seq: 1, ts: 1 } });
  h.canvas.fire("pointermove", m(1, 256, 144));
  h.canvas.fire("pointerup", m(1, 256, 144));
  assert.equal(h.spy.commit.length, 1, "the in-flight local stroke completes — no corruption, no abort");
  // While the peer still holds the floor, a NEW local stroke is blocked.
  h.canvas.fire("pointerdown", m(2, 128, 72));
  assert.equal(h.spy.begin.length, 1, "no new local stroke while the peer still holds the floor");
  h.emit({ incomingNavLockEvent: { viewKey: "", locked: false, seq: 2, ts: 2 } }); // cleanup
});

test("eraser drag removes each intersected committed stroke exactly once", () => {
  const h = runGlue("agent", { wireRemote: true });
  enterDraw(h);
  h.canvas.fire("pointerdown", m(1, 128, 72)); h.canvas.fire("pointermove", m(1, 160, 72)); h.canvas.fire("pointerup", m(1, 160, 72));
  const a = h.spy.begin[0].sid;
  h.canvas.fire("pointerdown", m(2, 640, 72)); h.canvas.fire("pointermove", m(2, 672, 72)); h.canvas.fire("pointerup", m(2, 672, 72));
  const b = h.spy.begin[1].sid;
  enterEraser(h);
  h.canvas.fire("pointerdown", m(3, 128, 72)); // over A
  h.canvas.fire("pointermove", m(3, 144, 72)); // still over A (already deleted → no re-delete)
  h.canvas.fire("pointermove", m(3, 640, 72)); // over B
  h.canvas.fire("pointerup", m(3, 640, 72));
  const deleted = (h.spy.deletes || []).map((d) => d.ids).flat();
  assert.deepEqual(deleted.slice().sort(), [a, b].sort(), "each intersected stroke deleted exactly once");
});

test("the eraser skips an in-flight (uncommitted) remote stroke, then erases it once committed", () => {
  const h = runGlue("agent", { wireRemote: true });
  h.emit({ incomingStrokeEvent: { kind: "begin", viewKey: "", seq: 1, strokeId: "r1", points: [[0.3, 0.3], [0.4, 0.4]] } });
  enterEraser(h);
  h.canvas.fire("pointerdown", m(1, 448, 252)); // (0.35,0.35) on r1
  h.canvas.fire("pointerup", m(1, 448, 252));
  assert.equal((h.spy.deletes || []).length, 0, "an uncommitted remote stroke is not erasable");
  h.emit({ incomingStrokeEvent: { kind: "commit", viewKey: "", seq: 2, strokeId: "r1" } });
  h.canvas.fire("pointerdown", m(2, 448, 252));
  h.canvas.fire("pointerup", m(2, 448, 252));
  assert.deepEqual((h.spy.deletes || []).map((d) => d.ids).flat(), ["r1"], "erasable once committed");
});

test("an inbound stroke_delete removes the matching local stroke; unknown ids are a harmless no-op", () => {
  const h = runGlue("agent", { wireRemote: true });
  enterDraw(h);
  h.canvas.fire("pointerdown", m(1, 128, 72)); h.canvas.fire("pointermove", m(1, 256, 144)); h.canvas.fire("pointerup", m(1, 256, 144));
  const a = h.spy.begin[0].sid;
  h.emit({ incomingStrokeDeleteEvent: { viewKey: "", seq: 1, strokeIds: [a], ts: 1 } });
  h.emit({ incomingStrokeDeleteEvent: { viewKey: "", seq: 2, strokeIds: ["ghost"], ts: 2 } }); // no throw
  enterEraser(h);
  h.canvas.fire("pointerdown", m(2, 192, 108)); // where A was
  h.canvas.fire("pointerup", m(2, 192, 108));
  assert.equal((h.spy.deletes || []).length, 0, "no outbound delete — A was already removed by the inbound stroke_delete");
});

test("the remote floor auto-clears on the bounded safety timeout (peer crash mid-gesture)", () => {
  const realSetTimeout = globalThis.setTimeout;
  let floorTimer = null;
  globalThis.setTimeout = (cb, ms) => { if (ms === 8000) { floorTimer = cb; return 7777; } return realSetTimeout(cb, ms); };
  try {
    const h = runGlue("agent", { wireRemote: true });
    h.emit({ incomingNavLockEvent: { viewKey: "", locked: true, seq: 1, ts: 1 } });
    enterDraw(h);
    h.canvas.fire("pointerdown", m(1, 128, 72));
    assert.equal(h.spy.begin.length, 0, "blocked while the peer holds the floor");
    assert.equal(typeof floorTimer, "function", "a bounded safety timeout was armed");
    floorTimer(); // peer crashed → watchdog fires
    h.canvas.fire("pointerdown", m(2, 128, 72));
    h.canvas.fire("pointermove", m(2, 256, 144));
    h.canvas.fire("pointerup", m(2, 256, 144));
    assert.equal(h.spy.begin.length, 1, "the safety timeout frees this side");
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test("a long ACTIVE gesture keeps the floor: owned moves refresh the watchdog (no mid-gesture release)", () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let armed = 0;
  globalThis.setTimeout = (cb, ms) => { if (ms === 8000) { armed += 1; return 1000 + armed; } return realSetTimeout(cb, ms); };
  globalThis.clearTimeout = (id) => { if (typeof id === "number" && id >= 1000) return; return realClearTimeout(id); };
  try {
    const h = runGlue("agent", { wireRemote: true });
    enterDraw(h);
    h.canvas.fire("pointerdown", m(1, 128, 72));        // acquire → arm #1
    assert.equal(armed, 1, "watchdog armed on gesture start");
    h.canvas.fire("pointermove", m(1, 160, 100));       // activity → re-arm
    h.canvas.fire("pointermove", m(1, 200, 140));       // activity → re-arm
    assert.ok(armed >= 3, "owned moves refresh (re-arm) the safety watchdog");
    assert.deepEqual((h.spy.navlock || []).map((n) => n.locked), [true], "floor still held — no spurious release mid-gesture");
    h.canvas.fire("pointerup", m(1, 200, 140));
    assert.deepEqual((h.spy.navlock || []).map((n) => n.locked), [true, false], "released only on pointerup");
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  }
});

// ── 13. Floor heartbeat: keep the PEER's remote watchdog alive on long drags ──
// Sender side throttles nav_lock(true) on owned movement; receiver side re-arms
// its remote watchdog per inbound nav_lock(true) and (defense-in-depth) per
// stroke_delete. FLOOR_HEARTBEAT_MS = floor(8000/3) = 2666.
test("a >8s eraser drag over BLANK space keeps the peer locked via throttled heartbeats", () => {
  const realNow = Date.now;
  let clock = 5_000_000;
  Date.now = () => clock;
  try {
    const h = runGlue("agent", { wireRemote: true });
    enterEraser(h);
    h.canvas.fire("pointerdown", m(1, 100, 100)); // acquire → nav_lock(true) #1; no strokes → no delete
    let moves = 0;
    for (let t = 200; t <= 9000; t += 200) { clock = 5_000_000 + t; h.canvas.fire("pointermove", m(1, 100 + (t % 7), 100)); moves += 1; }
    const trues = (h.spy.navlock || []).filter((n) => n.locked).length;
    assert.equal((h.spy.deletes || []).length, 0, "blank-space drag deletes nothing — heartbeat is NOT delete-driven");
    assert.ok(trues >= 4, `heartbeats keep the peer locked across a 9s drag (got ${trues} locks)`);
    assert.ok(trues < moves, `heartbeats are throttled, not one-per-move (${trues} locks << ${moves} moves)`);
    assert.equal((h.spy.navlock || []).filter((n) => !n.locked).length, 0, "no release mid-drag");
    clock = 5_000_000 + 9200;
    h.canvas.fire("pointerup", m(1, 150, 100));
    const truesAtUp = (h.spy.navlock || []).filter((n) => n.locked).length;
    assert.equal((h.spy.navlock || []).filter((n) => !n.locked).length, 1, "exactly one release on pointerup");
    // After release, a stray move sends no further heartbeat.
    clock = 5_000_000 + 30000;
    h.canvas.fire("pointermove", m(1, 300, 300));
    assert.equal((h.spy.navlock || []).filter((n) => n.locked).length, truesAtUp, "no heartbeats after release");
  } finally { Date.now = realNow; }
});

test("a >8s eraser drag that DELETES strokes also stays locked (heartbeat independent of deletes)", () => {
  const realNow = Date.now;
  let clock = 6_000_000;
  Date.now = () => clock;
  try {
    const h = runGlue("agent", { wireRemote: true });
    // Lay down committed strokes along the drag path (y≈100).
    enterDraw(h);
    for (let i = 0; i < 3; i++) {
      const x = 200 + i * 200;
      h.canvas.fire("pointerdown", m(10 + i, x, 100));
      h.canvas.fire("pointermove", m(10 + i, x + 20, 100));
      h.canvas.fire("pointerup", m(10 + i, x + 20, 100));
    }
    h.spy.navlock = []; // snapshot: count only the eraser drag's heartbeats
    enterEraser(h);
    h.canvas.fire("pointerdown", m(1, 200, 100));
    for (let t = 200; t <= 9000; t += 200) { clock = 6_000_000 + t; h.canvas.fire("pointermove", m(1, 200 + t / 12, 100)); }
    const trues = (h.spy.navlock || []).filter((n) => n.locked).length;
    assert.ok((h.spy.deletes || []).length >= 1, "the drag erased at least one stroke");
    assert.ok(trues >= 4, "heartbeats still keep the peer locked on a delete-heavy drag");
    assert.equal((h.spy.navlock || []).filter((n) => !n.locked).length, 0, "no release mid-drag");
  } finally { Date.now = realNow; }
});

test("heartbeats stop immediately on pointercancel and on tool change", () => {
  const realNow = Date.now;
  let clock = 7_000_000;
  Date.now = () => clock;
  try {
    // pointercancel
    const h = runGlue("agent", { wireRemote: true });
    enterEraser(h);
    h.canvas.fire("pointerdown", m(1, 100, 100));
    clock += 3000; h.canvas.fire("pointermove", m(1, 120, 100)); // one heartbeat
    h.canvas.fire("pointercancel", m(1, 120, 100));
    assert.equal((h.spy.navlock || []).filter((n) => !n.locked).length, 1, "cancel releases the floor");
    const truesAfterCancel = (h.spy.navlock || []).filter((n) => n.locked).length;
    clock += 30000; h.canvas.fire("pointermove", m(1, 140, 100)); // not owned anymore
    assert.equal((h.spy.navlock || []).filter((n) => n.locked).length, truesAfterCancel, "no heartbeats after cancel");
    // tool change
    const h2 = runGlue("agent", { wireRemote: true });
    enterEraser(h2);
    h2.canvas.fire("pointerdown", m(1, 100, 100));
    h2.fireDoc("keydown", { key: "p" }); // tool change → releaseLocalFloor
    assert.equal((h2.spy.navlock || []).filter((n) => !n.locked).length, 1, "tool change releases the floor");
  } finally { Date.now = realNow; }
});

test("inbound nav_lock(true) heartbeats re-arm the remote watchdog; the peer stays locked", () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let armed = 0;
  globalThis.setTimeout = (cb, ms) => { if (ms === 8000) { armed += 1; return 2000 + armed; } return realSetTimeout(cb, ms); };
  globalThis.clearTimeout = (id) => { if (typeof id === "number" && id >= 2000) return; return realClearTimeout(id); };
  try {
    const h = runGlue("agent", { wireRemote: true });
    h.emit({ incomingNavLockEvent: { viewKey: "", locked: true, seq: 1, ts: 1 } }); // arm #1
    h.emit({ incomingNavLockEvent: { viewKey: "", locked: true, seq: 2, ts: 2 } }); // heartbeat → re-arm #2
    h.emit({ incomingNavLockEvent: { viewKey: "", locked: true, seq: 3, ts: 3 } }); // re-arm #3
    assert.ok(armed >= 3, "each inbound nav_lock(true) heartbeat re-arms the remote watchdog");
    enterDraw(h);
    h.canvas.fire("pointerdown", m(1, 128, 72));
    assert.equal(h.spy.begin.length, 0, "peer stays locked across heartbeats");
  } finally { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; }
});

test("an inbound stroke_delete also re-arms the remote watchdog (defense in depth)", () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let armed = 0;
  globalThis.setTimeout = (cb, ms) => { if (ms === 8000) { armed += 1; return 2000 + armed; } return realSetTimeout(cb, ms); };
  globalThis.clearTimeout = (id) => { if (typeof id === "number" && id >= 2000) return; return realClearTimeout(id); };
  try {
    const h = runGlue("agent", { wireRemote: true });
    h.emit({ incomingNavLockEvent: { viewKey: "", locked: true, seq: 1, ts: 1 } }); // arm #1
    h.emit({ incomingStrokeDeleteEvent: { viewKey: "", seq: 1, strokeIds: ["x"], ts: 2 } }); // refreshRemoteFloor → re-arm #2
    assert.ok(armed >= 2, "a delete re-arms the remote watchdog");
  } finally { globalThis.setTimeout = realSetTimeout; globalThis.clearTimeout = realClearTimeout; }
});
