/**
 * Minimal JavaScript-aware scanner used by the portal runtime safety
 * guards. The scanner walks one inline <script> body and reports the
 * positions of regex literals whose body contains raw control
 * characters (CR / LF / TAB) — the precise corruption that breaks
 * inline runtime parsing in the generated presentation HTML.
 *
 * Why a hand-rolled scanner: a naive regex over the whole body cannot
 * tell a regex literal from a line comment, a block comment,
 * a string, a template literal, or a division operator. We hit a
 * false-positive in production where the scanner flagged ordinary
 * comments containing a newline. This module fixes that by tracking
 * lexical context explicitly:
 *
 *   - // line comments
 *   - block comments
 *   - 'single' / "double" strings
 *   - `template` literals (with ${...} interpolation depth)
 *   - regex literals, only when the preceding token allows one
 *
 * The "regex vs division" decision is the classic ambiguity. We use
 * the well-known heuristic: a `/` starts a regex when the previous
 * meaningful character is one that cannot end an expression
 * (operators, punctuation, keywords). Otherwise it's division. This
 * heuristic is good enough for the runtime we emit; we control the
 * source.
 */

export interface RegexLiteralHit {
  /** 0-based offset of the opening `/` in the script body. */
  start: number;
  /** 0-based offset just past the flags. */
  end: number;
  /** The body between the slashes (no flags). */
  inner: string;
  /** Trailing flag chars. */
  flags: string;
}

const REGEX_PRECEDERS = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-",
  "*", "/", "%", "^", "~", "<", ">", "\n", "\r",
]);
const REGEX_PRECEDING_KEYWORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "delete", "void", "throw",
  "new", "do", "else", "case", "yield", "await",
]);

function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_$]/.test(ch);
}

function lastMeaningfulToken(src: string, idx: number): string {
  // Walk back over whitespace.
  let i = idx - 1;
  while (i >= 0 && /\s/.test(src[i])) i--;
  if (i < 0) return "";
  const ch = src[i];
  if (isIdentChar(ch)) {
    let j = i;
    while (j >= 0 && isIdentChar(src[j])) j--;
    return src.slice(j + 1, i + 1);
  }
  return ch;
}

function canStartRegex(src: string, slashIdx: number): boolean {
  const tok = lastMeaningfulToken(src, slashIdx);
  if (!tok) return true;
  if (tok.length === 1) return REGEX_PRECEDERS.has(tok);
  if (REGEX_PRECEDING_KEYWORDS.has(tok)) return true;
  return false;
}

/**
 * Scan a single script body and invoke `onRegex` for each detected
 * regex literal. The scanner ignores comments, strings, and template
 * literals. Template-literal interpolations (`${...}`) are descended
 * into recursively so regexes inside them are still found.
 */
export function scanScriptForRegex(
  body: string,
  onRegex: (hit: RegexLiteralHit) => void,
): void {
  const len = body.length;
  let i = 0;
  // Stack of template-literal context: each entry tracks how many
  // open `{` we've seen inside the current `${...}` so we know when
  // it closes and we should resume template-literal scanning.
  const tplStack: Array<{ braceDepth: number }> = [];

  function inTemplateInterp(): boolean {
    return tplStack.length > 0 && tplStack[tplStack.length - 1].braceDepth > 0;
  }

  while (i < len) {
    const ch = body[i];
    const next = body[i + 1];

    // Inside a template-literal head/tail (not interp): handle ` and ${.
    if (tplStack.length > 0 && !inTemplateInterp()) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === "`") { tplStack.pop(); i++; continue; }
      if (ch === "$" && next === "{") {
        tplStack[tplStack.length - 1].braceDepth = 1;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // Comments.
    if (ch === "/" && next === "/") {
      const nl = body.indexOf("\n", i + 2);
      i = nl === -1 ? len : nl + 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = body.indexOf("*/", i + 2);
      i = end === -1 ? len : end + 2;
      continue;
    }

    // Strings.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < len) {
        const c = body[i];
        if (c === "\\") { i += 2; continue; }
        if (c === quote) { i++; break; }
        if (c === "\n") break; // unterminated; bail
        i++;
      }
      continue;
    }

    // Template literal start.
    if (ch === "`") {
      tplStack.push({ braceDepth: 0 });
      i++;
      continue;
    }

    // Track `{` / `}` inside a template interpolation so we know
    // when to pop back into template-literal scanning.
    if (inTemplateInterp()) {
      if (ch === "{") {
        tplStack[tplStack.length - 1].braceDepth++;
      } else if (ch === "}") {
        const top = tplStack[tplStack.length - 1];
        top.braceDepth--;
        if (top.braceDepth === 0) {
          // Resume template scanning at next iteration.
          i++;
          continue;
        }
      }
    }

    // Regex literal candidate.
    if (ch === "/" && canStartRegex(body, i)) {
      const start = i;
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < len) {
        const c = body[j];
        if (c === "\\") { j += 2; continue; }
        if (c === "[") { inClass = true; j++; continue; }
        if (c === "]" && inClass) { inClass = false; j++; continue; }
        if (c === "/" && !inClass) { closed = true; break; }
        // A real regex literal cannot legally contain a raw newline,
        // but we keep scanning past one so we can REPORT it as
        // corruption — that's the entire point of this scanner.
        j++;
      }
      if (!closed) {
        // Unterminated: not a regex; treat the / as division and move on.
        i++;
        continue;
      }
      const inner = body.slice(start + 1, j);
      let k = j + 1;
      while (k < len && /[gimsuy]/.test(body[k])) k++;
      const flags = body.slice(j + 1, k);
      onRegex({ start, end: k, inner, flags });
      i = k;
      continue;
    }

    i++;
  }
}

/** Convenience: collect regex literals whose inner body has raw CR/LF/TAB. */
export function findCorruptedRegexLiterals(body: string): RegexLiteralHit[] {
  const hits: RegexLiteralHit[] = [];
  scanScriptForRegex(body, (hit) => {
    if (/[\r\n\t]/.test(hit.inner)) hits.push(hit);
  });
  return hits;
}
