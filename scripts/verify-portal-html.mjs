#!/usr/bin/env node
/**
 * Build-time guard for the generated portal HTML.
 *
 * Why this exists:
 *   src/lib/portal.functions.ts builds the entire end-product HTML inside one
 *   giant TS template literal. Any single backslash inside that literal that
 *   should have been doubled silently corrupts the emitted runtime JavaScript.
 *   The generated file looks fine to eyeball but the embedded <script> blocks
 *   throw `SyntaxError` on load, which kills the gate buttons and the iframe.
 *
 *   This script catches the whole bug class by:
 *     1. Importing buildPortalHtmlForModel with a minimal fixture model.
 *     2. Extracting every <script>...</script> block from the output.
 *     3. Parsing each block with `new Function(...)` to surface SyntaxError.
 *     4. Failing the process with a non-zero exit code if anything throws.
 *
 * Run via:   node scripts/verify-portal-html.mjs
 * Or via:    npm run verify:html
 */

import { pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// Minimal fixture — only the fields buildPortalHtmlForModel actually reads.
const fixtureModel = {
  id: "verify-fixture",
  name: "Verify Fixture",
  client_id: "00000000-0000-0000-0000-000000000000",
  provider_id: "00000000-0000-0000-0000-000000000000",
  properties: [
    {
      uuid: "verify-prop-1",
      title: "1 Verify Street",
      iframeUrl: "https://my.matterport.com/show/?m=ABCDEFGHIJK",
      ambientAudioUrl: "",
      addressLines: ["1 Verify Street", "New York, NY"],
      docs: [],
      models: [],
      neighborhoodMap: null,
      tourBehavior: null,
      cinemaConfig: null,
      mediaCarousel: null,
      mediaSync: null,
    },
  ],
  tour_config: { agent: { name: "Test Agent" }, behaviors: {}, branding: {} },
};

async function loadBuilder() {
  // We import the source module directly — no bundling — and rely on the
  // exported pure function. If that function isn't exported, we surface a
  // clear error instead of silently passing.
  const modulePath = path.join(ROOT, "src/lib/portal.functions.ts");
  const moduleUrl = pathToFileURL(modulePath).href;

  // Use tsx-style loader through node --import if available; fall back to
  // a clear instruction message otherwise.
  try {
    const mod = await import(moduleUrl);
    return mod;
  } catch (err) {
    console.error("[verify-html] Could not import portal.functions.ts directly.");
    console.error("[verify-html] Run with: node --import tsx scripts/verify-portal-html.mjs");
    console.error("[verify-html] Underlying error:", err?.message || err);
    process.exit(2);
  }
}

function extractScripts(html) {
  const blocks = [];
  const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    // Skip <script src="..."> with empty body and skip JSON-LD blocks.
    const body = m[1];
    if (!body || !body.trim()) continue;
    // Skip non-JS scripts (type="application/ld+json", etc.)
    const tag = m[0].slice(0, m[0].indexOf(">") + 1);
    if (/type\s*=\s*["'](?!text\/javascript|module|application\/javascript)/i.test(tag)) continue;
    blocks.push({ index: blocks.length, body });
  }
  return blocks;
}

function parseBlock(body) {
  // `new Function` parses but does not execute — perfect for SyntaxError detection.
  try {
    // eslint-disable-next-line no-new-func
    new Function(body);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err };
  }
}

async function main() {
  const mod = await loadBuilder();

  // Look for a usable builder. The actual exported name lives in portal.functions.ts.
  const candidates = [
    "buildPortalHtmlForModel",
    "buildPortalHtml",
    "renderPortalHtml",
    "buildHtmlForModel",
  ];
  const builderName = candidates.find((n) => typeof mod[n] === "function");
  if (!builderName) {
    console.error(
      `[verify-html] Could not find an exported builder function. Tried: ${candidates.join(", ")}`,
    );
    console.error("[verify-html] Available exports:", Object.keys(mod).join(", "));
    process.exit(2);
  }

  let html;
  try {
    html = await mod[builderName](fixtureModel);
  } catch (err) {
    console.error(`[verify-html] Builder ${builderName} threw:`, err?.message || err);
    process.exit(2);
  }

  if (typeof html !== "string" || !html.includes("<script")) {
    console.error("[verify-html] Builder output did not look like HTML with <script> blocks.");
    process.exit(2);
  }

  const blocks = extractScripts(html);
  if (blocks.length === 0) {
    console.error("[verify-html] No <script> blocks found in generated HTML.");
    process.exit(2);
  }

  let failures = 0;
  for (const { index, body } of blocks) {
    const result = parseBlock(body);
    if (!result.ok) {
      failures += 1;
      console.error(
        `\n[verify-html] ❌ <script> block #${index + 1} failed to parse:\n  ${result.error?.message || result.error}`,
      );
      // Print a small window around the suspected location if possible.
      const msg = String(result.error?.message || "");
      const lineMatch = msg.match(/line (\d+)/i);
      if (lineMatch) {
        const lineNo = Number(lineMatch[1]);
        const lines = body.split("\n");
        const start = Math.max(0, lineNo - 3);
        const end = Math.min(lines.length, lineNo + 2);
        for (let i = start; i < end; i++) {
          const marker = i + 1 === lineNo ? ">>" : "  ";
          console.error(`  ${marker} ${i + 1}: ${lines[i]}`);
        }
      }
    }
  }

  if (failures > 0) {
    console.error(
      `\n[verify-html] FAILED — ${failures} of ${blocks.length} <script> block(s) had syntax errors.`,
    );
    console.error(
      "[verify-html] Likely cause: a single backslash inside the TS template literal in",
    );
    console.error(
      "[verify-html] src/lib/portal.functions.ts. Double the backslash (e.g. \\n → \\\\n).",
    );
    process.exit(1);
  }

  console.log(
    `[verify-html] ✅ All ${blocks.length} <script> block(s) parsed cleanly (builder: ${builderName}).`,
  );
}

main().catch((err) => {
  console.error("[verify-html] Unexpected failure:", err);
  process.exit(2);
});
