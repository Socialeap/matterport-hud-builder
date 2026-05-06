/**
 * Build-time guard for the assembled presentation HTML.
 *
 * Detects the precise failure mode where a regex literal in the
 * inline runtime contains raw CR / LF / TAB characters — an illegal
 * JavaScript regex that would crash the visitor's browser before the
 * IIFE can run.
 *
 * This module previously used a naive regex-over-the-script approach
 * that misidentified `// comments\n` as regex literals and produced
 * false positives that blocked the export. It now delegates to the
 * lexically-aware scanner in `./js-regex-scan` which correctly skips
 * comments, strings, and template literals.
 */

import { findCorruptedRegexLiterals } from "./js-regex-scan";

export class RuntimeLintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeLintError";
  }
}

export function findUnescapedRegexControlChars(
  html: string,
  max = 5,
): Array<{ snippet: string; line: number }> {
  const offenders: Array<{ snippet: string; line: number }> = [];
  const scriptRe = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptRe.exec(html)) !== null) {
    const attrs = scriptMatch[1] || "";
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const body = scriptMatch[2];
    const scriptStart = scriptMatch.index + scriptMatch[0].indexOf(body);

    const hits = findCorruptedRegexLiterals(body);
    for (const hit of hits) {
      const absoluteIdx = scriptStart + hit.start;
      const line = html.slice(0, absoluteIdx).split("\n").length;
      const raw = body.slice(hit.start, hit.end);
      const snippet = raw
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t")
        .slice(0, 120);
      offenders.push({ snippet, line });
      if (offenders.length >= max) return offenders;
    }
  }
  return offenders;
}

export function assertRuntimeRegexSafety(html: string): void {
  const offenders = findUnescapedRegexControlChars(html);
  if (offenders.length === 0) return;
  const lines = offenders.map((o) => `  - line ~${o.line}: ${o.snippet}`);
  throw new RuntimeLintError(
    `[portal] Inline runtime contains regex literal(s) with raw control characters. ` +
      `Inside the portal.functions.ts template literal, write \\\\r / \\\\n / \\\\t ` +
      `(double-escaped) so the emitted regex contains escape sequences, not raw control chars.\n` +
      lines.join("\n"),
  );
}
