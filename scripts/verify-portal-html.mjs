#!/usr/bin/env node
/**
 * Build-time guard for the generated portal HTML.
 *
 * Why this exists:
 *   src/lib/portal.functions.ts builds the entire end-product HTML inside one
 *   giant TS template literal that begins around `const html = \`<!DOCTYPE html>.
 *   Any single backslash inside that literal that should have been doubled
 *   silently corrupts the emitted runtime JavaScript. The generated file looks
 *   fine to eyeball, but the embedded <script> blocks throw `SyntaxError` on
 *   load, which kills the gate buttons and the iframe in the downloaded .html.
 *
 *   We have hit this bug class twice. This script is the durable guard.
 *
 * What it does:
 *   1. Reads src/lib/portal.functions.ts as text (no execution, no bundling).
 *   2. Locates the `const html = \`<!DOCTYPE html>` template literal.
 *   3. Walks the literal body and flags any backslash escape that is not
 *      itself escaped. Inside this template literal, every backslash that
 *      should appear in the emitted JS must be written as `\\` in source.
 *   4. Allows a small set of intentional escapes (e.g. `\${` for literal
 *      dollar braces, `\`` for literal backticks, and `\\` itself).
 *   5. Exits with a non-zero code and a precise line:col + line preview
 *      when a single-backslash escape is found.
 *
 * Run via:   node scripts/verify-portal-html.mjs
 * Or via:    npm run verify:html
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembleFromSources,
  findForbiddenTokens,
} from "../src/lib/portal/ask-runtime-transformer.mjs";

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), "..");
const TARGET = path.join(ROOT, "src/lib/portal.functions.ts");
const ASK_SOURCES = [
  path.join(ROOT, "src/lib/portal/ask-intents.mjs"),
  path.join(ROOT, "src/lib/portal/property-brain.mjs"),
  path.join(ROOT, "src/lib/portal/ask-runtime-logic.mjs"),
];

// Escapes that are legal/intentional in a TS template literal and that we
// do NOT want to flag:
//   \\   — already a doubled backslash (the correct form)
//   \`   — literal backtick inside the template
//   \${  — literal dollar-brace inside the template
//   \xNN, \uNNNN, \u{NNNN} — Unicode/byte escapes we want to keep as-is
const ALLOWED_NEXT = new Set([
  "\\", // \\
  "`",  // \`
  "$",  // \${ or \$ (we'll let the next char decide; \$ alone is fine)
  "x",  // \xNN
  "u",  // \uNNNN or \u{...}
  "0",  // \0 (NUL) — allowed; rare in our template
]);

function readSource() {
  if (!fs.existsSync(TARGET)) {
    console.error(`[verify-html] Source not found: ${TARGET}`);
    process.exit(2);
  }
  return fs.readFileSync(TARGET, "utf8");
}

function findTemplateLiteral(src) {
  // Anchor on the literal start that introduces the HTML body.
  const marker = "const html = `<!DOCTYPE html";
  const start = src.indexOf(marker);
  if (start === -1) {
    console.error(
      "[verify-html] Could not locate the `const html = \\`<!DOCTYPE html>` template literal.",
    );
    console.error(
      "[verify-html] If portal.functions.ts was restructured, update this script's marker.",
    );
    process.exit(2);
  }
  const bodyStart = src.indexOf("`", start) + 1;

  // Walk forward, skipping `${...}` interpolations and escaped chars, until
  // we hit the closing unescaped backtick.
  let i = bodyStart;
  let depth = 0; // ${ depth — we don't scan inside interpolations
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (depth === 0 && ch === "`") {
      return { start: bodyStart, end: i };
    }
    if (ch === "$" && src[i + 1] === "{") {
      depth += 1;
      i += 2;
      continue;
    }
    if (depth > 0 && ch === "}") {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth > 0 && ch === "{") {
      depth += 1;
    }
    i += 1;
  }
  console.error("[verify-html] Reached end of file without finding template close.");
  process.exit(2);
}

function lineColOf(src, offset) {
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset; i++) {
    if (src[i] === "\n") {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

function scanLiteral(src, start, end) {
  const offenders = [];
  let i = start;
  let depth = 0;
  while (i < end) {
    const ch = src[i];
    if (ch === "$" && src[i + 1] === "{") {
      depth += 1;
      i += 2;
      continue;
    }
    if (depth > 0 && ch === "}") {
      depth -= 1;
      i += 1;
      continue;
    }
    if (depth > 0 && ch === "{") {
      depth += 1;
      i += 1;
      continue;
    }
    if (depth > 0) {
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const next = src[i + 1];
      if (!ALLOWED_NEXT.has(next)) {
        offenders.push({ offset: i, next });
      }
      // Skip the escape pair regardless — we don't want to double-count.
      i += 2;
      continue;
    }
    i += 1;
  }
  return offenders;
}

function previewLine(src, offset) {
  const lineStart = src.lastIndexOf("\n", offset - 1) + 1;
  const lineEnd = src.indexOf("\n", offset);
  return src.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
}

function verifyAskRuntimeModules() {
  // Anti-drift gate: the three .mjs modules are read verbatim at build
  // time and concatenated into the browser IIFE. If any `import`,
  // `require`, `export`, or TS-specific syntax sneaks in, the generated
  // HTML will throw at runtime. Scan the assembled output and fail the
  // build before shipping.
  const sources = ASK_SOURCES.map((p) => {
    if (!fs.existsSync(p)) {
      console.error(`[verify-html] Ask runtime source not found: ${p}`);
      process.exit(2);
    }
    return fs.readFileSync(p, "utf8");
  });
  const assembled = assembleFromSources(sources[0], sources[1], sources[2]);
  const offenders = findForbiddenTokens(assembled);
  if (offenders.length > 0) {
    console.error(
      `[verify-html] ❌ Ask runtime .mjs modules contain browser-incompatible syntax.`,
    );
    console.error(
      `[verify-html] The .mjs files in src/lib/portal/ must use ONLY plain JS:`,
    );
    console.error(
      `[verify-html]   - no import / require statements`,
    );
    console.error(
      `[verify-html]   - no export statements other than a single final \`export { ... };\``,
    );
    console.error(
      `[verify-html]   - no TypeScript syntax (annotations, interfaces, \`as\` casts)`,
    );
    for (const o of offenders) console.error(`    ${o}`);
    process.exit(1);
  }
  console.log(
    `[verify-html] ✅ Ask runtime modules are browser-safe (${assembled.length} chars assembled).`,
  );
}

function main() {
  verifyAskRuntimeModules();

  const src = readSource();
  const { start, end } = findTemplateLiteral(src);
  const offenders = scanLiteral(src, start, end);

  if (offenders.length === 0) {
    console.log(
      `[verify-html] ✅ No risky single-backslash escapes found in the portal HTML template ` +
        `(${end - start} chars scanned).`,
    );
    return;
  }

  console.error(
    `[verify-html] ❌ Found ${offenders.length} single-backslash escape(s) in the portal HTML template.`,
  );
  console.error(
    "[verify-html] Inside this template literal, every \\X meant to reach the runtime JS must be written as \\\\X.",
  );
  console.error(
    "[verify-html] e.g. \\n → \\\\n,  /\\s+/ → /\\\\s+/,  \\d → \\\\d.",
  );
  for (const off of offenders) {
    const { line, col } = lineColOf(src, off.offset);
    const preview = previewLine(src, off.offset);
    console.error(`\n  src/lib/portal.functions.ts:${line}:${col}  (\\${off.next})`);
    console.error(`    ${preview}`);
    console.error(`    ${" ".repeat(Math.max(0, col - 1))}^`);
  }
  console.error(
    `\n[verify-html] FAILED — fix the escapes above. This is the same bug class as the previous "iframe never loads / Start button dead" regression.`,
  );
  process.exit(1);
}

main();
