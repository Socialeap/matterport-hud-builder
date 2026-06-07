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
  defaultFullscreenIntent,
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

// ── 2. Default-mode policy (the iOS-safe contract) ───────────────────────
test("defaultFullscreenIntent: iOS => Maximize, desktop => Device", () => {
  assert.equal(defaultFullscreenIntent(IOS_NAV), "maximize");
  assert.equal(defaultFullscreenIntent(IPAD_DESKTOP_NAV), "maximize", "iPad desktop mode");
  assert.equal(defaultFullscreenIntent(IOS_CHROME_NAV), "maximize", "iOS Chrome");
  assert.equal(defaultFullscreenIntent(MAC_NAV), "device");
  assert.equal(defaultFullscreenIntent(WIN_NAV), "device");
});

// ── 2b. requestNativeFullscreen — pure attempt, no platform refusal ──────
// (The explicit secondary Device-fullscreen action uses this on iPad too,
// so it MUST attempt regardless of platform; the iOS default-mode guard
// lives in defaultFullscreenIntent above.)
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
test("the hook wires the two modes, the interaction auto-switch, classes + Escape", () => {
  const src = read("src", "hooks", "use-fullscreen.ts");
  // toggle() routes the primary control through the per-platform intent.
  assert.ok(
    src.includes(`defaultFullscreenIntent() === "device"`),
    "toggle() must branch on the default intent",
  );
  assert.ok(src.includes("requestNativeFullscreen(el)"), "native attempt wired");
  assert.ok(src.includes("setIsMaximized(true)"), "maximize fallback/primary present");
  // Req 3 auto-switch: device fullscreen → Maximize on interaction.
  assert.ok(
    src.includes("ensureSafeForInteraction"),
    "interaction auto-switch exported",
  );
  assert.ok(
    src.includes("void exitNativeFullscreen()") && src.includes("setIsMaximized(true)"),
    "auto-switch exits native then maximizes",
  );
  assert.ok(src.includes(`"atlas-shell--pseudo-fs"`), "pseudo class constant present");
  assert.ok(src.includes(`"atlas-pseudo-fs-lock"`), "body scroll-lock class constant present");
  assert.ok(
    src.includes(`document.body.classList.add(BODY_LOCK_CLASS)`) &&
      src.includes(`document.body.classList.remove(BODY_LOCK_CLASS)`),
    "body lock is added while active and removed on exit/unmount",
  );
  assert.ok(src.includes(`e.key === "Escape"`), "Escape exits Maximize");
  // The DOM style property a hook would actually assign is `touchAction`
  // (the hyphenated form appears only in prose comments).
  assert.ok(!src.includes("touchAction"), "the hook must not introduce touch-action styling");
});

test("the modal renders Maximize primary + de-emphasized Device-fullscreen secondary on iOS", () => {
  const src = read("src", "routes", "atlas.tsx");
  assert.ok(src.includes("isIos ?"), "modal branches on iOS for the control set");
  assert.ok(src.includes("atlas-modal-ctrl--device"), "secondary device control rendered");
  assert.ok(
    src.includes("supportsDeviceFullscreen && !isMaximized"),
    "device control hidden on iPhone/standalone and while maximized",
  );
  assert.ok(src.includes("onClick={isMaximized ? exitFullscreen : maximize}"), "primary = Maximize");
  assert.ok(
    src.includes(`data.type !== "f3d:interaction-active"`),
    "modal listens for the interaction signal (req 3 parent half)",
  );
  assert.ok(
    src.includes("Switched to Maximize for reliable drawing on iPad."),
    "auto-switch surfaces the required copy",
  );
  const css = read("src", "styles.css");
  assert.ok(
    /\.atlas-modal-ctrl--device \{[^}]*color:#94a3b8/.test(css),
    "device control is visually de-emphasized vs the primary",
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
