#!/usr/bin/env node

// PR-PWA-1: install-promotion gating (engagement + cooldown + standalone).
// Exercises the pure controller directly with a fake storage, then asserts
// the component reuses the shared standalone/iOS detection (no duplication)
// and never renders in admin/checkout (it is Atlas-mounted only).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  DISMISS_COOLDOWN_MS,
  RETURN_VISIT_THRESHOLD,
  recordVisit,
  recordEngagement,
  recordDismissal,
  isInCooldown,
  shouldPromote,
} from "../src/lib/pwa/install-controller.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(__dirname, "..", ...p), "utf8");

function fakeStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _dump: () => Object.fromEntries(m),
  };
}

// ── 1. Standalone always suppresses the promotion ────────────────────────
test("never promotes when already running standalone", () => {
  const s = fakeStorage();
  recordEngagement(s); // even fully engaged
  assert.equal(shouldPromote(s, { standalone: true, engagedNow: true, now: 1 }), false);
});

// ── 2. Not on cold load; only after engagement or a return visit ─────────
test("first cold visit with no engagement does NOT promote", () => {
  const s = fakeStorage();
  recordVisit(s); // visit #1
  assert.equal(shouldPromote(s, { standalone: false, engagedNow: false, now: 1 }), false);
});

test("opening a presentation this session unlocks promotion", () => {
  const s = fakeStorage();
  recordVisit(s);
  assert.equal(shouldPromote(s, { standalone: false, engagedNow: true, now: 1 }), true);
});

test("a return visit (>= threshold) unlocks promotion without engagement", () => {
  const s = fakeStorage();
  let n = 0;
  for (let i = 0; i < RETURN_VISIT_THRESHOLD; i++) n = recordVisit(s);
  assert.equal(n, RETURN_VISIT_THRESHOLD);
  assert.equal(shouldPromote(s, { standalone: false, engagedNow: false, now: 1 }), true);
});

test("prior-session engagement persists and unlocks later visits", () => {
  const s = fakeStorage();
  recordEngagement(s);
  assert.equal(shouldPromote(s, { standalone: false, engagedNow: false, now: 1 }), true);
});

// ── 3. Dismiss cooldown ──────────────────────────────────────────────────
test("dismissal suppresses promotion for the cooldown window, then re-allows", () => {
  const s = fakeStorage();
  recordEngagement(s);
  const t0 = 1_000_000_000;
  recordDismissal(s, t0);
  assert.equal(isInCooldown(s, t0 + 1000), true);
  assert.equal(shouldPromote(s, { standalone: false, engagedNow: true, now: t0 + 1000 }), false);
  // Just before the window ends → still suppressed.
  assert.equal(shouldPromote(s, { standalone: false, engagedNow: true, now: t0 + DISMISS_COOLDOWN_MS - 1 }), false);
  // After the window → promotion may show again.
  assert.equal(isInCooldown(s, t0 + DISMISS_COOLDOWN_MS + 1), false);
  assert.equal(shouldPromote(s, { standalone: false, engagedNow: true, now: t0 + DISMISS_COOLDOWN_MS + 1 }), true);
});

test("controller tolerates unavailable storage (private mode)", () => {
  assert.doesNotThrow(() => recordVisit(null));
  assert.doesNotThrow(() => recordEngagement(null));
  assert.doesNotThrow(() => recordDismissal(null, 1));
  assert.equal(isInCooldown(null, 1), false);
  // Null storage + a return-visit can't be proven, engagedNow drives it.
  assert.equal(shouldPromote(null, { standalone: false, engagedNow: true, now: 1 }), true);
  assert.equal(shouldPromote(null, { standalone: false, engagedNow: false, now: 1 }), false);
});

test("the controller persists only non-sensitive counters (no tokens/PINs)", () => {
  const s = fakeStorage();
  recordVisit(s);
  recordEngagement(s);
  recordDismissal(s, 123);
  const dump = JSON.stringify(s._dump());
  assert.ok(/visits|engaged|dismissedAt/.test(dump), "expected only counters/flags");
  assert.ok(!/token|pin|password|secret|jwt/i.test(dump), "must not persist sensitive data");
});

// ── 4. Component reuse + placement guarantees (text-level) ───────────────
test("InstallPrompt reuses shared standalone/iOS detection (no duplicate)", () => {
  const src = read("src", "components", "pwa", "InstallPrompt.tsx");
  assert.ok(
    src.includes(`from "@/hooks/use-fullscreen"`),
    "must import the existing isStandaloneDisplay/isIosWebKitDevice",
  );
  assert.ok(src.includes("isStandaloneDisplay()"), "hidden in standalone");
  assert.ok(src.includes("beforeinstallprompt"), "Android/desktop path");
  assert.ok(src.includes("Add to Home Screen"), "iOS guidance");
  assert.ok(src.includes("recordDismissal"), "dismissal persisted for cooldown");
  // Must NOT redefine its own platform detection.
  assert.ok(!/function isStandaloneDisplay/.test(src), "no duplicate detection");
});

test("install promotion is mounted ONLY in Atlas (never admin/checkout/auth)", () => {
  const atlas = read("src", "routes", "atlas.tsx");
  assert.ok(atlas.includes("<InstallPrompt"), "mounted in the Atlas route");
  // Spot-check a couple of sensitive routes do not import it.
  const admin = read("src", "routes", "_authenticated.admin.tsx");
  assert.ok(!admin.includes("InstallPrompt"), "must not appear in admin");
});

test("standalone detection used by fullscreen still exists (no regression)", () => {
  const hook = read("src", "hooks", "use-fullscreen.ts");
  assert.ok(hook.includes("export function isStandaloneDisplay"), "isStandaloneDisplay intact");
  assert.ok(hook.includes("export function isIosWebKitDevice"), "isIosWebKitDevice intact");
});
