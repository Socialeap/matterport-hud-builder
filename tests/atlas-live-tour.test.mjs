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
    "createLiveSession({})",
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
  return {};
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
    GLUE,
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
    sendStrokeBegin: () => true,
    sendStrokePatch: () => true,
    sendStrokeCommit: () => true,
    sendClear: () => true,
    sendNavLock: () => true,
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
    GLUE,
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
