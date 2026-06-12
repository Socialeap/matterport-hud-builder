#!/usr/bin/env node

// Paired-controller regression suite for the P0 Explore Together
// host→guest direction fix. TWO REAL createLiveSession controllers are
// linked through bidirectional fake DataConnections — no isolated
// controllers, no direct state injection. Where a step belongs to the
// glue (applying a followed view), the harness performs the glue's
// documented contract call (noteCurrentView), exactly as both family
// glues now do inside applyTeleport.
//
// The ten cases pin the regression report's requirements:
//   1. guest location_share reaches the host exactly once
//   2. host teleport reaches the guest exactly once
//   3. host stroke appears on the guest (after share→follow — the P0 bug)
//   4. guest stroke appears on the host
//   5. eraser/delete, clear, nav_lock heartbeat work in both directions
//   6. an intentional host sync at its current displayed view still sends
//   7. applying a remote view creates no sync echo loop
//   8. both controllers agree on the viewKey after either sync direction
//   9. stale-view annotation packets remain rejected
//  10. duplicate/reconnect handling never leaves a stale outbound channel

import { test } from "node:test";
import assert from "node:assert/strict";
import { createLiveSession } from "../src/lib/portal/live-session.mjs";

// ── Fake peer infrastructure ──────────────────────────────────────────────
function Emitter() { this._h = {}; }
Emitter.prototype.on = function (ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); };
Emitter.prototype.emit = function (ev, arg) { (this._h[ev] || []).slice().forEach((fn) => fn(arg)); };

// A bidirectional pair of fake DataConnections: send() on one side
// synchronously emits "data" on the other (deterministic, ordered, with a
// JSON round-trip so payloads behave like the wire).
function makeConnPair() {
  const a = new Emitter();
  const b = new Emitter();
  a.openState = false; b.openState = false;
  a.send = (payload) => { if (!a.openState) throw new Error("Connection is not open"); b.emit("data", JSON.parse(JSON.stringify(payload))); };
  b.send = (payload) => { if (!b.openState) throw new Error("Connection is not open"); a.emit("data", JSON.parse(JSON.stringify(payload))); };
  a.openNow = b.openNow = () => { a.openState = true; b.openState = true; a.emit("open"); b.emit("open"); };
  a.close = b.close = () => { a.openState = false; b.openState = false; a.emit("close"); b.emit("close"); };
  return [a, b];
}

function makePeerWorld() {
  const registry = {};
  const instances = [];
  function FakePeer(id) {
    Emitter.call(this);
    this.id = typeof id === "string" ? id : `anon-${instances.length + 1}`;
    registry[this.id] = this;
    instances.push(this);
    setTimeout(() => this.emit("open", this.id), 0);
  }
  FakePeer.prototype = Object.create(Emitter.prototype);
  FakePeer.prototype.connect = function (targetId) {
    const [agentSide, visitorSide] = makeConnPair();
    setTimeout(() => {
      const target = registry[targetId];
      if (target) target.emit("connection", agentSide);
      visitorSide.openNow();
    }, 0);
    return visitorSide;
  };
  FakePeer.prototype.call = function () { return new Emitter(); };
  FakePeer.prototype.destroy = function () {};
  return { FakePeer, instances };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

async function pairedSession() {
  const world = makePeerWorld();
  const host = createLiveSession({ PeerCtor: world.FakePeer, deferVoice: true });
  const guest = createLiveSession({ PeerCtor: world.FakePeer, deferVoice: true });
  const { pin } = await host.initializeAsAgent();
  const hostPeer = world.instances[0];
  await guest.joinAsVisitor(pin);
  await tick(); await tick();
  assert.equal(host.getState().isConnected, true, "host connected");
  assert.equal(guest.getState().isConnected, true, "guest connected");
  return { host, guest, hostPeer };
}

// Count DISTINCT deliveries of an incoming event by object identity (each
// inbound packet patches a brand-new event object).
function eventCounter(session, field) {
  let last = session.getState()[field];
  let count = 0;
  session.subscribe((s) => {
    if (s[field] && s[field] !== last) { last = s[field]; count += 1; }
  });
  return () => count;
}

// The regression flow from the field report: host leads once (K0), guest
// navigates to K1 and shares, host follows — the glue applies the view and
// calls noteCurrentView (its documented contract, pinned in both
// family-glue suites).
async function shareFollowFlow({ host, guest }) {
  assert.equal(host.teleportVisitor("sweep0", "r0"), true);
  await tick();
  assert.equal(guest.shareLocationWithAgent("sweep1", "r1"), true);
  await tick();
  assert.ok(host.getState().incomingLocationShareEvent, "host received the share");
  assert.equal(host.noteCurrentView("sweep1", "r1"), true, "glue reports the followed view");
  await tick();
}

// ── 1 + 2: each sync direction delivers exactly once ─────────────────────
test("guest location_share reaches the host exactly once", async () => {
  const pair = await pairedSession();
  const shares = eventCounter(pair.host, "incomingLocationShareEvent");
  assert.equal(pair.guest.shareLocationWithAgent("s5", "1,1"), true);
  await tick();
  assert.equal(shares(), 1, "exactly one delivery");
  const ev = pair.host.getState().incomingLocationShareEvent;
  assert.equal(ev.ss, "s5");
});

test("host teleport reaches the guest exactly once", async () => {
  const pair = await pairedSession();
  const teleports = eventCounter(pair.guest, "incomingTeleportEvent");
  assert.equal(pair.host.teleportVisitor("s6", "2,2"), true);
  await tick();
  assert.equal(teleports(), 1, "exactly one delivery");
  assert.equal(pair.guest.getState().incomingTeleportEvent.ss, "s6");
});

// ── 3 + 4: strokes flow BOTH directions after share→follow (the P0 bug) ──
test("host stroke appears on the guest after the share→follow flow", async () => {
  const pair = await pairedSession();
  await shareFollowFlow(pair);
  // Host draws at the followed view — the glue stamps its (converged) key.
  assert.equal(pair.host.sendStrokeBegin("sweep1|r1", "s-host", "#fff", 3, [[0.1, 0.1]]), true);
  await tick();
  const ev = pair.guest.getState().incomingStrokeEvent;
  assert.ok(ev, "REGRESSION: the guest must receive the host stroke (was dropped pre-fix)");
  assert.equal(ev.strokeId, "s-host");
});

test("guest stroke appears on the host after the share→follow flow", async () => {
  const pair = await pairedSession();
  await shareFollowFlow(pair);
  assert.equal(pair.guest.sendStrokeBegin("sweep1|r1", "s-guest", "#fff", 3, [[0.2, 0.2]]), true);
  await tick();
  const ev = pair.host.getState().incomingStrokeEvent;
  assert.ok(ev, "guest stroke must reach the host");
  assert.equal(ev.strokeId, "s-guest");
});

// ── 5: eraser/clear/nav_lock heartbeat in both directions ────────────────
test("stroke_delete, clear, and nav_lock heartbeats flow in both directions", async () => {
  const pair = await pairedSession();
  await shareFollowFlow(pair);
  const key = "sweep1|r1";

  assert.equal(pair.host.sendStrokeDelete(key, ["a1"]), true);
  assert.equal(pair.host.sendClear(key), true);
  assert.equal(pair.host.sendNavLock(key, true), true); // floor heartbeat
  await tick();
  assert.deepEqual(pair.guest.getState().incomingStrokeDeleteEvent.strokeIds, ["a1"], "host eraser reaches guest");
  assert.ok(pair.guest.getState().incomingClearEvent, "host clear reaches guest");
  assert.equal(pair.guest.getState().incomingNavLockEvent.locked, true, "host heartbeat re-arms the guest watchdog");

  assert.equal(pair.guest.sendStrokeDelete(key, ["b2"]), true);
  assert.equal(pair.guest.sendClear(key), true);
  assert.equal(pair.guest.sendNavLock(key, false), true);
  await tick();
  assert.deepEqual(pair.host.getState().incomingStrokeDeleteEvent.strokeIds, ["b2"], "guest eraser reaches host");
  assert.ok(pair.host.getState().incomingClearEvent, "guest clear reaches host");
  assert.equal(pair.host.getState().incomingNavLockEvent.locked, false, "guest nav_lock reaches host");
});

// ── 6: intentional host sync at its displayed view still transmits ───────
test("an intentional host re-sync at its current displayed view is not suppressed", async () => {
  const pair = await pairedSession();
  await shareFollowFlow(pair);
  // The host is displaying sweep1|r1 (it followed the guest there) and now
  // intentionally pulls the guest BACK to that very view. The controller
  // must transmit (the glue-level provenance dedup is pinned in the family
  // suites; the controller never suppresses an explicit teleport).
  const teleports = eventCounter(pair.guest, "incomingTeleportEvent");
  assert.equal(pair.host.teleportVisitor("sweep1", "r1"), true, "REGRESSION: send at own current view must not be swallowed");
  await tick();
  assert.equal(teleports(), 1, "the guest receives the intentional re-sync");
  assert.equal(pair.guest.getState().incomingTeleportEvent.ss, "sweep1");
});

// ── 7: applying a remote view never echoes a sync back ───────────────────
test("applying a remote view does not create a sync echo loop", async () => {
  const pair = await pairedSession();
  const sharesAtHost = eventCounter(pair.host, "incomingLocationShareEvent");
  const teleportsAtGuest = eventCounter(pair.guest, "incomingTeleportEvent");
  assert.equal(pair.host.teleportVisitor("s9", "4,4"), true);
  await tick(); await tick();
  // The guest applied the view (glue contract: noteCurrentView, never a send).
  assert.equal(pair.guest.noteCurrentView("s9", "4,4"), true);
  await tick(); await tick();
  assert.equal(teleportsAtGuest(), 1, "one teleport in");
  assert.equal(sharesAtHost(), 0, "no share is ever echoed back to the host");
});

// ── 8: both controllers agree on the viewKey after either direction ──────
test("both controllers agree on the viewKey after either sync direction", async () => {
  const pair = await pairedSession();

  // Direction A: host-led teleport. Sender stamps its key on send; the
  // receiver stamps on receipt. Agreement is observable: packets keyed to
  // the synced view pass BOTH ways.
  assert.equal(pair.host.teleportVisitor("kA", "1"), true);
  await tick();
  assert.equal(pair.host.sendStrokeBegin("kA|1", "a1", "#fff", 2, [[0, 0]]), true);
  assert.equal(pair.guest.sendStrokeBegin("kA|1", "a2", "#fff", 2, [[0, 0]]), true);
  await tick();
  assert.equal(pair.guest.getState().incomingStrokeEvent.strokeId, "a1", "host→guest passes at kA");
  assert.equal(pair.host.getState().incomingStrokeEvent.strokeId, "a2", "guest→host passes at kA");

  // Direction B: guest-led share (sender stamps on send — the F1 fix) +
  // host follow (noteCurrentView — the glue contract).
  assert.equal(pair.guest.shareLocationWithAgent("kB", "2"), true);
  await tick();
  assert.equal(pair.host.noteCurrentView("kB", "2"), true);
  assert.equal(pair.host.sendStrokeBegin("kB|2", "b1", "#fff", 2, [[0, 0]]), true);
  assert.equal(pair.guest.sendStrokeBegin("kB|2", "b2", "#fff", 2, [[0, 0]]), true);
  await tick();
  assert.equal(pair.guest.getState().incomingStrokeEvent.strokeId, "b1", "host→guest passes at kB");
  assert.equal(pair.host.getState().incomingStrokeEvent.strokeId, "b2", "guest→host passes at kB");
});

// ── 9: stale-view packets remain rejected ────────────────────────────────
test("stale-view annotation packets are still rejected after the fix", async () => {
  const pair = await pairedSession();
  assert.equal(pair.host.teleportVisitor("fresh", "1"), true);
  await tick();
  // A packet stamped with a PREVIOUS sweep must not leak through.
  assert.equal(pair.host.sendStrokeBegin("stale|0", "old", "#fff", 2, [[0, 0]]), true);
  await tick();
  assert.equal(pair.guest.getState().incomingStrokeEvent, null, "stale-view stroke dropped");
  // And the live key still passes (the filter is selective, not blanket).
  assert.equal(pair.host.sendStrokeBegin("fresh|1", "new", "#fff", 2, [[0, 0]]), true);
  await tick();
  assert.equal(pair.guest.getState().incomingStrokeEvent.strokeId, "new");
});

// ── 10: duplicate/reconnect handling ─────────────────────────────────────
test("a duplicate inbound connection that never opens cannot kill the host channel", async () => {
  const pair = await pairedSession();
  assert.equal(pair.host.teleportVisitor("sA", "1"), true, "baseline send works");
  await tick();

  const [deadCandidate] = makeConnPair(); // never opened
  pair.hostPeer.emit("connection", deadCandidate);
  await tick();

  assert.equal(pair.host.getState().isConnected, true, "still connected");
  assert.equal(pair.host.teleportVisitor("sB", "2"), true,
    "REGRESSION: host sends keep working — the unopened candidate must not displace the live channel");
  await tick();
  assert.equal(pair.guest.getState().incomingTeleportEvent.ss, "sB", "guest still receives");
  assert.equal(pair.guest.shareLocationWithAgent("sC", "3"), true);
  await tick();
  assert.equal(pair.host.getState().incomingLocationShareEvent.ss, "sC", "host still receives");
});

test("a candidate that errors before opening leaves the active channel and state intact", async () => {
  const pair = await pairedSession();
  const [candidate] = makeConnPair();
  pair.hostPeer.emit("connection", candidate);
  candidate.emit("error", { type: "negotiation-failed" });
  candidate.emit("close");
  await tick();
  assert.equal(pair.host.getState().isConnected, true, "connected state untouched");
  assert.equal(pair.host.getState().error, null, "a failing candidate surfaces no error over a healthy channel");
  assert.equal(pair.host.teleportVisitor("sD", "4"), true, "sends unaffected");
  await tick();
  assert.equal(pair.guest.getState().incomingTeleportEvent.ss, "sD");
});

test("a reconnect candidate is adopted on open and the previous channel is closed", async () => {
  const pair = await pairedSession();
  const [hostSide, farSide] = makeConnPair();
  const received = [];
  farSide.on("data", (d) => received.push(d));
  pair.hostPeer.emit("connection", hostSide);
  await tick();
  // Pre-open: old channel still authoritative.
  assert.equal(pair.host.teleportVisitor("preE", "0"), true);
  await tick();
  assert.equal(pair.guest.getState().incomingTeleportEvent.ss, "preE", "old channel serves until adoption");

  hostSide.openNow(); // candidate opens → adopted; previous closed
  await tick();
  assert.equal(pair.host.getState().isConnected, true, "adoption keeps the session connected");
  assert.equal(pair.host.teleportVisitor("sE", "5"), true, "sends work over the adopted channel");
  await tick();
  assert.equal(received.at(-1).ss, "sE", "outbound traffic now rides the NEW channel");
  // The displaced guest-side conn saw a close; its controller reflects it —
  // exactly the signal a refreshed/reconnecting client expects.
  assert.equal(pair.guest.getState().isConnected, false, "the previous channel was actively closed");
});
