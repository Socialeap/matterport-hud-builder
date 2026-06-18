// Source-level guards for the Atlas "auto-attach deployed showcase URL" flow.
// These pin the safety invariants of the server wiring without standing up a
// Supabase mock: verify-before-attach, non-destructive auto-poll, no false
// success, deterministic URL, and (critically) no GitHub/Netlify secret ever
// reaching client code.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

const fns = read("src/lib/atlas-curation.functions.ts");
const publishLib = read("src/lib/atlas-showcase-publish.ts");

// Slice out the pollShowcaseDeployment function body for targeted assertions.
function sliceFn(src, marker) {
  const start = src.indexOf(marker);
  assert.ok(start !== -1, `${marker} must exist`);
  const next = src.indexOf("export const ", start + marker.length);
  return src.slice(start, next === -1 ? src.length : next);
}

test("pollShowcaseDeployment exists, is admin-gated, and verifies before attaching", () => {
  const body = sliceFn(fns, "export const pollShowcaseDeployment");
  assert.match(body, /requireAdmin\(/, "must require admin");
  assert.match(body, /verifyDeployedShowcase\(/, "must hard-verify the deployed URL");
  assert.match(body, /planShowcaseDeploymentOutcome\(/, "must use the shared decision helper");
  assert.match(body, /atlas_entries[\s\S]*presentation_url/, "attaches presentation_url to the listing");
});

test("auto-poll is non-destructive: never marks the job failed", () => {
  const body = sliceFn(fns, "export const pollShowcaseDeployment");
  assert.ok(
    !/publish_status:\s*["']failed["']/.test(body),
    "a slow/unverified deploy must stay retryable (pending_deploy), never failed",
  );
});

test("attach only happens inside the published branch (no false success)", () => {
  const body = sliceFn(fns, "export const pollShowcaseDeployment");
  // The presentation_url attach must be guarded by outcome.status === "published".
  assert.match(
    body,
    /outcome\.status === "published"[\s\S]*presentation_url/,
    "presentation_url is attached only when the outcome is published",
  );
});

test("mergeAndPublishShowcase still gates 'published' behind verification.ok", () => {
  const body = sliceFn(fns, "export const mergeAndPublishShowcase");
  assert.match(body, /verification\.ok/, "publish path is gated on verification");
});

test("deployed URL is deterministic from base + slug", () => {
  assert.match(
    publishLib,
    /SHOWCASES_NETLIFY_BASE\s*=\s*["']https:\/\/[^"']+["']/,
    "a fixed canonical Netlify base is defined",
  );
  assert.match(
    publishLib,
    /return\s*`\$\{SHOWCASES_NETLIFY_BASE\}\/\$\{[A-Za-z]+\}\/`/,
    "defaultShowcaseUrl builds `<base>/<slug>/` deterministically",
  );
});

test("GitHub/Netlify secrets never appear in client code", () => {
  const SECRETS = [
    "ATLAS_SHOWCASES_GITHUB_TOKEN",
    "NETLIFY_ATLAS_DEPLOY_TOKEN",
    "NETLIFY_ATLAS_SITE_ID",
  ];
  // Walk src/ and collect every source file that references a secret name.
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(join(root, dir))) {
      const rel = join(dir, name);
      const st = statSync(join(root, rel));
      if (st.isDirectory()) { walk(rel); continue; }
      if (!/\.(ts|tsx|mjs|js|jsx)$/.test(name)) continue;
      const text = readFileSync(join(root, rel), "utf8");
      if (SECRETS.some((s) => text.includes(s))) offenders.push(rel);
    }
  };
  walk("src");
  // The ONLY source file allowed to name these server-only secrets is the
  // dynamically-imported publishing lib (never bundled to the client).
  assert.deepEqual(
    offenders.sort(),
    ["src/lib/atlas-showcase-publish.ts"],
    `secrets must be confined to the server publishing lib; found in: ${offenders.join(", ")}`,
  );
  // …and only via process.env there (not hard-coded).
  for (const s of SECRETS) {
    assert.ok(
      new RegExp(`env\\("${s}"\\)|process\\.env\\[?["']?${s}`).test(publishLib),
      `${s} must be read from the environment, not hard-coded`,
    );
  }
});
