#!/usr/bin/env node

// P5 — operation-state controller: behavioral race/staleness proofs using
// controlled (deferred) promises. These exercise the EXACT async windows the
// admin route runs through — the route wires its real read (file.text) and
// upgrade (runUpgradeSession) through createUpgradeController, so guarding the
// controller guards the route. Not static-source assertions: the deferred
// promises drive each interleaving directly.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createUpgradeController } from "../src/lib/presentation-upgrade-controller.mjs";
import { runUpgradeSession } from "../src/lib/presentation-upgrade-session.mjs";
import {
  checkPresentationHtmlSize,
  MAX_PRESENTATION_HTML_BYTES,
} from "../src/lib/limits.ts";
import { stripExports } from "../src/lib/portal/ask-runtime-transformer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoPath = (...p) => path.join(__dirname, "..", ...p);
const read = (...p) => readFileSync(repoPath(...p), "utf8");

const RUNTIME_SOURCES = {
  liveSessionJs: stripExports(read("src", "lib", "portal", "live-session.mjs")),
  annoInputJs: stripExports(read("src", "lib", "portal", "anno-input.mjs")),
};
const FIX_210 = read("tests", "fixtures", "builder-2.1.0.sanitized.html");
const FIX_LEGACY = read("tests", "fixtures", "legacy-builder-may2026.sanitized.html");

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Let queued promise continuations flush.
const tick = () => new Promise((r) => setTimeout(r, 0));

// A fabricated "downloadable" upgrade result for stale-upgrade scenarios.
const PATCHED_RESULT = {
  outcome: "patched",
  report: { download: { available: true } },
  download: { filename: "f.upgraded.html", html: "<patched/>", mimeType: "text/html" },
  downloadable: true,
  error: null,
};

// Harness: a recording sink + deferred readFile, and a pluggable runUpgrade.
function harness({ runUpgrade } = {}) {
  const state = {};
  const toasts = [];
  const reads = []; // one deferred per readFile call, in order
  const sink = {
    setState: (p) => Object.assign(state, p),
    toastSuccess: (m) => toasts.push({ type: "success", m }),
    toastError: (m) => toasts.push({ type: "error", m }),
  };
  const controller = createUpgradeController({
    checkSize: checkPresentationHtmlSize,
    readFile: () => {
      const d = deferred();
      reads.push(d);
      return d.promise;
    },
    runUpgrade: runUpgrade ?? (async () => PATCHED_RESULT),
    sink,
  });
  return { state, toasts, reads, controller };
}

const fileOf = (name, size = 100) => ({ name, type: "text/html", size });

// 1. Stale read: File A finishes after File B was selected.
test("I1 — a read finishing after a newer selection cannot overwrite it", async () => {
  const { state, reads, controller } = harness();
  controller.select(fileOf("a.html")); // reads[0]
  controller.select(fileOf("b.html")); // reads[1]; session bumped
  assert.equal(state.fileName, "b.html");

  reads[0].resolve("<garbage>STALE A</garbage>"); // stale
  await tick();
  assert.equal(state.inspection, null, "stale read must not set inspection");
  assert.equal(state.html, null, "stale read must not set html");

  reads[1].resolve(FIX_210); // current
  await tick();
  assert.equal(state.html, FIX_210);
  assert.equal(state.inspection.outcome, "patchable");
  assert.equal(state.fileName, "b.html");
});

// 2. Clear occurs while a file is being read.
test("I2 — Clear during a read discards the read result", async () => {
  const { state, reads, controller } = harness();
  controller.select(fileOf("a.html")); // reads[0]
  controller.clear(); // session bumped, state blanked
  reads[0].resolve(FIX_210); // stale
  await tick();
  assert.equal(state.inspection, null);
  assert.equal(state.html, null);
  assert.equal(state.reading, false);
  assert.equal(state.fileName, null);
});

// 3. A stale finally cannot clear a newer operation's loading flag.
test("I3 — a stale finally cannot clear a newer read's loading flag", async () => {
  const { state, reads, controller } = harness();
  controller.select(fileOf("a.html")); // reads[0]
  controller.select(fileOf("b.html")); // reads[1]
  assert.equal(state.reading, true);

  reads[0].resolve(FIX_210); // stale A
  await tick();
  assert.equal(state.reading, true, "newer read still in progress");

  reads[1].resolve(FIX_210); // current B
  await tick();
  assert.equal(state.reading, false);
});

// 4. A new file occurs while an upgrade is running.
test("I4 — a new selection during an upgrade discards the upgrade result", async () => {
  const up = deferred();
  const { state, toasts, reads, controller } = harness({ runUpgrade: () => up.promise });
  controller.select(fileOf("a.html"));
  reads[0].resolve(FIX_210);
  await tick();
  assert.equal(state.inspection.outcome, "patchable");

  controller.upgrade({ html: FIX_210, filename: "a.html", getRuntimeSources: () => RUNTIME_SOURCES });
  assert.equal(state.upgrading, true);

  controller.select(fileOf("b.html")); // session bumped
  up.resolve(PATCHED_RESULT); // stale upgrade
  await tick();
  assert.equal(state.report, null, "stale upgrade must not expose a report");
  assert.equal(state.download, null, "stale upgrade must not expose a download");
  assert.ok(!toasts.some((t) => t.type === "success"), "no stale success toast");
});

// 5. Clear occurs while an upgrade is running.
test("I5 — Clear during an upgrade discards the upgrade result", async () => {
  const up = deferred();
  const { state, toasts, reads, controller } = harness({ runUpgrade: () => up.promise });
  controller.select(fileOf("a.html"));
  reads[0].resolve(FIX_210);
  await tick();

  controller.upgrade({ html: FIX_210, filename: "a.html", getRuntimeSources: () => RUNTIME_SOURCES });
  assert.equal(state.upgrading, true);

  controller.clear(); // session bumped
  up.resolve(PATCHED_RESULT); // stale
  await tick();
  assert.equal(state.report, null);
  assert.equal(state.download, null);
  assert.equal(state.upgrading, false);
  assert.ok(!toasts.some((t) => t.type === "success"));
});

// 6. A stale FAILED upgrade cannot surface an error or toast.
test("I6 — a stale failed upgrade cannot surface an error or toast", async () => {
  const up = deferred();
  const { state, toasts, reads, controller } = harness({ runUpgrade: () => up.promise });
  controller.select(fileOf("a.html"));
  reads[0].resolve(FIX_210);
  await tick();

  controller.upgrade({ html: FIX_210, filename: "a.html", getRuntimeSources: () => RUNTIME_SOURCES });
  controller.clear(); // session bumped
  up.reject(new Error("boom")); // stale failure
  await tick();
  assert.equal(state.error, null, "stale failure must not set an error");
  assert.ok(!toasts.some((t) => t.type === "error"), "no stale error toast");
});

// 7. Size guard runs BEFORE the read (oversize never reaches readFile).
test("I7 — an oversize file is rejected and never read", async () => {
  const { state, reads, controller } = harness();
  controller.select({ name: "huge.html", type: "text/html", size: MAX_PRESENTATION_HTML_BYTES + 1 });
  await tick();
  assert.equal(reads.length, 0, "readFile must not be called for an oversize file");
  assert.match(state.error, /too large/i);
  assert.equal(state.reading, false);
});

// 8. Happy path: the REAL engine flows a downloadable result through the controller.
test("I8 — happy path: real engine produces a downloadable result via the controller", async () => {
  const { state, toasts, reads, controller } = harness({ runUpgrade: (args) => runUpgradeSession(args) });
  controller.select({ name: "index.html", type: "text/html", size: FIX_210.length });
  reads[0].resolve(FIX_210);
  await tick();
  assert.equal(state.inspection.outcome, "patchable");

  await controller.upgrade({ html: FIX_210, filename: "index.html", getRuntimeSources: () => RUNTIME_SOURCES });
  assert.equal(state.report.outcome, "patched");
  assert.ok(state.download, "a download payload is present");
  assert.equal(state.upgrading, false);
  assert.ok(toasts.some((t) => t.type === "success"));
});

// 9. A failed runtime-source provider during upgrade is a controlled error (current session).
test("I9 — a throwing runtime-source provider yields a guarded error, no download", async () => {
  const { state, toasts, reads, controller } = harness({ runUpgrade: (args) => runUpgradeSession(args) });
  controller.select({ name: "index.html", type: "text/html", size: FIX_210.length });
  reads[0].resolve(FIX_210);
  await tick();

  await controller.upgrade({
    html: FIX_210,
    filename: "index.html",
    getRuntimeSources: () => {
      throw new Error("bundle sources unavailable");
    },
  });
  assert.equal(state.download, null);
  assert.ok(state.error && state.error.length > 0);
  assert.equal(state.upgrading, false);
  assert.ok(toasts.some((t) => t.type === "error"));
});

// 10. A recognized legacy file: select stores both the inspection and the
//     matched legacy profile so the route can offer the bootstrap.
test("I10 — select stores the matched legacy profile (recognized legacy file)", async () => {
  const { state, reads, controller } = harness();
  controller.select({ name: "index.html", type: "text/html", size: FIX_LEGACY.length });
  reads[0].resolve(FIX_LEGACY);
  await tick();
  assert.equal(state.inspection.outcome, "legacy_unsupported");
  assert.ok(state.legacyProfile && state.legacyProfile.supported === true, "legacy profile stored + supported");
  assert.equal(state.legacyProfile.profileId, "builder-may2026-f8f68f0");
});
