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
    sendClear: () => true,
    sendNavLock: () => true,
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
  const controllerFactory = () => {
    spy.factoryCalls += 1;
    const c = makeConnectedController(role, spy);
    if (opts.fireConnect) {
      const sub = c.subscribe;
      c.subscribe = (fn) => { fn(c.getState()); return sub(fn); };
    }
    return c;
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function("window", "document", "navigator", "createLiveSession", "ResizeObserver", "frame", BODY);
  fn(window, document, navigator, controllerFactory, undefined, frame);
  const fireDoc = (ev, payload) =>
    (document._h[ev] || []).forEach((f) => f(Object.assign({ preventDefault() {}, target: null, key: "" }, payload || {})));
  return { els, spy, fireDoc, canvas: els["anno-canvas"], letterbox: els["anno-letterbox-wrap"], document };
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
  assert.match(h.document.getElementById("lg-agent-status").textContent, /couldn't load/i, "failure is visible");
  assert.equal(h.document.getElementById("lg-start-btn").disabled, false, "Start re-enables for a retry");
  h.document.getElementById("lg-start-btn").fire("click", { preventDefault() {} });
  assert.equal(injected.length, 2, "the next click retries with a fresh load");
});
