#!/usr/bin/env node

// Tests for the deferred-voice startup policy in the live-session
// controller (P0 iPad connect-crash hardening). With deferVoice:
//   - the connect transition is data-only: no getUserMedia, no silent
//     AudioContext fallback, no automatic media call in either role;
//   - incoming calls are HELD until startVoice() (a user gesture);
//   - startVoice() answers a held offer (receive-only when no mic) or
//     places the visitor call; every failure leaves the data channel
//     untouched.
// Node has no navigator.mediaDevices and no AudioContext, so the mic
// path deterministically resolves null here — exactly the worst case
// the policy must survive.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveSession } from "../src/lib/portal/live-session.mjs";

const tick = () => new Promise((r) => setImmediate(r));

class FakeEmitter {
  constructor() {
    this._h = Object.create(null);
  }
  on(ev, fn) {
    (this._h[ev] || (this._h[ev] = [])).push(fn);
  }
  emit(ev, ...args) {
    (this._h[ev] || []).forEach((f) => f(...args));
  }
}

class FakeConn extends FakeEmitter {
  constructor(peerId) {
    super();
    this.peer = peerId;
    this.sent = [];
    this.closed = false;
  }
  send(p) {
    this.sent.push(p);
  }
  close() {
    this.closed = true;
    this.emit("close");
  }
}

class FakeCall extends FakeEmitter {
  constructor(peerId, stream) {
    super();
    this.peer = peerId;
    this.stream = stream;
    this.answered = [];
    this.closed = false;
  }
  answer(stream) {
    this.answered.push(stream === undefined ? null : stream);
  }
  close() {
    this.closed = true;
    this.emit("close");
  }
}

class FakePeer extends FakeEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.placedCalls = [];
    this.destroyed = false;
    FakePeer.last = this;
  }
  connect(id) {
    this.conn = new FakeConn(id);
    return this.conn;
  }
  call(id, stream) {
    const c = new FakeCall(id, stream);
    this.placedCalls.push(c);
    return c;
  }
  destroy() {
    this.destroyed = true;
  }
}

async function connectedAgent({ deferVoice, diags }) {
  const session = createLiveSession({
    PeerCtor: FakePeer,
    deferVoice,
    onDiagnostic: diags ? (n) => diags.push(n) : undefined,
  });
  const init = session.initializeAsAgent();
  FakePeer.last.emit("open");
  await init;
  const peer = FakePeer.last;
  const conn = new FakeConn("TourGuest-abc");
  peer.emit("connection", conn);
  conn.emit("open");
  assert.equal(session.getState().isConnected, true, "data channel up");
  return { session, peer, conn };
}

test("deferVoice visitor: joining places NO automatic media call", async () => {
  const diags = [];
  const session = createLiveSession({
    PeerCtor: FakePeer,
    deferVoice: true,
    onDiagnostic: (n) => diags.push(n),
  });
  const join = session.joinAsVisitor("1234");
  FakePeer.last.emit("open");
  await join;
  await tick();
  assert.equal(FakePeer.last.placedCalls.length, 0, "no auto media call on iOS");
  assert.ok(!diags.includes("mic_requested"), "mic must not be touched at connect");
  FakePeer.last.conn.emit("open");
  assert.equal(session.getState().isConnected, true);
  assert.ok(diags.includes("data_connected"), "data milestone still reported");
});

test("deferVoice agent: incoming call is HELD, then answered receive-only by startVoice()", async () => {
  const diags = [];
  const { session, peer } = await connectedAgent({ deferVoice: true, diags });
  const call = new FakeCall("TourGuest-abc");
  peer.emit("call", call);
  await tick();
  assert.equal(call.answered.length, 0, "offer must be held until the user gesture");
  const ok = await session.startVoice();
  assert.equal(ok, true, "startVoice answers the held offer");
  assert.equal(call.answered.length, 1, "answered exactly once");
  assert.equal(call.answered[0], null, "receive-only: no mic and NO silent AudioContext");
  assert.ok(diags.includes("mic_denied"), "node mic unavailability reported as denied");
  assert.ok(diags.includes("media_call_started"));
  const fakeStream = { id: "remote" };
  call.emit("stream", fakeStream);
  assert.equal(session.getState().remoteStream, fakeStream);
  assert.ok(diags.includes("remote_stream"));
  assert.equal(session.getState().isConnected, true, "data channel untouched throughout");
});

test("deferVoice agent: startVoice before any offer resolves false and keeps data alive", async () => {
  const { session, conn } = await connectedAgent({ deferVoice: true });
  const ok = await session.startVoice();
  assert.equal(ok, false, "nothing to answer and no mic to call with");
  assert.equal(session.getState().isConnected, true);
  assert.equal(conn.closed, false, "data connection never closed by a voice failure");
});

test("deferVoice agent: an offer arriving AFTER the user enabled voice is answered immediately", async () => {
  const { session, peer } = await connectedAgent({ deferVoice: true });
  await session.startVoice(); // user gesture happened; grant remembered
  const call = new FakeCall("TourGuest-abc");
  peer.emit("call", call);
  await tick();
  assert.equal(call.answered.length, 1, "late offer answered without a second tap");
});

test("deferVoice visitor: startVoice without a microphone resolves false, data unaffected", async () => {
  const session = createLiveSession({ PeerCtor: FakePeer, deferVoice: true });
  const join = session.joinAsVisitor("1234");
  FakePeer.last.emit("open");
  await join;
  FakePeer.last.conn.emit("open");
  const ok = await session.startVoice();
  assert.equal(ok, false, "no mic in this environment → visitor cannot place the call");
  assert.equal(FakePeer.last.placedCalls.length, 0);
  assert.equal(session.getState().isConnected, true);
});

test("non-deferred agent keeps the legacy auto-answer behavior", async () => {
  const { session, peer } = await connectedAgent({ deferVoice: false });
  const call = new FakeCall("TourGuest-abc");
  peer.emit("call", call);
  await tick();
  await tick();
  assert.equal(call.answered.length, 1, "desktop sessions still answer automatically");
  assert.equal(session.getState().isConnected, true);
});

test("dispose closes a held pending offer", async () => {
  const { session, peer } = await connectedAgent({ deferVoice: true });
  const call = new FakeCall("TourGuest-abc");
  peer.emit("call", call);
  await tick();
  session.dispose();
  assert.equal(call.closed, true, "held offer must not leak past dispose");
});
