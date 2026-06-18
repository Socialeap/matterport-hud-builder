// Unit tests for the Atlas curated-showcase deploy → attach decision helper.
// These cover the transition rules the auto-poll relies on, in isolation from
// the DB / GitHub / Netlify.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planShowcaseDeploymentOutcome } from "../src/lib/atlas-showcase-deploy-plan.mjs";

const URL = "https://frontiers3d-atlas-showcases.netlify.app/opera-gallery/";
const NOW = "2026-06-18T00:00:00.000Z";

test("verified deploy → published + attaches the URL", () => {
  const out = planShowcaseDeploymentOutcome({ ok: true }, URL, NOW);
  assert.equal(out.status, "published");
  assert.equal(out.attachUrl, URL, "presentation_url to attach is the verified URL");
  assert.equal(out.jobUpdate.publish_status, "published");
  assert.equal(out.jobUpdate.deployed_url, URL);
  assert.equal(out.jobUpdate.published_at, NOW);
  assert.equal(out.jobUpdate.publish_error, null);
  assert.equal(out.reason, null);
});

test("unverified deploy → pending_deploy, retryable, NEVER failed, no attach", () => {
  const out = planShowcaseDeploymentOutcome(
    { ok: false, reason: "Deployed URL returned HTTP 404 (expected 200)." },
    URL,
    NOW,
  );
  assert.equal(out.status, "pending_deploy");
  assert.notEqual(out.jobUpdate.publish_status, "failed", "a slow deploy must stay retryable, not failed");
  assert.equal(out.jobUpdate.publish_status, "pending_deploy");
  assert.equal(out.attachUrl, null, "must NOT attach an unverified URL (no false success)");
  assert.equal(out.jobUpdate.deployed_url, URL, "remembers the target URL for retry");
  assert.ok(out.reason && out.reason.includes("404"), "surfaces the verification reason");
  assert.ok(/retry/i.test(out.jobUpdate.publish_error), "publish_error tells the admin it will retry");
  assert.ok(!("published_at" in out.jobUpdate), "pending state does not stamp published_at");
});

test("unverified with no reason → a clear default reason", () => {
  const out = planShowcaseDeploymentOutcome({ ok: false }, URL, NOW);
  assert.equal(out.status, "pending_deploy");
  assert.ok(out.reason && out.reason.length > 0);
  assert.equal(out.attachUrl, null);
});

test("success can never be claimed without ok=true", () => {
  for (const v of [{ ok: false }, {}, { ok: "yes" }, { ok: 1 }, { ok: null }]) {
    const out = planShowcaseDeploymentOutcome(v, URL, NOW);
    assert.equal(out.status, "pending_deploy", `ok=${JSON.stringify(v.ok)} must not publish`);
    assert.equal(out.attachUrl, null);
  }
});
