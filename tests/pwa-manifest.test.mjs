#!/usr/bin/env node

// PR-PWA-1: manifest validity, icon-file existence, and root metadata.
// Static checks (no browser) — parse the manifest, confirm every icon it
// references really exists on disk at the right pixel size, and assert the
// root document wires manifest + apple meta without disturbing the
// existing SEO/OG/JSON-LD/verification metadata.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const read = (...p) => readFileSync(path.join(root, ...p), "utf8");
const abs = (...p) => path.join(root, ...p);

const manifest = JSON.parse(read("public", "manifest.webmanifest"));

// PNG IHDR width/height (bytes 16–23) — verifies real dimensions, not just
// that a file exists.
function pngSize(file) {
  const buf = readFileSync(file);
  assert.equal(buf.toString("ascii", 1, 4), "PNG", `${file} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ── 1. Required manifest fields + the brief's exact values ───────────────
test("manifest declares the standalone installable identity", () => {
  assert.equal(manifest.id, "/");
  assert.equal(manifest.name, "Frontiers3D");
  assert.equal(manifest.short_name, "Frontiers3D");
  assert.equal(manifest.start_url, "/atlas?source=pwa");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.match(manifest.theme_color, /^#[0-9a-fA-F]{6}$/);
  assert.match(manifest.background_color, /^#[0-9a-fA-F]{6}$/);
});

test("display is standalone and NEVER fullscreen (display_override too)", () => {
  assert.notEqual(manifest.display, "fullscreen");
  assert.ok(Array.isArray(manifest.display_override), "display_override present");
  assert.ok(!manifest.display_override.includes("fullscreen"), "no fullscreen fallback");
  assert.equal(manifest.display_override[0], "standalone");
});

test("manifest does not force an orientation and sets useful categories", () => {
  assert.equal(manifest.orientation, undefined, "orientation must not be forced");
  for (const cat of ["travel", "business", "productivity", "lifestyle"]) {
    assert.ok(manifest.categories.includes(cat), `missing category: ${cat}`);
  }
});

// ── 2. Every referenced icon exists at the declared size ─────────────────
test("manifest icons: any 192 + any 512 + maskable 512, all present on disk", () => {
  const bySize = {};
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith("/"), "icon src must be root-absolute");
    const file = abs("public", icon.src.replace(/^\//, ""));
    assert.ok(existsSync(file), `icon file missing: ${icon.src}`);
    const [w, h] = icon.sizes.split("x").map(Number);
    const real = pngSize(file);
    assert.equal(real.width, w, `${icon.src} width`);
    assert.equal(real.height, h, `${icon.src} height`);
    bySize[icon.sizes + ":" + (icon.purpose || "any")] = true;
  }
  assert.ok(bySize["192x192:any"], "need a 192 any icon");
  assert.ok(bySize["512x512:any"], "need a 512 any icon");
  assert.ok(bySize["512x512:maskable"], "need a 512 maskable icon");
});

test("apple touch icon exists at 180×180 (not a stretched favicon)", () => {
  const file = abs("public", "icons", "apple-touch-icon-180.png");
  assert.ok(existsSync(file), "apple-touch-icon-180.png missing");
  const real = pngSize(file);
  assert.equal(real.width, 180);
  assert.equal(real.height, 180);
});

// ── 3. Root metadata wired; existing SEO/OG/JSON-LD untouched ────────────
test("root head wires manifest, theme-color, apple meta, and PWA icon links", () => {
  const src = read("src", "routes", "__root.tsx");
  assert.ok(src.includes(`rel: "manifest", href: "/manifest.webmanifest"`), "manifest link");
  assert.ok(src.includes(`name: "theme-color", content: "#020617"`), "theme-color");
  assert.ok(src.includes(`name: "apple-mobile-web-app-capable", content: "yes"`), "apple capable");
  assert.ok(src.includes(`name: "apple-mobile-web-app-title", content: "Frontiers3D"`), "apple title");
  assert.ok(src.includes(`name: "apple-mobile-web-app-status-bar-style"`), "status bar style");
  assert.ok(src.includes(`href: "/icons/apple-touch-icon-180.png"`), "apple touch icon link");
  assert.ok(src.includes(`href: "/icons/icon-512.png"`), "512 icon link");
});

test("existing SEO / OG / JSON-LD / verification metadata is preserved", () => {
  const src = read("src", "routes", "__root.tsx");
  assert.ok(src.includes("google-site-verification"), "verification meta kept");
  assert.ok(src.includes(`property: "og:site_name"`), "OG kept");
  assert.ok(src.includes("application/ld+json"), "JSON-LD kept");
  assert.ok(src.includes("twitter:card"), "twitter card kept");
});

test("PWA static assets are served from public/ (same-origin root)", () => {
  for (const f of [
    ["public", "manifest.webmanifest"],
    ["public", "sw.js"],
    ["public", "sw-cache-policy.js"],
    ["public", "offline.html"],
  ]) {
    assert.ok(existsSync(abs(...f)), `missing ${f.join("/")}`);
  }
});
