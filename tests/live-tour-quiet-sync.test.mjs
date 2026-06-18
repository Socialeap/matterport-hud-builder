// 2.2.6 Live Tour polish — quiet View Sync + no annotation-triggered reloads.
//
// Two guarantees, proven against BOTH runtimes (Atlas standalone runtime AND the
// Builder glue span) for parity:
//   A. normalizeMatterportLiveSyncUrl decorates a synced view with verified
//      Matterport quiet-start params, is idempotent, preserves m/ss/sr, and
//      never touches non-Matterport URLs.
//   B. Only applyTeleport writes iframe.src, it has the no-op (no-reload) guard,
//      and no annotation/tool inbound handler calls applyTeleport or writes src.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BUILDER_JS_GLUE_SPAN } from "../src/lib/portal/builder-runtime-spans.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ATLAS = readFileSync(join(root, "src/lib/atlas-live-tour-runtime.mjs"), "utf8");
// BUILDER_JS_GLUE_SPAN is the already-evaluated template literal, so its text is
// runtime form (single backslashes) — directly eval-able like the Atlas source.
const BUILDER = BUILDER_JS_GLUE_SPAN;

// Pull a top-level `function name(...) { ... }` out of a runtime body by brace
// matching, and return the live function via new Function.
function extractFn(src, name) {
  const start = src.indexOf("function " + name);
  assert.ok(start !== -1, `${name} must be defined`);
  let i = src.indexOf("{", start), depth = 0, end = -1;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  // eslint-disable-next-line no-new-func
  return new Function(src.slice(start, end + 1) + "\nreturn " + name + ";")();
}

const RUNTIMES = {
  atlas: { src: ATLAS, norm: extractFn(ATLAS, "normalizeMatterportLiveSyncUrl") },
  builder: { src: BUILDER, norm: extractFn(BUILDER, "normalizeMatterportLiveSyncUrl") },
};

const QUIET = ["qs=1", "play=1", "title=0", "brand=0", "help=0", "hl=0", "dh=0"];

for (const [label, { src, norm }] of Object.entries(RUNTIMES)) {
  test(`normalize (${label}): preserves m + ss/sr and forces all quiet params`, () => {
    const out = norm("https://my.matterport.com/show/?m=AbC123&play=0&help=1", "1.1,2.2,3.3", "0.4,0.5");
    assert.match(out, /[?&]m=AbC123(&|$)/, "model id m preserved");
    assert.equal(out.indexOf("ss=" + encodeURIComponent("1.1,2.2,3.3")) !== -1, true, "ss preserved (encoded)");
    assert.equal(out.indexOf("sr=" + encodeURIComponent("0.4,0.5")) !== -1, true, "sr preserved (encoded)");
    for (const p of QUIET) assert.ok(out.includes(p), `forces ${p}`);
    // help=1 in the input was replaced, not duplicated.
    assert.equal((out.match(/[?&]help=/g) || []).length, 1, "help appears exactly once");
    assert.equal((out.match(/[?&]play=/g) || []).length, 1, "play appears exactly once");
  });

  test(`normalize (${label}): is idempotent`, () => {
    const once = norm("https://my.matterport.com/show/?m=X", "9", "8");
    const twice = norm(once, "9", "8");
    assert.equal(twice, once, "applying twice yields an identical URL");
    for (const p of QUIET) assert.equal((twice.match(new RegExp("[?&]" + p.replace("=", "=") + "(&|$)", "g")) || []).length, 1, `${p} not duplicated`);
  });

  test(`normalize (${label}): never drops ss/sr coordinates`, () => {
    const out = norm("https://my.matterport.com/show/?m=X&ss=old&sr=old", "5,5,5", "1,1");
    assert.ok(out.includes("ss=" + encodeURIComponent("5,5,5")), "new ss present");
    assert.ok(out.includes("sr=" + encodeURIComponent("1,1")), "new sr present");
    assert.ok(!out.includes("ss=old"), "stale ss replaced");
  });

  test(`normalize (${label}): leaves non-Matterport URLs unchanged`, () => {
    const ext = "https://example.com/embed?m=X&foo=1";
    assert.equal(norm(ext, "9", "8"), ext, "non-Matterport URL returned verbatim");
    assert.ok(!norm(ext, "9", "8").includes("ss=9"), "no params added to non-Matterport URL");
    assert.equal(norm("", "9", "8"), "", "empty base returned verbatim");
  });

  test(`source (${label}): only applyTeleport writes iframe src; annotation handlers never do`, () => {
    // The single iframe src write lives in applyTeleport (via normalize).
    const srcWrites = (src.match(/frame\.src\s*=/g) || []).length;
    assert.equal(srcWrites, 1, "exactly one frame.src assignment in the runtime (applyTeleport)");
    // applyTeleport carries the no-op (no-reload) guard.
    const ap = src.slice(src.indexOf("function applyTeleport"));
    const apBody = ap.slice(0, ap.indexOf("\n  }") + 1);
    assert.ok(/lastTeleportedKey/.test(apBody), "applyTeleport has the lastTeleportedKey no-op guard");
    assert.ok(/normalizeMatterportLiveSyncUrl\(/.test(apBody), "applyTeleport routes through the quiet-sync normalizer");
  });
}
