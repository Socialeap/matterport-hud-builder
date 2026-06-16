// Phone-number redaction for fixture sanitization. Structural ONLY — this module
// hardcodes NO real numbers; it matches phone-SHAPED text and replaces it with a
// digit-free sentinel. The SAME patterns drive both redaction (sanitizer) and
// residual detection (sanitizer + committed-fixture test), so a number that would
// survive redaction is exactly what the residual check flags. Tests assert the
// committed fixture yields zero residual phones — never comparing to a real value.
//
// Covered surfaces: visible HTML text, JS/JSON config values, attributes, and
// `tel:` URLs. The sentinel contains no digits, so it can never re-trigger a
// pattern (no residual false-positive on already-redacted output).

export const PHONE_SENTINEL = "[redacted-phone]";

const digitCount = (s) => (s.match(/\d/g) || []).length;

// Each entry: a matcher, a digit-count gate (to avoid eating long non-phone
// digit runs), and the replacement (some keep surrounding syntax like quotes).
const PHONE_PATTERNS = [
  // tel: URL bodies that actually contain a digit (so the sentinel is inert).
  {
    re: () => /tel:[^"'<>\s]*\d[^"'<>\s]*/g,
    gate: () => true,
    rep: () => "tel:" + PHONE_SENTINEL,
  },
  // A quoted bare digit run (JS/JSON config value): "5551234567" / "+15551234567".
  {
    re: () => /"\+?1?\d{10,11}"/g,
    gate: () => true,
    rep: () => '"' + PHONE_SENTINEL + '"',
  },
  // NANP-style grouped numbers: (516) 362-0890 / 516-362-0890 / 516.362.0890 /
  // +1 516-362-0890. Requires separators, so dates (2026-05-25) don't match.
  {
    re: () => /(?:\+?\d{1,3}[ .-]?)?(?:\(\d{3}\)\s?|\d{3}[ .-])\d{3}[ .-]\d{4}/g,
    gate: (m) => digitCount(m) >= 7 && digitCount(m) <= 15,
    rep: () => PHONE_SENTINEL,
  },
  // International "+"-prefixed numbers using only phone punctuation:
  // +44 20 7946 0958 / +15551234567.
  {
    re: () => /\+\d[\d ().-]{6,16}\d/g,
    gate: (m) => digitCount(m) >= 8 && digitCount(m) <= 15,
    rep: () => PHONE_SENTINEL,
  },
];

// Replace every phone-shaped run with the sentinel. Pure (returns a new string).
export function redactPhones(text) {
  let out = text;
  for (const p of PHONE_PATTERNS) {
    out = out.replace(p.re(), (m) => (p.gate(m) ? p.rep(m) : m));
  }
  return out;
}

// Return every phone-shaped run still present (after redaction this must be []).
export function findPhones(text) {
  const hits = [];
  for (const p of PHONE_PATTERNS) {
    const re = p.re();
    for (let m = re.exec(text); m !== null; m = re.exec(text)) {
      if (p.gate(m[0])) hits.push(m[0]);
    }
  }
  return hits;
}
