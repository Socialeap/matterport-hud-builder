#!/usr/bin/env node

// Source-level guard for the Atlas "Explore Together" voice + Sync Your View
// permissions chain. The flow only works if the right Permissions-Policy
// features are delegated down two iframe hops:
//
//   Atlas page → modal iframe (curated showcase) → Matterport iframe
//
//   1. The modal iframe (src/routes/atlas.tsx) must grant the embedded
//      showcase microphone (getUserMedia voice) + clipboard-read/write
//      (Matterport "Copy to clipboard" → parent sync) + web-share.
//   2. The nested Matterport iframe (src/lib/atlas-curation-server.ts) must
//      grant clipboard-write + web-share so its in-tour Share works.
//
// web-share is a Permissions-Policy feature whose default allowlist is 'self',
// so EVERY cross-origin ancestor must forward it explicitly for Matterport's
// "Share → Current Location" to reach the iOS Share Sheet from inside the
// nested frames. It grants only navigator.share()/canShare() — no clipboard or
// other access — so adding it cannot weaken the iOS ambient-clipboard isolation.
// The Builder family (src/lib/portal.functions.ts) and the canary device-test
// artifact (scripts/build-builder-canary.mjs) carry the same delegation.
//
// Asserted at source level because the iframes are produced inside React /
// template-literal code that the Vite "?raw" + "@/" alias pipeline makes
// awkward to import directly under node --test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const ATLAS_ROUTE = readFileSync(path.join(root, "src", "routes", "atlas.tsx"), "utf8");
const CURATION_SERVER = readFileSync(
  path.join(root, "src", "lib", "atlas-curation-server.ts"),
  "utf8",
);
const PORTAL = readFileSync(path.join(root, "src", "lib", "portal.functions.ts"), "utf8");
const CANARY = readFileSync(path.join(root, "scripts", "build-builder-canary.mjs"), "utf8");

// Pull every allow="..." value out of a source file.
function allowValues(src) {
  const re = /allow="([^"]*)"/g;
  const out = [];
  let m;
  while ((m = re.exec(src)) !== null) out.push(m[1]);
  return out;
}
function tokens(value) {
  return value
    .split(";")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}
// The allow="..." attribute on a specific <iframe id="..."> tag.
function iframeAllow(src, id) {
  const re = new RegExp('<iframe id="' + id + '"[^>]*?\\sallow="([^"]*)"');
  const m = re.exec(src);
  return m ? m[1] : null;
}
// The sandbox="..." on the Atlas modal iframe — anchored on its (unique)
// microphone+clipboard allow so it stays robust to nearby comment/attr edits.
function modalSandbox(src) {
  const i = src.indexOf("microphone; clipboard-read");
  if (i === -1) return null;
  const m = /sandbox="([^"]*)"/.exec(src.slice(i, i + 800));
  return m ? m[1] : null;
}

test("Atlas modal iframe grants microphone + clipboard read/write for voice & sync", () => {
  const values = allowValues(ATLAS_ROUTE);
  assert.ok(values.length >= 1, "expected at least one allow= attribute in atlas.tsx");
  const found = values.find((v) => {
    const t = tokens(v);
    return (
      t.includes("microphone") &&
      t.includes("clipboard-read") &&
      t.includes("clipboard-write")
    );
  });
  assert.ok(
    found,
    `no Atlas iframe allow grants microphone + clipboard-read + clipboard-write; saw: ${JSON.stringify(values)}`,
  );
  const t = tokens(found);
  for (const needed of [
    "microphone",
    "clipboard-read",
    "clipboard-write",
    "autoplay",
    "fullscreen",
    "accelerometer",
    "gyroscope",
    "xr-spatial-tracking",
    "web-share",
  ]) {
    assert.ok(t.includes(needed), `Atlas modal iframe allow missing: ${needed}`);
  }
});

test("curated Matterport iframe grants clipboard-write (Copy to clipboard sync)", () => {
  const values = allowValues(CURATION_SERVER);
  const found = values.find((v) => tokens(v).includes("clipboard-write"));
  assert.ok(
    found,
    `curated Matterport iframe allow must include clipboard-write; saw: ${JSON.stringify(values)}`,
  );
  const t = tokens(found);
  for (const needed of [
    "xr-spatial-tracking",
    "gyroscope",
    "accelerometer",
    "fullscreen",
    "autoplay",
    "clipboard-write",
    "web-share",
  ]) {
    assert.ok(t.includes(needed), `curated Matterport iframe allow missing: ${needed}`);
  }
});

// The Builder Matterport iframes must carry the SAME complete permission set as
// the curated Atlas iframe — motion (gyroscope/accelerometer) + autoplay +
// clipboard-write (Matterport's own in-tour Copy) + web-share (Share → Current
// Location → iOS Share Sheet). Applies to the primary AND the ghost frame.
const BUILDER_MP_ALLOW = [
  "xr-spatial-tracking",
  "gyroscope",
  "accelerometer",
  "fullscreen",
  "autoplay",
  "clipboard-write",
  "web-share",
];

test("Builder Matterport iframe(s) carry the complete permission set incl. web-share", () => {
  for (const id of ["matterport-frame", "matterport-frame-ghost"]) {
    const allow = iframeAllow(PORTAL, id);
    assert.ok(allow, `portal.functions.ts must have an <iframe id="${id}"> with an allow=`);
    const t = tokens(allow);
    for (const needed of BUILDER_MP_ALLOW) {
      assert.ok(t.includes(needed), `Builder ${id} allow missing: ${needed} (saw ${JSON.stringify(allow)})`);
    }
  }
});

test("web-share is delegated at EVERY level so it reaches the nested Matterport frame", () => {
  // L1 page→presentation, L2a Atlas curated, L2b Builder — all must forward it.
  const modal = allowValues(ATLAS_ROUTE).find((v) => tokens(v).includes("microphone"));
  assert.ok(modal && tokens(modal).includes("web-share"), "L1 Atlas modal iframe must forward web-share");
  const curated = allowValues(CURATION_SERVER).find((v) => tokens(v).includes("clipboard-write"));
  assert.ok(curated && tokens(curated).includes("web-share"), "L2 curated Matterport iframe must forward web-share");
  assert.ok(
    tokens(iframeAllow(PORTAL, "matterport-frame")).includes("web-share"),
    "L2 Builder Matterport iframe must forward web-share",
  );
});

test("Builder canary device-test artifact carries the complete permission set (both iframes)", () => {
  // The canary HTML is what gets hosted over HTTPS for the iPad device test, so
  // its hardcoded iframes must match the generated Builder set — otherwise the
  // device test cannot faithfully exercise Share → Current Location → Share Sheet.
  for (const id of ["matterport-frame", "matterport-frame-ghost"]) {
    const allow = iframeAllow(CANARY, id);
    assert.ok(allow, `build-builder-canary.mjs must have an <iframe id="${id}">`);
    const t = tokens(allow);
    for (const needed of BUILDER_MP_ALLOW) {
      assert.ok(t.includes(needed), `canary ${id} allow missing: ${needed} (saw ${JSON.stringify(allow)})`);
    }
  }
});

test("the Atlas modal sandbox is NOT loosened by the web-share change", () => {
  // web-share needs no sandbox token; transient activation comes from the user's
  // tap on Matterport's own Share button. Pin the sandbox so a future edit that
  // silently broadens it (e.g. allow-top-navigation, allow-downloads) fails here.
  const sandbox = modalSandbox(ATLAS_ROUTE);
  assert.ok(sandbox, "atlas.tsx modal iframe must keep its sandbox attribute");
  const got = sandbox.split(/\s+/).filter(Boolean).sort();
  const expected = [
    "allow-scripts",
    "allow-same-origin",
    "allow-popups",
    "allow-forms",
    "allow-presentation",
  ].sort();
  assert.deepEqual(got, expected, `Atlas modal sandbox changed — review before loosening. saw: ${sandbox}`);
});
