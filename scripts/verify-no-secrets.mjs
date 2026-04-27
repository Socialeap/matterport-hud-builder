#!/usr/bin/env node
/**
 * Verification artifact: scan src/lib/portal.functions.ts for two
 * classes of regressions:
 *
 *   1. Legacy "Your AI is now familiar" success copy that is no
 *      longer guarded by intelligence_health.status === "ready".
 *      The wizard's VerifyStep is supposed to render that copy via
 *      describeIntelligenceHealth() now; any leftover hard-coded
 *      strings would re-introduce the visible bug from the PR
 *      description.
 *
 *   2. Embedded secrets in the exported HTML. The exporter is
 *      meant to embed only public identifiers + the signed
 *      presentation token. A regression here would leak Gemini
 *      keys, OpenAI keys, Supabase service-role keys, or BYOK
 *      ciphertexts into the static HTML downloaded by every
 *      visitor.
 *
 * Run via:   node scripts/verify-no-secrets.mjs
 * Exit code: 0 on clean, 1 on any finding.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");

let failed = 0;

function check(label, ok, detail) {
  const symbol = ok ? "ok" : "FAIL";
  // eslint-disable-next-line no-console
  console.log(`[${symbol}] ${label}${detail ? `: ${detail}` : ""}`);
  if (!ok) failed += 1;
}

// -- 1. Legacy success copy in the wizard step is gated behind
//       describeIntelligenceHealth. We grep the wizard files; if the
//       literal "now familiar with" appears outside health.ts, we
//       fail. (The canonical copy lives in describeIntelligenceHealth
//       in src/lib/intelligence/health.ts only.)
const WIZARD_FILES = [
  "src/components/portal/ai-training-wizard/AiTrainingWizard.tsx",
  "src/components/portal/ai-training-wizard/steps/TrainingStep.tsx",
  "src/components/portal/ai-training-wizard/steps/VerifyStep.tsx",
  "src/components/portal/PropertyIntelligenceSection.tsx",
];
const LEGACY_PATTERNS = [
  /Your AI is now familiar with[^{]*\$\{?[^}]*propertyName/, // hard-coded success line
];
for (const rel of WIZARD_FILES) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, "utf8");
  let hits = 0;
  for (const pat of LEGACY_PATTERNS) {
    if (pat.test(src)) hits += 1;
  }
  check(
    `${rel}: no hard-coded "now familiar" success copy`,
    hits === 0,
    hits > 0 ? `${hits} match(es)` : "",
  );
}

// -- 2. portal.functions.ts must not interpolate any obvious secret
//       values into the generated HTML template literal.
const PORTAL = path.join(ROOT, "src/lib/portal.functions.ts");
const portalSrc = fs.readFileSync(PORTAL, "utf8");

// Identify the html template literal start. It begins with `const html = \``.
const htmlStart = portalSrc.indexOf("const html = `");
check(
  "portal.functions.ts: contains the html template literal",
  htmlStart > 0,
);

if (htmlStart > 0) {
  const htmlBody = portalSrc.slice(htmlStart);
  const SECRET_PATTERNS = [
    { name: "OpenAI key", re: /sk-[A-Za-z0-9]{20,}/ },
    { name: "Gemini key", re: /AIza[A-Za-z0-9_-]{20,}/ },
    {
      name: "Supabase service role JWT (eyJ...service_role)",
      re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
    },
    {
      name: "service_role literal in interpolation",
      re: /\$\{[^}]*service_role[^}]*\}/i,
    },
    {
      name: "BYOK ciphertext interpolation",
      re: /\$\{[^}]*ciphertext[^}]*\}/i,
    },
    {
      name: "BYOK_MASTER_KEY interpolation",
      re: /\$\{[^}]*BYOK_MASTER_KEY[^}]*\}/i,
    },
    {
      name: "PRESENTATION_TOKEN_SECRET interpolation",
      re: /\$\{[^}]*PRESENTATION_TOKEN_SECRET[^}]*\}/i,
    },
  ];
  for (const { name, re } of SECRET_PATTERNS) {
    const match = htmlBody.match(re);
    check(
      `html template: no ${name} reference`,
      !match,
      match ? `match: ${match[0].slice(0, 40)}…` : "",
    );
  }

  // The PRESENTATION_TOKEN value itself is supposed to be embedded —
  // verify the deliberate, expected window global is present so a
  // future refactor that drops it doesn't silently break Ask AI.
  const expectsToken =
    /window\.__PRESENTATION_TOKEN__/.test(htmlBody) &&
    /window\.__SAVED_MODEL_ID__/.test(htmlBody);
  check(
    "html template: deliberately embeds __PRESENTATION_TOKEN__ + __SAVED_MODEL_ID__",
    expectsToken,
  );
}

if (failed > 0) {
  // eslint-disable-next-line no-console
  console.error(`\n${failed} verification check(s) failed.`);
  process.exit(1);
}
// eslint-disable-next-line no-console
console.log("\nAll verification checks passed.");
