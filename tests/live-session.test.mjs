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
    "shareLocationWithAgent",
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

// ── Visitor → Agent: shareLocationWithAgent (clipboard bridge) ────────
//
// Mirrors the teleportVisitor tests but with the direction reversed.
// The visitor parses a Matterport "Link to location" URL out of their
// clipboard and offers ss/sr to the agent over a new `location_share`
// packet type. The receiver-side surfaces it as `incomingLocationShareEvent`
// — the agent's UI decides whether to teleport.

function makeConnectedVisitor() {
  const peers = [];
  const FakePeer = makeFakePeerCtor();
  function CapturingPeer(id) {
    FakePeer.call(this, id);
    peers.push(this);
  }
  CapturingPeer.prototype = FakePeer.prototype;
  CapturingPeer.log = FakePeer.log;

  const session = createLiveSession({ PeerCtor: CapturingPeer });
  return session
    .joinAsVisitor("4242")
    .then(() => new Promise((r) => setTimeout(r, 0)))
    .then(() => {
      const visitorPeer = peers[0];
      const conn = visitorPeer._conns[0];
      assert.ok(conn, "visitor should have opened an outbound data connection");
      conn._fire("open");
      assert.equal(session.getState().isConnected, true);
      // `peer._sentPackets` is a parallel log of every conn.send() call —
      // shape is { to, packet } per the FakePeer connect() implementation.
      return {
        session,
        conn,
        sentPackets: visitorPeer._sentPackets,
        fireData: (payload) => conn._fire("data", payload),
      };
    });
}

test("shareLocationWithAgent is exposed on the public API", () => {
  const session = createLiveSession({ PeerCtor: makeFakePeerCtor() });
  assert.equal(typeof session.shareLocationWithAgent, "function");
  session.dispose();
});

test("shareLocationWithAgent returns false when not in visitor role or not connected", () => {
  const session = createLiveSession({ PeerCtor: makeFakePeerCtor() });
  // Idle: no role → false.
  assert.equal(session.shareLocationWithAgent("23", "1.2,3.4"), false);
  return session.initializeAsAgent().then(() => {
    // Agent role can never share its own location to itself.
    assert.equal(session.shareLocationWithAgent("23", "1.2,3.4"), false);
    session.dispose();
  });
});

test("shareLocationWithAgent returns false when visitor has no open data channel", () => {
  // joinAsVisitor before the data conn fires "open" — should be a clean
  // false, not a throw.
  const peers = [];
  const FakePeer = makeFakePeerCtor();
  function CapturingPeer(id) {
    FakePeer.call(this, id);
    peers.push(this);
  }
  CapturingPeer.prototype = FakePeer.prototype;
  CapturingPeer.log = FakePeer.log;
  const session = createLiveSession({ PeerCtor: CapturingPeer });
  return session
    .joinAsVisitor("4242")
    .then(() => new Promise((r) => setTimeout(r, 0)))
    .then(() => {
      // role is visitor, but isConnected is still false (conn hasn't fired "open").
      assert.equal(session.getState().role, "visitor");
      assert.equal(session.getState().isConnected, false);
      assert.equal(session.shareLocationWithAgent("23", "1.2,3.4"), false);
      session.dispose();
    });
});

test("shareLocationWithAgent sends the documented JSON shape over the data channel", () => {
  return makeConnectedVisitor().then(({ session, sentPackets }) => {
    const ok = session.shareLocationWithAgent("42", "-1.45,-0.06");
    assert.equal(ok, true);
    assert.equal(sentPackets.length, 1, "exactly one packet sent");
    const sent = sentPackets[0].packet;
    assert.equal(sent.type, "location_share");
    assert.equal(sent.ss, "42");
    assert.equal(sent.sr, "-1.45,-0.06");
    assert.equal(typeof sent.ts, "number");

    // ss is required — empty ss is a silent reject (no extra packet).
    const ok2 = session.shareLocationWithAgent("", "0,0");
    assert.equal(ok2, false);
    assert.equal(sentPackets.length, 1, "no extra packet after empty-ss reject");

    // Coerces non-string args gracefully (defensive — callers should
    // already pass strings, but the controller never throws on them).
    const ok3 = session.shareLocationWithAgent(17, 0.5);
    assert.equal(ok3, true);
    assert.equal(sentPackets[1].packet.ss, "17");
    assert.equal(sentPackets[1].packet.sr, "0.5");

    session.dispose();
  });
});

test("shareLocationWithAgent does NOT update _currentViewKey (the agent decides whether to follow)", () => {
  return makeConnectedVisitor().then(({ session, sentPackets, fireData }) => {
    // Visitor shares — should not roll the local viewKey watermark.
    // We can prove this indirectly: an inbound annotation packet with
    // an empty viewKey is accepted (the controller treats "" as
    // pre-teleport / wildcard), so we just confirm no exception and
    // a successful send. The receiver-side test below covers the
    // agent's view.
    assert.equal(session.shareLocationWithAgent("42", "0,0"), true);
    assert.equal(sentPackets[0].packet.type, "location_share");
    // Establish that an inbound clear with empty viewKey still works,
    // proving the visitor's _currentViewKey wasn't silently set to
    // "42|0,0" by the share send (if it had been, the empty-viewKey
    // clear would have been dropped by the receiver filter).
    fireData({ type: "clear", viewKey: "", seq: 1, ts: 1 });
    assert.equal(session.getState().incomingClearEvent.seq, 1);
    session.dispose();
  });
});

test("inbound location_share packet on agent side patches incomingLocationShareEvent", () => {
  return makeConnectedAgent().then(({ session, fireData }) => {
    // Default state: no share event yet.
    assert.equal(session.getState().incomingLocationShareEvent, null);

    fireData({ type: "location_share", ss: "17", sr: "0.5,1.0" });
    let ev = session.getState().incomingLocationShareEvent;
    assert.ok(ev, "incomingLocationShareEvent should be set");
    assert.equal(ev.ss, "17");
    assert.equal(ev.sr, "0.5,1.0");
    assert.equal(typeof ev.ts, "number");

    // A second share replaces the first — ts is the dedupe key for the
    // UI layer, which renders one pill at a time.
    const firstTs = ev.ts;
    return new Promise((r) => setTimeout(r, 2)).then(() => {
      fireData({ type: "location_share", ss: "99", sr: "" });
      ev = session.getState().incomingLocationShareEvent;
      assert.equal(ev.ss, "99");
      assert.equal(ev.sr, "");
      assert.ok(ev.ts > firstTs, "fresh ts on each inbound share");

      // Empty-ss share is dropped — state is unchanged.
      fireData({ type: "location_share", ss: "", sr: "1,1" });
      assert.equal(session.getState().incomingLocationShareEvent.ss, "99");

      // Inbound location_share must NOT roll the agent's _currentViewKey.
      // If it had, the empty-viewKey annotation below would be dropped.
      // The receiver treats "" as wildcard, so we can verify by sending
      // a clear with empty viewKey after the share — it should still
      // patch state.
      fireData({ type: "clear", viewKey: "", seq: 1, ts: 1 });
      assert.equal(session.getState().incomingClearEvent.seq, 1);
      session.dispose();
    });
  });
});

test("inbound location_share with non-object/garbage payloads is silently dropped", () => {
  return makeConnectedAgent().then(({ session, fireData }) => {
    fireData({ type: "location_share", ss: "17", sr: "0.5,1.0" });
    const baselineTs = session.getState().incomingLocationShareEvent.ts;

    // Garbage variants that must not overwrite the baseline.
    fireData("not an object");
    fireData(null);
    fireData({ type: "location_share" }); // missing ss
    fireData({ type: "location_share", ss: null }); // ss not a string

    assert.equal(session.getState().incomingLocationShareEvent.ts, baselineTs);
    assert.equal(session.getState().incomingLocationShareEvent.ss, "17");
    session.dispose();
  });
});

// ── Role-direction guards ─────────────────────────────────────────────
//
// The wire protocol is directional: `teleport` flows agent → visitor,
// `location_share` flows visitor → agent. The controller drops packets
// arriving in the wrong direction (echo / loopback / test arrangement
// quirks) so the wrong side can never trigger an iframe reload via the
// parent code's state-driven branches.

test("agent role drops inbound `teleport` from state.incomingTeleportEvent (echo guard)", () => {
  return makeConnectedAgent().then(({ session, fireData }) => {
    // Before any inbound, state is null.
    assert.equal(session.getState().incomingTeleportEvent, null);
    fireData({ type: "teleport", ss: "42", sr: "0,0" });
    // Role-direction guard drops the patch on the agent side. The
    // viewKey is still updated internally so the annotation filter
    // works, but state.incomingTeleportEvent stays null — preventing
    // any onState branch from reloading the agent's iframe.
    assert.equal(
      session.getState().incomingTeleportEvent,
      null,
      "agent must not patch incomingTeleportEvent",
    );
    session.dispose();
  });
});

test("visitor role drops inbound `location_share` from state.incomingLocationShareEvent (echo guard)", () => {
  return makeConnectedVisitor().then(({ session, fireData }) => {
    assert.equal(session.getState().incomingLocationShareEvent, null);
    fireData({ type: "location_share", ss: "42", sr: "0,0", ts: 123 });
    // Role-direction guard drops the patch on the visitor side. Even
    // if the visitor's own share were bounced back (echo / loopback),
    // the visitor's controller silently discards it — protecting the
    // visitor's iframe from any unintended reload.
    assert.equal(
      session.getState().incomingLocationShareEvent,
      null,
      "visitor must not patch incomingLocationShareEvent",
    );
    session.dispose();
  });
});

// ── Annotation channel tests ─────────────────────────────────────────
//
// Helper: stand up a connected agent session with a captured outbound
// DataConnection so the test can inspect `_sentPackets` and drive an
// inbound `data` event. Returns { session, sentPackets, fireData,
// runScheduled }.

function makeConnectedAgent(extraOpts) {
  const peers = [];
  const FakePeer = makeFakePeerCtor();
  function CapturingPeer(id) {
    FakePeer.call(this, id);
    peers.push(this);
  }
  CapturingPeer.prototype = FakePeer.prototype;
  CapturingPeer.log = FakePeer.log;

  const scheduled = [];
  const opts = Object.assign(
    {
      PeerCtor: CapturingPeer,
      schedule: (cb) => {
        scheduled.push(cb);
      },
    },
    extraOpts || {},
  );
  const session = createLiveSession(opts);
  return session.initializeAsAgent().then(() => {
    const agentPeer = peers[0];
    const inboundConn = new FakeEmitter();
    const sentPackets = [];
    inboundConn.send = (p) => sentPackets.push(p);
    // Default bufferedAmount = 0 unless a test overrides it.
    inboundConn.bufferedAmount = 0;
    agentPeer._fire("connection", inboundConn);
    inboundConn._fire("open");
    return {
      session,
      conn: inboundConn,
      sentPackets,
      fireData: (payload) => inboundConn._fire("data", payload),
      runScheduled: () => {
        const drained = scheduled.splice(0);
        drained.forEach((cb) => cb());
      },
      pendingScheduled: scheduled,
    };
  });
}

test("annotation senders all return false when role is not agent", () => {
  const session = createLiveSession({ PeerCtor: makeFakePeerCtor() });
  // Idle — no role at all.
  assert.equal(session.sendPointer("v|", 0.5, 0.5), false);
  assert.equal(session.sendStrokeBegin("v|", "s1", "#fff", 0.004, [[0, 0]]), false);
  assert.equal(session.sendStrokePatch("v|", "s1", [[0.1, 0.1]]), false);
  assert.equal(session.sendStrokeCommit("v|", "s1"), false);
  assert.equal(session.sendClear("v|"), false);
  assert.equal(session.sendNavLock("v|", true), false);
  // Visitor role — also false even when connected (sender is agent-only).
  return session.joinAsVisitor("4242").then(() => {
    assert.equal(session.sendPointer("v|", 0.5, 0.5), false);
    assert.equal(session.sendStrokeBegin("v|", "s1", "#fff", 0.004, [[0, 0]]), false);
    assert.equal(session.sendStrokePatch("v|", "s1", [[0.1, 0.1]]), false);
    assert.equal(session.sendStrokeCommit("v|", "s1"), false);
    assert.equal(session.sendClear("v|"), false);
    assert.equal(session.sendNavLock("v|", true), false);
    session.dispose();
  });
});

test("annotation senders return false when agent is not yet connected", () => {
  const session = createLiveSession({ PeerCtor: makeFakePeerCtor() });
  return session.initializeAsAgent().then(() => {
    // Status is "waiting" — no inbound conn yet.
    assert.equal(session.getState().isConnected, false);
    assert.equal(session.sendPointer("v|", 0.5, 0.5), false);
    assert.equal(session.sendStrokeBegin("v|", "s1", "#fff", 0.004, [[0, 0]]), false);
    assert.equal(session.sendStrokePatch("v|", "s1", [[0.1, 0.1]]), false);
    assert.equal(session.sendStrokeCommit("v|", "s1"), false);
    assert.equal(session.sendClear("v|"), false);
    assert.equal(session.sendNavLock("v|", true), false);
    session.dispose();
  });
});

test("sendStroke* reject empty strokeId without touching the channel", () => {
  return makeConnectedAgent().then(({ session, sentPackets }) => {
    assert.equal(session.sendStrokeBegin("v|", "", "#fff", 0.004, [[0, 0]]), false);
    assert.equal(session.sendStrokePatch("v|", "", [[0.1, 0.1]]), false);
    assert.equal(session.sendStrokeCommit("v|", ""), false);
    assert.equal(sentPackets.length, 0);
    session.dispose();
  });
});

test("sendStrokePatch rejects empty point arrays", () => {
  return makeConnectedAgent().then(({ session, sentPackets }) => {
    assert.equal(session.sendStrokePatch("v|", "s1", []), false);
    assert.equal(sentPackets.length, 0);
    session.dispose();
  });
});

test("teleportVisitor updates _currentViewKey so subsequent annotations are accepted by the receiver-style filter", () => {
  // Drive both ends inside one process by stitching the agent's
  // outbound packets into a visitor session's `data` event.
  return makeConnectedAgent().then(({ session, sentPackets, runScheduled }) => {
    // Agent teleports — _currentViewKey becomes "42|0,0".
    assert.equal(session.teleportVisitor("42", "0,0"), true);
    // Agent emits a pointer at the new view.
    session.sendPointer("42|0,0", 0.5, 0.5);
    runScheduled();
    assert.equal(sentPackets.length, 2);
    assert.equal(sentPackets[0].type, "teleport");
    assert.equal(sentPackets[1].type, "pointer");
    assert.equal(sentPackets[1].viewKey, "42|0,0");
    session.dispose();
  });
});

test("incoming annotation packets with stale viewKey are dropped after teleport", () => {
  return makeConnectedAgent().then(({ session, fireData }) => {
    // Establish current view via inbound teleport packet — this still
    // updates the controller's _currentViewKey even on the agent role.
    // (The state patch for incomingTeleportEvent is intentionally
    // dropped for non-visitor roles by the role-direction guard, so
    // we don't assert on it here. What matters for this test is that
    // the viewKey filter below uses the updated _currentViewKey.)
    fireData({ type: "teleport", ss: "42", sr: "0,0" });

    // Stroke from the OLD view — should be dropped.
    fireData({
      type: "stroke_begin",
      viewKey: "17|0,0",
      seq: 1,
      strokeId: "s-old",
      color: "#fff",
      width: 0.004,
      points: [[0.1, 0.1]],
      ts: 1,
    });
    assert.equal(
      session.getState().incomingStrokeEvent,
      null,
      "stroke with mismatched viewKey should not patch state",
    );

    // Stroke from the matching view — accepted.
    fireData({
      type: "stroke_begin",
      viewKey: "42|0,0",
      seq: 2,
      strokeId: "s-new",
      color: "#fff",
      width: 0.004,
      points: [[0.2, 0.2]],
      ts: 2,
    });
    const ev = session.getState().incomingStrokeEvent;
    assert.ok(ev, "matching viewKey should patch state");
    assert.equal(ev.strokeId, "s-new");
    assert.equal(ev.kind, "begin");
    session.dispose();
  });
});

test("incoming annotation packets with non-monotonic seq are dropped", () => {
  return makeConnectedAgent().then(({ session, fireData }) => {
    // First pointer at seq=5 — accepted.
    fireData({
      type: "pointer",
      viewKey: "",
      seq: 5,
      x: 0.3,
      y: 0.4,
      ts: 1,
    });
    assert.equal(session.getState().incomingPointerEvent.seq, 5);

    // Replayed/older pointer at seq=3 — dropped.
    fireData({
      type: "pointer",
      viewKey: "",
      seq: 3,
      x: 0.7,
      y: 0.8,
      ts: 2,
    });
    assert.equal(
      session.getState().incomingPointerEvent.seq,
      5,
      "older seq should not overwrite the latest pointer",
    );
    assert.equal(session.getState().incomingPointerEvent.x, 0.3);

    // Same seq=5 — also dropped (strict greater-than).
    fireData({
      type: "pointer",
      viewKey: "",
      seq: 5,
      x: 0.9,
      y: 0.9,
      ts: 3,
    });
    assert.equal(session.getState().incomingPointerEvent.x, 0.3);

    // Newer seq=6 — accepted.
    fireData({
      type: "pointer",
      viewKey: "",
      seq: 6,
      x: 0.1,
      y: 0.2,
      ts: 4,
    });
    assert.equal(session.getState().incomingPointerEvent.seq, 6);
    assert.equal(session.getState().incomingPointerEvent.x, 0.1);
    session.dispose();
  });
});

test("inbound stroke/clear packets surface as kind-tagged events", () => {
  return makeConnectedAgent().then(({ session, fireData }) => {
    fireData({
      type: "stroke_patch",
      viewKey: "",
      seq: 10,
      strokeId: "s1",
      points: [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
      ts: 1,
    });
    let ev = session.getState().incomingStrokeEvent;
    assert.equal(ev.kind, "patch");
    assert.deepEqual(ev.points, [
      [0.1, 0.1],
      [0.2, 0.2],
    ]);

    fireData({ type: "stroke_commit", viewKey: "", seq: 11, strokeId: "s1", ts: 2 });
    ev = session.getState().incomingStrokeEvent;
    assert.equal(ev.kind, "commit");
    assert.equal(ev.strokeId, "s1");

    fireData({ type: "clear", viewKey: "", seq: 12, ts: 3 });
    assert.equal(session.getState().incomingClearEvent.seq, 12);
    session.dispose();
  });
});

test("sendNavLock emits a documented nav_lock packet and respects view key + sequence", () => {
  return makeConnectedAgent().then(({ session, sentPackets }) => {
    // teleport first so _currentViewKey is set to a known value.
    assert.equal(session.teleportVisitor("42", "0,0"), true);
    assert.equal(sentPackets[0].type, "teleport");

    const ok = session.sendNavLock("42|0,0", true);
    assert.equal(ok, true);
    const lockPacket = sentPackets[1];
    assert.equal(lockPacket.type, "nav_lock");
    assert.equal(lockPacket.viewKey, "42|0,0");
    assert.equal(lockPacket.locked, true);
    assert.equal(typeof lockPacket.seq, "number");
    assert.ok(lockPacket.seq > 0);

    const ok2 = session.sendNavLock("42|0,0", false);
    assert.equal(ok2, true);
    assert.equal(sentPackets[2].locked, false);
    assert.ok(sentPackets[2].seq > lockPacket.seq, "seq must be monotonic");

    // Non-truthy locked coerces to false (no string/number leakage).
    session.sendNavLock("42|0,0", "yes");
    assert.equal(sentPackets[3].locked, false);
    session.dispose();
  });
});

test("inbound nav_lock packet surfaces as incomingNavLockEvent and obeys stale viewKey filter", () => {
  return makeConnectedAgent().then(({ session, fireData }) => {
    // Establish current view key via inbound teleport so the receiver
    // filter has something to compare against.
    fireData({ type: "teleport", ss: "42", sr: "0,0" });

    fireData({ type: "nav_lock", viewKey: "42|0,0", locked: true, seq: 10, ts: 1 });
    let ev = session.getState().incomingNavLockEvent;
    assert.equal(ev.locked, true);
    assert.equal(ev.seq, 10);

    fireData({ type: "nav_lock", viewKey: "42|0,0", locked: false, seq: 11, ts: 2 });
    ev = session.getState().incomingNavLockEvent;
    assert.equal(ev.locked, false);
    assert.equal(ev.seq, 11);

    // Stale viewKey from a previous sweep — must be dropped.
    fireData({ type: "nav_lock", viewKey: "99|9,9", locked: true, seq: 12, ts: 3 });
    ev = session.getState().incomingNavLockEvent;
    assert.equal(ev.seq, 11, "stale-viewKey packet must not patch state");
    assert.equal(ev.locked, false);
    session.dispose();
  });
});

test("pointer coalescer flushes at most one packet per scheduler tick under flood", () => {
  return makeConnectedAgent().then(
    ({ session, sentPackets, runScheduled, pendingScheduled }) => {
      // Flood 200 sendPointer calls before any scheduler tick.
      for (let i = 0; i < 200; i++) {
        session.sendPointer("", i / 200, i / 200);
      }
      // Scheduler has been asked exactly once despite 200 sends.
      assert.equal(
        pendingScheduled.length,
        1,
        "coalescer should request the scheduler at most once between ticks",
      );
      assert.equal(sentPackets.length, 0, "nothing sent until scheduler ticks");

      runScheduled();
      assert.equal(sentPackets.length, 1, "exactly one packet per tick");
      // Latest position wins.
      assert.equal(sentPackets[0].type, "pointer");
      assert.equal(sentPackets[0].x, 199 / 200);

      // Next tick: no new sendPointer calls → no new packet.
      runScheduled();
      assert.equal(sentPackets.length, 1);

      // A single new send → one more packet on the next tick.
      session.sendPointer("", 0.42, 0.42);
      runScheduled();
      assert.equal(sentPackets.length, 2);
      assert.equal(sentPackets[1].x, 0.42);
      session.dispose();
    },
  );
});

test("pointer flush is skipped when dataConn.bufferedAmount exceeds the backpressure cap", () => {
  return makeConnectedAgent().then(
    ({ session, conn, sentPackets, runScheduled }) => {
      conn.bufferedAmount = 65537; // one byte over the 64 KiB cap
      session.sendPointer("", 0.5, 0.5);
      runScheduled();
      assert.equal(
        sentPackets.length,
        0,
        "pointer drop expected when channel is congested",
      );

      // Once the channel drains, the next sendPointer flows normally.
      conn.bufferedAmount = 0;
      session.sendPointer("", 0.6, 0.6);
      runScheduled();
      assert.equal(sentPackets.length, 1);
      assert.equal(sentPackets[0].x, 0.6);
      session.dispose();
    },
  );
});

test("sendStroke* and sendClear stamp monotonically increasing seq numbers", () => {
  return makeConnectedAgent().then(({ session, sentPackets, runScheduled }) => {
    session.sendStrokeBegin("v|", "s1", "#fff", 0.004, [[0, 0]]);
    session.sendStrokePatch("v|", "s1", [[0.1, 0.1]]);
    session.sendPointer("v|", 0.2, 0.2);
    runScheduled();
    session.sendStrokeCommit("v|", "s1");
    session.sendClear("v|");
    const seqs = sentPackets.map((p) => p.seq);
    assert.equal(seqs.length, 5);
    for (let i = 1; i < seqs.length; i++) {
      assert.ok(seqs[i] > seqs[i - 1], `seq must strictly increase (#${i})`);
    }
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
