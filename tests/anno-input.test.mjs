#!/usr/bin/env node

// Tests for the shared mobile-input hardening module
// (src/lib/portal/anno-input.mjs): browser-safety gates (same rules as the
// other injected runtime .mjs files) plus direct behavioral coverage of the
// pointer-ownership guard, coalesced-point collection, DPR clamping,
// coarse-pointer detection, and viewport-event binding.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  findForbiddenTokens,
  stripExports,
} from "../src/lib/portal/ask-runtime-transformer.mjs";
import {
  createAnnoPointerGuard,
  annoCollectPoints,
  annoClampDpr,
  annoIsIosWebKit,
  annoIsCoarsePointer,
  annoBindViewportEvents,
} from "../src/lib/portal/anno-input.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.join(__dirname, "..", "src", "lib", "portal", "anno-input.mjs");
const RAW = readFileSync(SOURCE, "utf8");
const STRIPPED = stripExports(RAW);

// ── 1. Browser-safety gates ──────────────────────────────────────────────
test("anno-input passes the browser-safety token gate", () => {
  const offenders = findForbiddenTokens(STRIPPED);
  assert.deepEqual(offenders, [], `forbidden tokens: ${offenders.join(", ")}`);
});

test("anno-input contains no single-quote string literals", () => {
  const lines = RAW.split("\n");
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.startsWith("//")) continue;
    if (t.indexOf(String.fromCharCode(39)) !== -1) bad.push(i + 1);
  }
  assert.deepEqual(bad, [], `single-quote on lines: ${bad.join(", ")}`);
});

test("anno-input parses cleanly as a function body", () => {
  assert.doesNotThrow(() => {
    // eslint-disable-next-line no-new-func
    new Function(STRIPPED);
  });
});

// ── 2. Pointer-ownership guard ───────────────────────────────────────────
const touch = (id, primary = true) => ({ pointerId: id, pointerType: "touch", isPrimary: primary });
const pen = (id) => ({ pointerId: id, pointerType: "pen", isPrimary: true });
const mouse = (id) => ({ pointerId: id, pointerType: "mouse", isPrimary: true });

test("guard: primary touch claims; the same pointer owns; release frees it", () => {
  const g = createAnnoPointerGuard({});
  assert.equal(g.claim(touch(7)), true);
  assert.equal(g.isActive(), true);
  assert.equal(g.activePointerType(), "touch");
  assert.equal(g.owns(touch(7)), true);
  assert.equal(g.owns(touch(8)), false);
  assert.equal(g.release(touch(7)), true);
  assert.equal(g.isActive(), false);
});

test("guard: a non-primary touch can never start a gesture", () => {
  const g = createAnnoPointerGuard({});
  assert.equal(g.claim(touch(2, false)), false, "second finger must not claim");
  assert.equal(g.isActive(), false);
});

test("guard: a second touch is rejected while the first owns the gesture", () => {
  const g = createAnnoPointerGuard({});
  assert.equal(g.claim(touch(1)), true);
  assert.equal(g.claim(touch(2)), false, "no concurrent touch ownership");
  assert.equal(g.owns(touch(1)), true, "original owner unaffected");
});

test("guard: pointerId 0 is a valid owner (Firefox mouse)", () => {
  const g = createAnnoPointerGuard({});
  assert.equal(g.claim(mouse(0)), true);
  assert.equal(g.owns(mouse(0)), true);
  assert.equal(g.release(mouse(0)), true);
});

test("guard: pen takes over from touch, firing onTakeover first (palm rejection)", () => {
  const order = [];
  const g = createAnnoPointerGuard({
    onTakeover: () => order.push("takeover"),
  });
  assert.equal(g.claim(touch(1)), true);
  assert.equal(g.claim(pen(9)), true, "pen must take over a touch gesture");
  order.push("claimed");
  assert.deepEqual(order, ["takeover", "claimed"], "onTakeover fires before the pen owns");
  assert.equal(g.owns(pen(9)), true);
  assert.equal(g.owns(touch(1)), false, "the displaced touch no longer owns");
  assert.equal(g.activePointerType(), "pen");
});

test("guard: takeover applies only to pen-over-touch", () => {
  const g = createAnnoPointerGuard({ onTakeover: () => assert.fail("must not fire") });
  assert.equal(g.claim(pen(1)), true);
  assert.equal(g.claim(pen(2)), false, "pen cannot steal from pen");
  g.reset();
  assert.equal(g.claim(mouse(1)), true);
  assert.equal(g.claim(touch(2)), false, "touch cannot steal from mouse");
  assert.equal(g.claim(pen(3)), false, "pen cannot steal from mouse");
});

test("guard: a throwing onTakeover does not block the pen claim", () => {
  const g = createAnnoPointerGuard({
    onTakeover: () => {
      throw new Error("boom");
    },
  });
  assert.equal(g.claim(touch(1)), true);
  assert.equal(g.claim(pen(2)), true);
  assert.equal(g.owns(pen(2)), true);
});

test("guard: release by a non-owner is refused and keeps ownership", () => {
  const g = createAnnoPointerGuard({});
  assert.equal(g.claim(touch(1)), true);
  assert.equal(g.release(touch(2)), false);
  assert.equal(g.owns(touch(1)), true);
  g.reset();
  assert.equal(g.isActive(), false);
});

// ── 3. Coalesced point collection ────────────────────────────────────────
const mapXY = (e) => ({ x: e.clientX, y: e.clientY });

test("annoCollectPoints falls back to the single event without coalescing support", () => {
  const pts = annoCollectPoints({ clientX: 5, clientY: 6 }, mapXY);
  assert.deepEqual(pts, [{ x: 5, y: 6 }]);
});

test("annoCollectPoints maps every coalesced sample, oldest first", () => {
  const e = {
    clientX: 30,
    clientY: 30,
    getCoalescedEvents: () => [
      { clientX: 10, clientY: 10 },
      { clientX: 20, clientY: 20 },
      { clientX: 30, clientY: 30 },
    ],
  };
  assert.deepEqual(annoCollectPoints(e, mapXY), [
    { x: 10, y: 10 },
    { x: 20, y: 20 },
    { x: 30, y: 30 },
  ]);
});

test("annoCollectPoints tolerates a throwing getCoalescedEvents", () => {
  const e = {
    clientX: 1,
    clientY: 2,
    getCoalescedEvents: () => {
      throw new Error("nope");
    },
  };
  assert.deepEqual(annoCollectPoints(e, mapXY), [{ x: 1, y: 2 }]);
});

test("annoCollectPoints guards bad inputs", () => {
  assert.deepEqual(annoCollectPoints(null, mapXY), []);
  assert.deepEqual(annoCollectPoints({ clientX: 1 }, null), []);
});

// ── 4. DPR clamp ─────────────────────────────────────────────────────────
test("annoClampDpr clamps at the cap and sanitizes garbage", () => {
  assert.equal(annoClampDpr(1, 2.5), 1);
  assert.equal(annoClampDpr(2, 2.5), 2);
  assert.equal(annoClampDpr(3, 2.5), 2.5, "3x phones clamp to the cap");
  assert.equal(annoClampDpr(3, 2), 2, "custom cap respected");
  assert.equal(annoClampDpr(0, 2.5), 1, "non-positive input maps to 1");
  assert.equal(annoClampDpr(NaN, 2.5), 1);
  assert.equal(annoClampDpr(undefined, 2.5), 1);
  assert.equal(annoClampDpr(3, NaN), 2.5, "garbage cap maps to the 2.5 default");
});

// ── 4b. iOS / iPadOS WebKit detection ────────────────────────────────────
test("annoIsIosWebKit detects classic iOS identifiers (platform and UA, incl. iOS Chrome)", () => {
  assert.equal(annoIsIosWebKit({ platform: "iPhone", maxTouchPoints: 5 }), true);
  assert.equal(annoIsIosWebKit({ platform: "iPad", maxTouchPoints: 5 }), true);
  assert.equal(
    annoIsIosWebKit({
      platform: "",
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0",
      maxTouchPoints: 5,
    }),
    true,
    "iOS Chrome (CriOS) carries iPhone in the UA",
  );
});

test("annoIsIosWebKit detects iPad desktop mode (MacIntel + maxTouchPoints > 1)", () => {
  assert.equal(
    annoIsIosWebKit({
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
    }),
    true,
  );
});

test("annoIsIosWebKit stays false for real desktops and bad input", () => {
  assert.equal(
    annoIsIosWebKit({ platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh…)", maxTouchPoints: 0 }),
    false,
    "a real Mac has no touch points",
  );
  assert.equal(
    annoIsIosWebKit({ platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0)", maxTouchPoints: 0 }),
    false,
  );
  assert.equal(annoIsIosWebKit({}), false, "empty navigator fails closed to false");
});

// ── 5. Coarse-pointer detection ──────────────────────────────────────────
test("annoIsCoarsePointer reflects the media query and fails closed", () => {
  assert.equal(
    annoIsCoarsePointer({ matchMedia: (q) => ({ matches: q === "(pointer: coarse)" }) }),
    true,
  );
  assert.equal(annoIsCoarsePointer({ matchMedia: () => ({ matches: false }) }), false);
  assert.equal(annoIsCoarsePointer({}), false, "no matchMedia → fine pointer assumed");
  assert.equal(
    annoIsCoarsePointer({
      matchMedia: () => {
        throw new Error("blocked");
      },
    }),
    false,
  );
});

// ── 6. Viewport-event binding ────────────────────────────────────────────
function recordingTarget() {
  const handlers = {};
  return {
    handlers,
    addEventListener(ev, fn) {
      (handlers[ev] || (handlers[ev] = [])).push(fn);
    },
    removeEventListener(ev, fn) {
      const list = handlers[ev] || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
  };
}

test("annoBindViewportEvents binds visualViewport resize + orientationchange and unbinds cleanly", () => {
  const win = recordingTarget();
  win.visualViewport = recordingTarget();
  let fired = 0;
  const unbind = annoBindViewportEvents(win, () => {
    fired += 1;
  });
  assert.equal(win.visualViewport.handlers.resize.length, 1);
  assert.equal(win.handlers.orientationchange.length, 1);
  win.visualViewport.handlers.resize[0]();
  win.handlers.orientationchange[0]();
  assert.equal(fired, 2);
  unbind();
  assert.equal(win.visualViewport.handlers.resize.length, 0, "vv listener removed");
  assert.equal(win.handlers.orientationchange.length, 0, "orientation listener removed");
});

test("annoBindViewportEvents tolerates a missing visualViewport and bad args", () => {
  const win = recordingTarget();
  const unbind = annoBindViewportEvents(win, () => {});
  assert.equal(win.handlers.orientationchange.length, 1, "orientation still bound");
  assert.equal(win.handlers.resize, undefined, "nothing bound on the window itself");
  unbind();
  assert.equal(typeof annoBindViewportEvents(null, () => {}), "function");
  assert.equal(typeof annoBindViewportEvents(win, null), "function");
});
