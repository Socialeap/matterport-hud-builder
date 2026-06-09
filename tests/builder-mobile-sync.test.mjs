#!/usr/bin/env node

// BEHAVIORAL coverage for the mobile Sync View flow in the Builder/portal
// live-tour glue: the explicit "Sync copied view" tap and the manual paste
// fallback. We EXTRACT the real glue between the f3d:runtime-js:glue sentinels,
// un-escape the template-literal escapes, inject the REAL anno-input.mjs kernel
// + a fake createLiveSession, and run it against a hand-rolled fake DOM under a
// faked iOS WebKit navigator — the same technique tests/builder-live-tour.test.mjs
// uses. This exercises the genuine handlers, not stubs.
//
// The contract under test (matches the Atlas family, src/lib/atlas-live-tour-runtime.mjs):
//   - On iOS the loc-sync pill is an EXPLICIT tap-to-sync button. A clipboard
//     read happens ONLY from that click — never from focus / visibilitychange /
//     pointerenter / clipboardchange (ambientClipboardAllowed() === false on iOS).
//   - A valid Matterport ss/sr link is transmitted via shareLocationWithAgent
//     (visitor) or teleportVisitor (agent); invalid / non-Matterport / oversized
//     links are rejected. Not-connected and read-denied surface honest states.
//   - The manual paste field is the final fallback and NEVER touches the
//     clipboard API.

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
  const from = src.indexOf("\n", a) + 1;
  return src.slice(from, b);
}
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
const OUTER_STUBS = 'var props=[{ name:"Canary", iframeUrl:"", liveTourStops:[] }]; var current=0;';
const BODY = OUTER_STUBS + "\n" + ANNO_INPUT + "\n" + GLUE;

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
FakeEl.prototype.fire = function (ev, e) { (this._h[ev] || []).forEach((f) => f(e || { preventDefault() {} })); };

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

// Navigator for a target platform with a controllable clipboard.
// platform: "ios" (default) | "android" | "desktop". annoIsIosWebKit → true
// only for "ios"; "android"/"desktop" are non-iOS (coarse vs fine via matchMedia).
function makeNavigator(opts) {
  const clip = {
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
  const UA = {
    ios: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
    desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  const PLAT = { ios: "iPhone", android: "Linux armv8l", desktop: "Win32" };
  const platform = opts.platform || "ios";
  return {
    userAgent: UA[platform],
    platform: PLAT[platform],
    maxTouchPoints: platform === "desktop" ? 0 : 5,
    clipboard: opts.noClipboard ? undefined : clip,
    _clip: clip,
  };
}

// Connected (or not) controller; records the location-share send path + args.
function makeController(opts) {
  const sends = [];
  const role = opts.role || "visitor";
  const state = {
    role,
    status: opts.connected === false ? "connecting" : "connected",
    pin: "1234",
    peerId: "peer",
    error: null,
    isConnected: opts.connected !== false,
    remoteStream: null,
    voiceCallActive: false,
    incomingTeleportEvent: null,
    incomingPointerEvent: null,
    incomingStrokeEvent: null,
    incomingClearEvent: null,
    incomingNavLockEvent: null,
    incomingLocationShareEvent: null,
  };
  const ok = opts.sendOk !== false;
  return {
    sends,
    getState: () => state,
    subscribe: () => () => {},
    initializeAsAgent: () => Promise.resolve({ pin: "1234", peerId: "host" }),
    joinAsVisitor: (pin) => Promise.resolve({ pin, peerId: "guest" }),
    teleportVisitor: (ss, sr) => { sends.push({ fn: "teleportVisitor", ss, sr }); return ok; },
    shareLocationWithAgent: (ss, sr) => { sends.push({ fn: "shareLocationWithAgent", ss, sr }); return ok; },
    sendPointer: () => true,
    sendStrokeBegin: () => true,
    sendStrokePatch: () => true,
    sendStrokeCommit: () => true,
    sendClear: () => true,
    sendNavLock: () => true,
    dispose: () => {},
  };
}

function FakeRO() {}
FakeRO.prototype.observe = function () {};
FakeRO.prototype.unobserve = function () {};
FakeRO.prototype.disconnect = function () {};

function runSync(opts = {}) {
  const { els, document } = makeFakeDom();
  const controller = makeController(opts);
  const navigator = makeNavigator(opts);
  const window = {
    _h: Object.create(null),
    addEventListener(ev, fn) { (this._h[ev] || (this._h[ev] = [])).push(fn); },
    removeEventListener() {},
    requestAnimationFrame: (cb) => { cb(); return 0; },
    devicePixelRatio: 2,
    // Coarse-pointer is what annoIsCoarsePointer() keys on; opts.coarse drives it.
    matchMedia: (q) => ({ matches: !!opts.coarse && String(q).indexOf("coarse") !== -1, addEventListener() {}, removeEventListener() {} }),
    location: { href: "https://example.com/test/" },
  };
  window.parent = window; // direct viewing — interaction emit is a no-op
  const frame = new FakeEl("matterport-frame");
  // eslint-disable-next-line no-new-func
  const fn = new Function("window", "document", "navigator", "createLiveSession", "ResizeObserver", "frame", BODY);
  fn(window, document, navigator, () => controller, FakeRO, frame);
  const fireWin = (ev, e) => (window._h[ev] || []).forEach((f) => f(e || {}));
  const fireDoc = (ev, e) => (document._h[ev] || []).forEach((f) => f(Object.assign({ preventDefault() {} }, e || {})));
  return { els, document, window, navigator, clip: navigator._clip, controller, frame, fireWin, fireDoc };
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const VALID = "https://my.matterport.com/show/?m=ABCdef12345&ss=42&sr=-1.23,0.45";
const pill = (h) => h.els["loc-sync"];
const state = (h) => pill(h).getAttribute("data-state");

// ── 0. Sanity: the extracted glue runs under a faked iOS navigator ────────
test("the extracted Builder glue parses + runs under a faked iOS WebKit navigator", () => {
  assert.doesNotThrow(() => runSync({ role: "visitor" }));
});

// ── 1. No read at init; the click handler is the only clipboard reader ────
test("init performs NO clipboard read on iOS (no ambient/pre-grant read)", () => {
  const h = runSync({ role: "visitor", clipText: VALID });
  assert.equal(h.clip.reads, 0, "nothing reads the clipboard until the explicit tap");
});

test("iOS ambient lifecycle events (focus / visibilitychange / pointerenter) NEVER read the clipboard", () => {
  const h = runSync({ role: "visitor", clipText: VALID });
  h.fireWin("focus");
  h.fireDoc("visibilitychange");
  const lb = h.els["anno-letterbox-wrap"];
  lb.fire("pointerenter", { pointerType: "mouse", preventDefault() {} });
  lb.fire("pointerenter", { pointerType: "touch", preventDefault() {} });
  // Fire any registered clipboardchange handlers too.
  (h.clip._h["clipboardchange"] || []).forEach((f) => f({}));
  assert.equal(h.clip.reads, 0, "ambient triggers must not read the clipboard on iOS");
  assert.equal(h.controller.sends.length, 0, "and therefore must not transmit anything");
});

// ── 2. Explicit tap transmits a valid ss/sr — both roles, correct fn ──────
test("explicit tap (visitor) reads the clipboard ONCE and sends via shareLocationWithAgent", async () => {
  const h = runSync({ role: "visitor", clipText: VALID });
  pill(h).fire("click");
  assert.equal(state(h), "reading", "tap immediately shows the reading state");
  await tick();
  assert.equal(h.clip.reads, 1, "exactly one clipboard read, from the click");
  assert.deepEqual(h.controller.sends, [{ fn: "shareLocationWithAgent", ss: "42", sr: "-1.23,0.45" }]);
  assert.equal(state(h), "success", "ends in the success state");
});

test("explicit tap (agent) sends via teleportVisitor", async () => {
  const h = runSync({ role: "agent", clipText: VALID });
  pill(h).fire("click");
  await tick();
  assert.deepEqual(h.controller.sends, [{ fn: "teleportVisitor", ss: "42", sr: "-1.23,0.45" }]);
  assert.equal(state(h), "success");
});

test("keyboard Enter on the pill triggers the same explicit sync", async () => {
  const h = runSync({ role: "visitor", clipText: VALID });
  pill(h).fire("keydown", { key: "Enter", preventDefault() {} });
  await tick();
  assert.equal(h.clip.reads, 1);
  assert.equal(h.controller.sends.length, 1);
});

// ── 3. Invalid / unrelated / oversized clipboards are rejected ────────────
test("non-Matterport URL is read but rejected (no transmit, 'no link' state)", async () => {
  const h = runSync({ role: "visitor", clipText: "https://example.com/?ss=42&sr=1,2" });
  pill(h).fire("click");
  await tick();
  assert.equal(h.clip.reads, 1, "the read still happens (we must inspect the text)");
  assert.equal(h.controller.sends.length, 0, "non-Matterport host is never transmitted");
  assert.equal(state(h), "nolink");
});

test("Matterport URL missing ss (default view) is rejected", async () => {
  const h = runSync({ role: "visitor", clipText: "https://my.matterport.com/show/?m=ABCdef12345" });
  pill(h).fire("click");
  await tick();
  assert.equal(h.controller.sends.length, 0, "a default view with no ss is not a shareable location");
  assert.equal(state(h), "nolink");
});

test("oversized clipboard (>2KB) is rejected without transmitting", async () => {
  const huge = "https://my.matterport.com/show/?m=ABCdef12345&ss=42&sr=1,2&x=" + "9".repeat(2100);
  const h = runSync({ role: "visitor", clipText: huge });
  pill(h).fire("click");
  await tick();
  assert.equal(h.controller.sends.length, 0, "a 2KB+ clipboard can't OOM the parser or transmit garbage");
  assert.equal(state(h), "nolink");
});

test("empty clipboard yields the 'no link' state, not a transmit", async () => {
  const h = runSync({ role: "visitor", clipText: "   " });
  pill(h).fire("click");
  await tick();
  assert.equal(h.controller.sends.length, 0);
  assert.equal(state(h), "nolink");
});

// ── 4. Honest failure states ──────────────────────────────────────────────
test("tapping while NOT connected shows 'not connected' and never reads the clipboard", async () => {
  const h = runSync({ role: "visitor", connected: false, clipText: VALID });
  pill(h).fire("click");
  await tick();
  assert.equal(h.clip.reads, 0, "the connection guard precedes any clipboard read");
  assert.equal(h.controller.sends.length, 0);
  assert.equal(state(h), "notconnected");
});

test("a denied/dismissed clipboard read surfaces the 'denied' state, no transmit", async () => {
  const h = runSync({ role: "visitor", clipReject: true });
  pill(h).fire("click");
  await tick();
  assert.equal(h.clip.reads, 1, "the read was attempted from the user gesture");
  assert.equal(h.controller.sends.length, 0);
  assert.equal(state(h), "denied", "a rejected read is reported, never silently swallowed");
});

test("explicit tap with no Clipboard API at all → denied (steer to the manual field)", async () => {
  const h = runSync({ role: "visitor", noClipboard: true });
  pill(h).fire("click");
  await tick();
  assert.equal(h.controller.sends.length, 0);
  assert.equal(state(h), "denied");
});

// ── 5. Manual paste fallback — never touches the clipboard API ────────────
test("manual paste fallback transmits a valid link WITHOUT any clipboard read", async () => {
  const h = runSync({ role: "agent", clipText: VALID });
  h.els["lg-manual-sync-input"].value = VALID;
  h.els["lg-manual-sync-btn"].fire("click");
  await tick();
  assert.equal(h.clip.reads, 0, "the manual field reads its own value, never the clipboard API");
  assert.deepEqual(h.controller.sends, [{ fn: "teleportVisitor", ss: "42", sr: "-1.23,0.45" }]);
});

test("manual paste fallback rejects an invalid link with a status message, no transmit", async () => {
  const h = runSync({ role: "visitor", clipText: VALID });
  h.els["lg-manual-sync-input"].value = "not a url";
  h.els["lg-manual-sync-btn"].fire("click");
  await tick();
  assert.equal(h.controller.sends.length, 0);
  assert.equal(h.els["lg-manual-sync-status"].textContent.length > 0, true, "an honest status is shown");
});

// ── 6. Codex P2: the advertised tap works on coarse-pointer (Android) too ──
test("Android (coarse pointer, non-iOS): the pill IS a tap-to-sync button and transmits", async () => {
  const h = runSync({ platform: "android", coarse: true, role: "visitor", clipText: VALID });
  assert.ok((pill(h)._h["click"] || []).length > 0, "explicit tap handler is wired on Android / coarse-pointer");
  pill(h).fire("click");
  await tick();
  assert.equal(h.clip.reads, 1, "the tap reads the clipboard from the user gesture");
  assert.deepEqual(h.controller.sends, [{ fn: "shareLocationWithAgent", ss: "42", sr: "-1.23,0.45" }]);
});

test("desktop (fine pointer, non-iOS): NO tap handler — ambient-only, no focus-steal (press-U intact)", () => {
  const h = runSync({ platform: "desktop", coarse: false, role: "visitor", clipText: VALID });
  assert.equal((pill(h)._h["click"] || []).length, 0, "desktop must NOT install a click handler (would steal the iframe's keyboard focus)");
});
