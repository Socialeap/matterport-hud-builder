#!/usr/bin/env node

// Tests for the fullscreen entry policy (src/hooks/use-fullscreen.ts):
// iOS/iPadOS WebKit must NEVER call requestFullscreen (system edge-swipes
// terminate native fullscreen mid-annotation; CSS pseudo-fullscreen is the
// primary path there), desktop keeps native fullscreen, and the
// rejection/missing-API pseudo fallback is preserved. The React-effect
// behaviors (pseudo class toggling, body scroll lock, Escape exit) need a
// DOM renderer the repo deliberately does not carry — they are covered
// here at the text level instead, alongside the no-touch-action guarantee.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  isIosWebKitDevice,
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

// ── 2. Native-entry policy ───────────────────────────────────────────────
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

test("iOS WebKit path NEVER calls requestFullscreen (pseudo is primary)", async () => {
  for (const nav of [IOS_NAV, IPAD_DESKTOP_NAV, IOS_CHROME_NAV]) {
    const { calls, el } = fsElementSpy();
    assert.equal(await requestNativeFullscreen(el, nav), false);
    assert.equal(calls.request, 0, "the native API must not even be attempted on iOS");
  }
});

test("desktop path still uses native fullscreen when available", async () => {
  const { calls, el } = fsElementSpy();
  assert.equal(await requestNativeFullscreen(el, WIN_NAV), true);
  assert.equal(calls.request, 1);
});

test("desktop rejection falls back to pseudo (returns false, attempt made)", async () => {
  const { calls, el } = fsElementSpy({ reject: true });
  assert.equal(await requestNativeFullscreen(el, MAC_NAV), false, "iframe-without-allow case");
  assert.equal(calls.request, 1, "the attempt was made before falling back");
});

test("missing Fullscreen API falls back to pseudo", async () => {
  assert.equal(await requestNativeFullscreen({}, WIN_NAV), false);
});

test("webkit-prefixed request is used when the unprefixed API is absent", async () => {
  let called = 0;
  const el = {
    webkitRequestFullscreen() {
      called += 1;
      return Promise.resolve();
    },
  };
  assert.equal(await requestNativeFullscreen(el, MAC_NAV), true);
  assert.equal(called, 1);
});

// ── 3. Hook wiring + CSS guarantees (text-level; no DOM renderer) ────────
test("the hook routes entry through the policy and wires the pseudo/body classes + Escape", () => {
  const src = read("src", "hooks", "use-fullscreen.ts");
  assert.ok(
    src.includes("if (await requestNativeFullscreen(el)) return;"),
    "toggle() must route native entry through the policy function",
  );
  assert.ok(src.includes("setIsPseudoFs(true)"), "pseudo fallback preserved");
  assert.ok(src.includes(`"atlas-shell--pseudo-fs"`), "pseudo class constant present");
  assert.ok(src.includes(`"atlas-pseudo-fs-lock"`), "body scroll-lock class constant present");
  assert.ok(
    src.includes(`document.body.classList.add(BODY_LOCK_CLASS)`) &&
      src.includes(`document.body.classList.remove(BODY_LOCK_CLASS)`),
    "body lock is added while active and removed on exit/unmount",
  );
  assert.ok(
    src.includes(`e.key === "Escape"`),
    "Escape exits pseudo fullscreen",
  );
  // The DOM style property a hook would actually assign is `touchAction`
  // (the hyphenated form appears only in prose comments).
  assert.ok(!src.includes("touchAction"), "the hook must not introduce touch-action styling");
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
  assert.ok(
    modalRule[0].includes("calc(0.625rem + env("),
    "safe-area combines with the backdrop's normal inner gap",
  );
  assert.ok(!modalRule[0].includes("touch-action"), "NO touch-action on the compound rule");
  // Document the cascade hazard the compound rule defends against: the
  // plain backdrop rule really is declared AFTER the pseudo-fs rule.
  assert.ok(
    css.indexOf(".atlas-modal-backdrop {") > css.indexOf(".atlas-shell--pseudo-fs {"),
    "backdrop rule follows pseudo-fs rule (the override this test guards)",
  );
});
