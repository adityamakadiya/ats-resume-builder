/**
 * `_metrics()` from `backend/src/atsresume/truth/guard.py`.
 *
 * scoring_v2.py imports it from the guard and keeps a byte-identical fallback
 * copy inline; there is one copy here on purpose, because the two Python
 * copies drifting is a bug the module docstring itself warns about.
 *
 * The Python pattern is `re.VERBOSE | re.IGNORECASE`. VERBOSE only strips
 * unescaped whitespace, so the flattened form below is the same language.
 *
 * Alternation order is load bearing and is preserved exactly: `s\b` sits
 * before `sec\b` and `seconds\b`, and `m\b` before `mb\b`, so the engine has
 * to backtrack through the boundary assertion to reach the longer unit. Both
 * engines are leftmost-first backtracking NFAs, so they agree.
 *
 * Two known, accepted divergences, neither reachable from resume prose:
 * Python's `\d` and `\b` are Unicode-aware on `str` patterns (Devanagari
 * digits, accented word characters), JavaScript's are ASCII-only.
 */

const METRIC =
  /(?:\d[\d,.]*\s?(?:%|percent|x\b|ms\b|s\b|sec\b|seconds\b|min\b|minutes\b|hours?\b|days?\b|weeks?\b|months?\b|years?\b|k\b|m\b|b\b|mb\b|gb\b|tb\b|rps\b|qps\b|tps\b|req\/s|users?\b|customers?\b|clients?\b))|(?:[$₹€£]\s?\d[\d,.]*)|(?:\b\d{2,}\b)/gi;

/** Every figure-with-a-unit, money amount, or bare multi-digit number. */
export function metrics(text: string): string[] {
  METRIC.lastIndex = 0;
  const out: string[] = [];
  for (const match of text.matchAll(METRIC)) {
    out.push(match[0].trim().toLowerCase());
  }
  return out;
}

const NON_DIGITS = /[^0-9]/g;

/** `_DIGITS.sub("", value)`. */
export function digitsOf(value: string): string {
  return value.replace(NON_DIGITS, '');
}
