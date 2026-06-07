#!/usr/bin/env node

// Tests for the two-mode fullscreen policy (src/hooks/use-fullscreen.ts):
//   - Maximize (CSS pseudo-fullscreen) is the DEFAULT on iOS/iPadOS — the
//     safe mode for annotation, immune to the iPadOS swipe-exit gesture;
//   - native Device fullscreen is the desktop default and an OPTIONAL
//     secondary passive-viewing mode on iPad (so requestNativeFullscreen
//     is a pure attempt — no platform refusal; the iOS-default policy
//     lives in defaultFullscreenIntent);
//   - Device fullscreen is hidden where the API is absent (iPhone) or in
//     standalone app mode.
// React-effect behaviors (class toggling, scroll lock, Escape, the
// interaction auto-switch) need a DOM renderer the repo deliberately does
// not carry — covered at the text level, alongside the no-touch-action
// guarantee and the CSS rules.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isIosWebKitDevice,
  isStandaloneDisplay,
  deviceFullscreenApiAvailable,
  planImmersiveToggle,
  immersiveButtonLabel,
  requestNativeFullscreen,
} from "../src/hooks/use-fullscreen.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(path.join(__dirname, "..", ...p), "utf8");

const IOS_NAV = { platform: "iPhone", userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15", maxTouchPoints: 5 };
const IPAD_DESKTOP_NAV = { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", maxTouchPoints: 5 };
const IOS_CHROME_NAV = { platform: "", userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0", maxTouchPoints: 5 };
const MAC_NAV = { platform: "MacIntel", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", maxTouchPoints: 0 };
const WIN_NAV = { platform: "Win32", userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", maxTouchPoints: 0 };

// ── 1. Device detection ──────────────────────────────────────────────────
test("isIosWebKitDevice detects iPhone, iPad desktop mode, and iOS Chrome", () => {
  assert.equal(isIosWebKitDevice(IOS_NAV), true);
  assert.equal(isIosWebKitDevice(IPAD_DESKTOP_NAV), true, "MacIntel + maxTouchPoints > 1");
  assert.equal(isIosWebKitDevice(IOS_CHROME_NAV), true, "CriOS UA carries iPad/iPhone");
});

test("isIosWebKitDevice stays false for real desktops and bad input", () => {
  assert.equal(isIosWebKitDevice(MAC_NAV), false, "a real Mac has no touch points");
  assert.equal(isIosWebKitDevice(WIN_NAV), false);
  assert.equal(isIosWebKitDevice({}), false, "empty navigator fails closed to false");
});

// ── 2. Unified immersive plan: Device-first, Maximize fallback ───────────
// (Items 3/4: device-success → device; device-reject/unavailable → maximize.)
test("planImmersiveToggle prefers Device fullscreen, falls back to Maximize, and exits when active", () => {
  // Nothing active + device supported → enter Device fullscreen.
  assert.equal(
    planImmersiveToggle({ nativeActive: false, maximized: false, supportsDevice: true }),
    "device",
  );
  // Nothing active + device unsupported (iPhone / standalone) → Maximize.
  assert.equal(
    planImmersiveToggle({ nativeActive: false, maximized: false, supportsDevice: false }),
    "maximize",
  );
  // Already immersive (either mode) → exit, regardless of support.
  assert.equal(
    planImmersiveToggle({ nativeActive: true, maximized: false, supportsDevice: true }),
    "exit",
  );
  assert.equal(
    planImmersiveToggle({ nativeActive: false, maximized: true, supportsDevice: true }),
    "exit",
  );
  assert.equal(
    planImmersiveToggle({ nativeActive: false, maximized: true, supportsDevice: false }),
    "exit",
  );
});

// (Item 6: standalone/iPhone relabel — never "Fullscreen" when device is
// unavailable. Item 5: combined-state drives the exit label.)
test("immersiveButtonLabel relabels to Maximize without device support and Exit when active", () => {
  // Device available, not active → "Fullscreen".
  assert.deepEqual(immersiveButtonLabel({ active: false, supportsDevice: true }), {
    label: "Fullscreen",
    title: "Enter fullscreen",
    aria: "Enter fullscreen",
  });
  // No device (standalone / iPhone), not active → "Maximize", NOT "Fullscreen".
  const noDevice = immersiveButtonLabel({ active: false, supportsDevice: false });
  assert.equal(noDevice.label, "Maximize");
  assert.ok(!/fullscreen/i.test(noDevice.title), "must not say fullscreen without device support");
  // Active (combined isFullscreen) → "Exit" in either mode.
  assert.equal(immersiveButtonLabel({ active: true, supportsDevice: true }).label, "Exit");
  assert.equal(immersiveButtonLabel({ active: true, supportsDevice: false }).label, "Exit");
});

// ── 2b. requestNativeFullscreen — pure attempt, no platform refusal ──────
// (The Device-first action uses this everywhere it tries native; the
// device-vs-maximize choice lives in planImmersiveToggle /
// supportsDeviceFullscreen, not here.)
function fsElementSpy({ reject = false } = {}) {
  const calls = { request: 0 };
  return {
    calls,
    el: {
      requestFullscreen() {
        calls.request += 1;
        return reject ? Promise.reject(new TypeError("denied")) : Promise.resolve();
      },
    },
  };
}

test("requestNativeFullscreen attempts whenever the API exists (incl. iPad)", async () => {
  const { calls, el } = fsElementSpy();
  assert.equal(await requestNativeFullscreen(el), true);
  assert.equal(calls.request, 1, "the secondary Device-fullscreen path must reach native");
});

test("requestNativeFullscreen returns false on rejection (e.g. iframe without allow)", async () => {
  const { calls, el } = fsElementSpy({ reject: true });
  assert.equal(await requestNativeFullscreen(el), false);
  assert.equal(calls.request, 1, "the attempt was made before falling back");
});

test("requestNativeFullscreen returns false when the API is missing", async () => {
  assert.equal(await requestNativeFullscreen({}), false);
});

test("requestNativeFullscreen uses the webkit-prefixed request when present", async () => {
  let called = 0;
  const el = {
    webkitRequestFullscreen() {
      called += 1;
      return Promise.resolve();
    },
  };
  assert.equal(await requestNativeFullscreen(el), true);
  assert.equal(called, 1);
});

// ── 2c. Standalone + device-API availability (controls visibility) ───────
test("isStandaloneDisplay reads display-mode and navigator.standalone", () => {
  assert.equal(
    isStandaloneDisplay({ matchMedia: (q) => ({ matches: q === "(display-mode: standalone)" }), navigator: {} }),
    true,
  );
  assert.equal(
    isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigator: { standalone: true } }),
    true,
    "iOS Safari PWA flag",
  );
  assert.equal(
    isStandaloneDisplay({ matchMedia: () => ({ matches: false }), navigator: {} }),
    false,
  );
  assert.equal(isStandaloneDisplay(null), false);
});

test("deviceFullscreenApiAvailable reflects element-fullscreen support (iPhone has none)", () => {
  const ipadLike = { Element: { prototype: { webkitRequestFullscreen() {} } } };
  const desktopLike = { Element: { prototype: { requestFullscreen() {} } } };
  const iphoneLike = { Element: { prototype: {} } };
  assert.equal(deviceFullscreenApiAvailable(ipadLike), true);
  assert.equal(deviceFullscreenApiAvailable(desktopLike), true);
  assert.equal(deviceFullscreenApiAvailable(iphoneLike), false, "no element fullscreen on iPhone");
  assert.equal(deviceFullscreenApiAvailable(null), false);
});

// ── 3. Hook wiring + CSS guarantees (text-level; no DOM renderer) ────────
test("the hook wires the unified immersive action, auto-switch, classes + Escape", () => {
  const src = read("src", "hooks", "use-fullscreen.ts");
  // The single action routes through the shared planner.
  assert.ok(src.includes("planImmersiveToggle({"), "toggleImmersive uses the planner");
  assert.ok(src.includes("requestNativeFullscreen(el)"), "native attempt wired");
  assert.ok(src.includes("setIsMaximized(true)"), "maximize fallback present");
  assert.ok(src.includes("toggleImmersive"), "unified action exported");
  // The contradicted per-platform default is gone.
  assert.ok(!src.includes("defaultFullscreenIntent"), "defaultFullscreenIntent removed");
  // Item 7 — auto-switch: device fullscreen → Maximize on interaction.
  assert.ok(src.includes("ensureSafeForInteraction"), "interaction auto-switch exported");
  assert.ok(
    src.includes("void exitNativeFullscreen()") && src.includes("setIsMaximized(true)"),
    "auto-switch exits native then maximizes",
  );
  assert.ok(src.includes(`"atlas-shell--pseudo-fs"`), "pseudo class constant present");
  assert.ok(src.includes(`"atlas-pseudo-fs-lock"`), "body scroll-lock class constant present");
  assert.ok(
    src.includes(`document.body.classList.add(BODY_LOCK_CLASS)`) &&
      src.includes(`document.body.classList.remove(BODY_LOCK_CLASS)`),
    "body lock added while active, removed on exit/unmount",
  );
  assert.ok(src.includes(`e.key === "Escape"`), "Escape exits Maximize");
  // Item 8 — the hook must not introduce touch-action styling.
  assert.ok(!src.includes("touchAction"), "hook introduces no touch-action");
});

// Item 1 + 2: the /atlas shell button AND the modal each render exactly ONE
// primary immersive control wired to the unified toggleImmersive action,
// with the de-emphasized secondary device control removed entirely.
test("shell + modal use the SAME unified immersive action, one button each", () => {
  const src = read("src", "routes", "atlas.tsx");
  // Single shared label helper imported from the hook.
  assert.ok(src.includes("immersiveButtonLabel"), "uses the shared label helper");
  // Shell button.
  assert.ok(src.includes("onClick={toggleShellImmersive}"), "shell button calls toggleImmersive");
  // Modal button.
  assert.ok(src.includes("onClick={toggleImmersive}"), "modal button calls toggleImmersive");
  // The confusing second control and its icon are gone.
  assert.ok(!src.includes("atlas-modal-ctrl--device"), "secondary device button removed");
  assert.ok(!src.includes("Monitor"), "Monitor (device) icon import removed");
  assert.ok(!src.includes("isIos ?"), "no iOS-branched control cluster");
  // Exactly one primary fullscreen control in the modal controls.
  const fullscreenButtons = (src.match(/atlas-modal-ctrl--fullscreen/g) || []).length;
  assert.equal(fullscreenButtons, 1, "modal has exactly one primary immersive button");
});

// Item 5: both controls present their state via the COMBINED isFullscreen
// (so a Maximize-fallback still reads "Exit"/pressed, not a stale "Enter").
test("both immersive controls key icon/aria-pressed on combined isFullscreen", () => {
  const src = read("src", "routes", "atlas.tsx");
  // Modal: aria-pressed + icon derive from isFullscreen; label via helper.
  assert.ok(src.includes("aria-pressed={isFullscreen}"), "modal aria-pressed = isFullscreen");
  assert.ok(
    src.includes("aria-label={modalFsLabel.aria}") && src.includes("title={modalFsLabel.title}"),
    "modal title/aria via the combined-state label helper",
  );
  // Shell: aria-pressed + icon derive from the shell's combined flag.
  assert.ok(src.includes("aria-pressed={shellFullscreen}"), "shell aria-pressed = combined state");
  assert.ok(src.includes("aria-label={shellFsLabel.aria}"), "shell aria via the label helper");
  // The interaction auto-switch + required toast remain.
  assert.ok(src.includes(`data.type !== "f3d:interaction-active"`), "interaction listener kept");
  assert.ok(
    src.includes("Switched to Maximize for reliable drawing on iPad."),
    "auto-switch toast kept",
  );
});

test("pseudo-fullscreen CSS is strengthened WITHOUT any touch-action", () => {
  const css = read("src", "styles.css");
  const rule = css.match(/\.atlas-shell--pseudo-fs \{[^}]*\}/);
  assert.ok(rule, "pseudo-fullscreen rule present");
  for (const needle of [
    "position:fixed",
    "inset:0",
    "z-index:9999",
    "width:100vw",
    "height:100dvh",
    "overflow:hidden",
    "env(safe-area-inset-top,0px)",
  ]) {
    assert.ok(rule[0].includes(needle), `pseudo-fs rule missing: ${needle}`);
  }
  assert.ok(!rule[0].includes("touch-action"), "NO touch-action on the pseudo-fs container");
  const lock = css.match(/body\.atlas-pseudo-fs-lock \{[^}]*\}/);
  assert.ok(lock, "body scroll-lock rule present");
  assert.ok(lock[0].includes("overflow:hidden"));
  assert.ok(lock[0].includes("overscroll-behavior:none"));
  assert.ok(!lock[0].includes("touch-action"), "NO touch-action on the body lock");
});

test("modal pseudo-fullscreen keeps safe-area padding despite the later backdrop rules (P2)", () => {
  const css = read("src", "styles.css");
  // The modal element carries BOTH classes; .atlas-modal-backdrop is
  // declared later at equal specificity and sets its own padding (plus a
  // mobile media variant). The compound selector must exist to win on
  // specificity in every cascade position.
  const modalRule = css.match(/\.atlas-modal-backdrop\.atlas-shell--pseudo-fs \{[^}]*\}/);
  assert.ok(modalRule, "compound .atlas-modal-backdrop.atlas-shell--pseudo-fs rule present");
  for (const side of ["top", "right", "bottom", "left"]) {
    assert.ok(
      modalRule[0].includes(`env(safe-area-inset-${side},0px)`),
      `compound rule missing safe-area inset: ${side}`,
    );
  }
  assert.ok(!modalRule[0].includes("touch-action"), "NO touch-action on the compound rule");
  // Document the cascade hazard the compound rule defends against: the
  // plain backdrop rule really is declared AFTER the pseudo-fs rule.
  assert.ok(
    css.indexOf(".atlas-modal-backdrop {") > css.indexOf(".atlas-shell--pseudo-fs {"),
    "backdrop rule follows pseudo-fs rule (the override this test guards)",
  );
});

test("pseudo fullscreen VISIBLY maximizes the modal (the iPad toggle-misfire fix)", () => {
  const css = read("src", "styles.css");
  // The backdrop is already a fixed inset-0 overlay, so without these
  // rules the toggle flips state while nothing changes on screen: the
  // inner .atlas-modal keeps its cinematic width/16:9 caps. Pseudo mode
  // must lift them.
  const modal = css.match(
    /\.atlas-modal-backdrop\.atlas-shell--pseudo-fs \.atlas-modal \{[^}]*\}/,
  );
  assert.ok(modal, "maximize rule for the inner .atlas-modal present");
  for (const needle of ["width:100%", "max-height:none", "border-radius:0"]) {
    assert.ok(modal[0].includes(needle), `maximize rule missing: ${needle}`);
  }
  const controls = css.match(
    /\.atlas-modal-backdrop\.atlas-shell--pseudo-fs \.atlas-modal-controls \{[^}]*\}/,
  );
  assert.ok(controls, "controls row widens with the maximized modal");
  assert.ok(controls[0].includes("width:100%"));
  // The plain .atlas-modal rule must still carry the cinematic cap this
  // fix lifts — if that cap moves/disappears, re-evaluate these rules.
  // (Anchored to line start so the maximize rule above cannot match.)
  const plainModal = css.match(/\n {2}\.atlas-modal \{[^}]*\}/);
  assert.ok(plainModal && plainModal[0].includes("max-height:min(88vh"), "cinematic cap still present in the base rule");
});
