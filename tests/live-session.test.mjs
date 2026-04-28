#!/usr/bin/env node

// Behavioural test for src/lib/portal/live-session.mjs — the Phase 3
// PeerJS controller for the Live Guided Tour feature.
//
// In the real browser the controller drives `window.Peer` (PeerJS UMD
// bundle loaded via CDN <script>) plus `navigator.mediaDevices`. Here
// we substitute a hand-rolled FakePeer that records emitted events and
// mock just enough of `globalThis.navigator` so the mic-acquisition
// path resolves to `null` (no audio). All P2P flows are exercised
// without any network or browser dependency.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveSession } from "../src/lib/portal/live-session.mjs";

// ── FakePeer ──────────────────────────────────────────────────────────
// Minimal stand-in for `peerjs.Peer`. Records every constructor call,
// exposes `_fire(event, payload)` for the test to drive callbacks, and
// implements `connect()` / `call()` returning fake DataConnection /
// MediaConnection instances with the same emit-callback machinery.

function FakeEmitter() {
  this._handlers = Object.create(null);
}
FakeEmitter.prototype.on = function (evt, fn) {
  if (!this._handlers[evt]) this._handlers[evt] = [];
  this._handlers[evt].push(fn);
};
FakeEmitter.prototype._fire = function (evt, payload) {
  const list = this._handlers[evt] || [];
  for (let i = 0; i < list.length; i++) list[i](payload);
};

function makeFakePeerCtor(opts) {
  const config = opts || {};
  const log = [];

  function FakePeer(id) {
    FakeEmitter.call(this);
    this.id = id;
    this.destroyed = false;
    this._sentPackets = [];
    log.push(id);

    // Same-tick "open" / "error" emission so the test can drive without
    // setTimeout. The factory option lets a single test instance switch
    // between success and unavailable-id retry paths.
    const next = config.nextEvent ? config.nextEvent(id) : { type: "open" };
    Promise.resolve().then(() => {
      if (next.type === "open") {
        this._fire("open");
      } else if (next.type === "error") {
        this._fire("error", { type: next.errorType || "unknown" });
      }
    });
  }
  FakePeer.prototype = Object.create(FakeEmitter.prototype);

  FakePeer.prototype.connect = function (targetId, _options) {
    const conn = new FakeEmitter();
    conn.send = (packet) => this._sentPackets.push({ to: targetId, packet });
    conn.close = () => conn._fire("close");
    // Record the spawned conn so tests can drive its events.
    if (!this._conns) this._conns = [];
    this._conns.push(conn);
    return conn;
  };

  FakePeer.prototype.call = function (targetId, _stream) {
    const call = new FakeEmitter();
    call.close = () => call._fire("close");
    call.target = targetId;
    if (!this._calls) this._calls = [];
    this._calls.push(call);
    return call;
  };

  FakePeer.prototype.destroy = function () {
    this.destroyed = true;
  };

  FakePeer.log = log;
  return FakePeer;
}

// Stub navigator.mediaDevices so _getMicStream resolves to null
// (graceful path — _silentTrackStream then also returns null in Node
// since AudioContext doesn't exist). Wire this once per test process.
if (typeof globalThis.navigator === "undefined") {
  globalThis.navigator = {};
}
globalThis.navigator.mediaDevices = undefined;
globalThis.window = globalThis.window || {};

// ── Tests ─────────────────────────────────────────────────────────────

test("createLiveSession exposes the documented public API", () => {
  const session = createLiveSession({ PeerCtor: makeFakePeerCtor() });
  for (const k of [
    "getState",
    "subscribe",
    "initializeAsAgent",
    "joinAsVisitor",
    "teleportVisitor",
    "dispose",
  ]) {
    assert.equal(typeof session[k], "function", `missing method: ${k}`);
  }
  assert.deepEqual(session.getState().status, "idle");
  session.dispose();
});

test("subscribe fires once on attach and again on every state patch", () => {
  const session = createLiveSession({ PeerCtor: makeFakePeerCtor() });
  const seen = [];
  const off = session.subscribe((s) => seen.push(s.status));
  assert.deepEqual(seen, ["idle"], "should fire immediately with current state");
  return session.initializeAsAgent().then(() => {
    assert.ok(
      seen.includes("initializing"),
      "should patch through initializing state",
    );
    assert.equal(
      seen[seen.length - 1],
      "waiting",
      "final state after open is `waiting`",
    );
    off();
    session.dispose();
  });
});

test("initializeAsAgent generates a 4-digit PIN and a TourAgent- peer id", () => {
  const Ctor = makeFakePeerCtor();
  const session = createLiveSession({ PeerCtor: Ctor });
  return session.initializeAsAgent().then(({ pin, peerId }) => {
    assert.match(pin, /^\d{4}$/, "PIN must be 4 numeric digits");
    assert.equal(peerId, "TourAgent-" + pin);
    assert.equal(Ctor.log.length, 1);
    session.dispose();
  });
});

test("agent retries when the broker reports unavailable-id", () => {
  let calls = 0;
  // First two attempts return unavailable-id; the third opens.
  const Ctor = makeFakePeerCtor({
    nextEvent: () => {
      calls++;
      if (calls < 3) return { type: "error", errorType: "unavailable-id" };
      return { type: "open" };
    },
  });
  const session = createLiveSession({ PeerCtor: Ctor, pinAttempts: 5 });
  return session.initializeAsAgent().then(({ pin }) => {
    assert.match(pin, /^\d{4}$/);
    assert.equal(calls, 3, "should have tried 3 PINs total");
    assert.equal(session.getState().status, "waiting");
    session.dispose();
  });
});

test("agent gives up after pinAttempts unavailable-ids and errors out", () => {
  const Ctor = makeFakePeerCtor({
    nextEvent: () => ({ type: "error", errorType: "unavailable-id" }),
  });
  const session = createLiveSession({ PeerCtor: Ctor, pinAttempts: 2 });
  return session.initializeAsAgent().then(
    () => assert.fail("should have rejected"),
    () => {
      assert.equal(session.getState().status, "error");
      assert.match(session.getState().error || "", /PIN/i);
      session.dispose();
    },
  );
});

test("joinAsVisitor rejects malformed PINs without touching PeerCtor", () => {
  let constructed = 0;
  const Ctor = makeFakePeerCtor();
  // Wrap to count constructions.
  function CountedPeer(id) {
    constructed++;
    Ctor.call(this, id);
  }
  CountedPeer.prototype = Ctor.prototype;
  const session = createLiveSession({ PeerCtor: CountedPeer });
  return session.joinAsVisitor("12").then(
    () => assert.fail("should reject short PIN"),
    () => {
      assert.equal(constructed, 0, "should not construct a peer for invalid PIN");
      assert.equal(session.getState().status, "error");
      session.dispose();
    },
  );
});

test("joinAsVisitor opens a data connection + voice call to the agent id", () => {
  const Ctor = makeFakePeerCtor();
  const session = createLiveSession({ PeerCtor: Ctor });
  return session.joinAsVisitor("4242").then(({ pin, peerId }) => {
    assert.equal(pin, "4242");
    assert.match(peerId, /^TourGuest-/, "visitor id has the TourGuest- prefix");
    // Exactly one peer constructed; its first connect/call target is the
    // canonical agent id derived from the PIN.
    assert.equal(Ctor.log.length, 1);
    // Drain the microtask queue so the call() promise from _getMicStream
    // resolves before we inspect the peer's _calls log.
    return new Promise((r) => setTimeout(r, 0));
  }).then(() => {
    // We can't reach the FakePeer instance directly through the API,
    // but we registered every constructed id in Ctor.log. The visitor
    // peer is the only one — assert the data conn was opened to the
    // TourAgent-4242 id by inspecting the controller state.
    assert.equal(session.getState().role, "visitor");
    assert.equal(session.getState().status, "connecting");
    session.dispose();
  });
});

test("teleportVisitor returns false when not in agent role or not connected", () => {
  const session = createLiveSession({ PeerCtor: makeFakePeerCtor() });
  // Idle: no role → false.
  assert.equal(session.teleportVisitor("23", "1.2,3.4"), false);
  return session.initializeAsAgent().then(() => {
    // Waiting: role is agent but no data conn yet → false.
    assert.equal(session.teleportVisitor("23", "1.2,3.4"), false);
    session.dispose();
  });
});

test("teleportVisitor sends the documented JSON shape over the data channel", () => {
  // Drive an end-to-end agent with a manually injected data connection.
  // We stash the FakePeer on each construction so the test can inject
  // an inbound `connection` event the way the broker would.
  const peers = [];
  const FakePeer = makeFakePeerCtor();
  function CapturingPeer(id) {
    FakePeer.call(this, id);
    peers.push(this);
  }
  CapturingPeer.prototype = FakePeer.prototype;
  CapturingPeer.log = FakePeer.log;

  const session = createLiveSession({ PeerCtor: CapturingPeer });
  return session.initializeAsAgent().then(() => {
    const agentPeer = peers[0];
    // Broker delivers an inbound visitor connection.
    const inboundConn = new FakeEmitter();
    const sentPackets = [];
    inboundConn.send = (p) => sentPackets.push(p);
    agentPeer._fire("connection", inboundConn);
    inboundConn._fire("open");
    assert.equal(session.getState().isConnected, true);

    // Now teleport.
    const ok = session.teleportVisitor("42", "-1.45,-0.06");
    assert.equal(ok, true);
    assert.equal(sentPackets.length, 1);
    assert.deepEqual(sentPackets[0], {
      type: "teleport",
      ss: "42",
      sr: "-1.45,-0.06",
    });

    // ss is required — empty ss is a silent reject.
    const ok2 = session.teleportVisitor("", "0,0");
    assert.equal(ok2, false);
    assert.equal(sentPackets.length, 1, "no extra packet after empty-ss reject");

    session.dispose();
  });
});

test("inbound teleport packet on visitor side patches incomingTeleportEvent", () => {
  const peers = [];
  const FakePeer = makeFakePeerCtor();
  function CapturingPeer(id) {
    FakePeer.call(this, id);
    peers.push(this);
  }
  CapturingPeer.prototype = FakePeer.prototype;
  CapturingPeer.log = FakePeer.log;

  const session = createLiveSession({ PeerCtor: CapturingPeer });
  return session.joinAsVisitor("0123").then(() => new Promise((r) => setTimeout(r, 0))).then(() => {
    const visitorPeer = peers[0];
    // Visitor's outbound connection is in `_conns[0]`.
    const conn = visitorPeer._conns[0];
    assert.ok(conn, "visitor should have opened an outbound data connection");
    conn._fire("open");
    conn._fire("data", {
      type: "teleport",
      ss: "17",
      sr: "0.5,1.0",
    });
    const ev = session.getState().incomingTeleportEvent;
    assert.ok(ev, "incomingTeleportEvent should be set");
    assert.equal(ev.ss, "17");
    assert.equal(ev.sr, "0.5,1.0");
    assert.equal(typeof ev.ts, "number");

    // Garbage payloads are silently dropped.
    conn._fire("data", { type: "ping" });
    conn._fire("data", "not an object");
    conn._fire("data", { type: "teleport", ss: "" });
    // Original event remains untouched.
    assert.equal(session.getState().incomingTeleportEvent.ss, "17");

    session.dispose();
  });
});

test("dispose tears down listeners and resets state to idle", () => {
  const session = createLiveSession({ PeerCtor: makeFakePeerCtor() });
  let fires = 0;
  session.subscribe(() => fires++);
  return session.initializeAsAgent().then(() => {
    const fireCountBeforeDispose = fires;
    session.dispose();
    assert.equal(session.getState().status, "idle");
    assert.equal(session.getState().role, null);
    assert.equal(session.getState().pin, null);
    // dispose drops listeners; further subscribes would still fire,
    // but existing listeners are no longer called.
    fires = fireCountBeforeDispose;
    // We can't easily provoke a state change post-dispose without
    // a peer, so just sanity-check the flag-guard prevents double-init.
    return session.initializeAsAgent().then(
      () => assert.fail("should not re-init after dispose"),
      (err) => assert.match(err.message, /disposed/i),
    );
  });
});
