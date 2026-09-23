/**
 * Python <-> JavaScript regex parity.
 *
 * Every expectation in this file is what *Python* produces, derived by reading
 * `backend/src/atsresume/truth/vocabulary.py`, `pipeline/scoring.py` and
 * `truth/guard.py` and tracing the engines by hand. Python was not run: the
 * backend directory belongs to another agent. If one of these ever fails, the
 * TypeScript is what is wrong.
 *
 * The constructs under suspicion, and why:
 *
 * * `_PUNCT = r"[^a-z0-9+#./\- ]+"` runs *after* `.lower()`, so it also eats
 *   every non-ASCII character. Inside a character class `.` and `/` are
 *   literal in both engines and `\-` is a literal hyphen in both.
 * * `_IZE = r"(is|iz)(e|ed|es|ing|ation|ations)\b"` depends on leftmost-first
 *   alternation *and* on backtracking out of a failed `\b`. Both engines do
 *   both, which is why "organizations" folds to "organis" and not to
 *   "organiss".
 * * `(?<![a-z0-9])...(?![a-z0-9])` lookarounds instead of `\b`, because the
 *   normalised alphabet includes `+ # . / -`.
 * * Python's `re.escape` escapes space, `#`, `&`, `~` and `-`; JavaScript must
 *   not, because those are SyntaxErrors under the `u` flag. Same language,
 *   different spelling.
 */

import { describe, expect, it } from 'vitest';

import {
  TECH_SHAPED,
  buildVocabulary,
  canonical,
  escapeRegExp,
  normalise,
  termsPresent,
} from '../src/vocabulary/index';
import { contains, covers, stem } from '../src/scoring/text';
import { digitsOf, metrics } from '../src/scoring/metrics';
import { pyRound } from '../src/util/py-round';

/* ------------------------------------------------------------------ */
/* normalise                                                           */
/* ------------------------------------------------------------------ */

// [input, what Python's normalise() returns]
const NORMALISE_CASES: ReadonlyArray<readonly [string, string]> = [
  // --- characters _PUNCT keeps -------------------------------------- //
  ['Node.js', 'node.js'],
  ['C++', 'c++'],
  ['C#', 'c#'],
  ['.NET Core', '.net core'],
  ['CI/CD', 'ci/cd'],
  ['pub/sub', 'pub/sub'],
  ['role-based access', 'role-based access'],
  ['K8s', 'k8s'],
  ['Spring Boot', 'spring boot'],
  ['Ruby on Rails', 'ruby on rails'],
  ['8 GB', '8 gb'],
  ['Rs 1.5 Cr', 'rs 1.5 cr'],

  // --- characters _PUNCT strips ------------------------------------- //
  ['Bengaluru, India', 'bengaluru india'],
  ['Kubernetes (K8s)', 'kubernetes k8s'],
  ['TypeScript_v5', 'typescript v5'], // underscore is NOT in the keep-class
  ['ML/AI & Data', 'ml/ai data'],
  ['50%', '50'],
  ['$1,200', '1 200'],
  ['naïve', 'na ve'], // accented letters go, they are not [a-z]
  ['don’t', 'don t'], // curly apostrophe
  ['中文 text', 'text'], // CJK stripped, then the leading space trimmed

  // --- dash folding, U+2010..U+2015 --------------------------------- //
  ['A‐B', 'a-b'], // HYPHEN
  ['A–B', 'a-b'], // EN DASH
  ['e—m', 'e-m'], // EM DASH
  ['A―B', 'a-b'], // HORIZONTAL BAR
  ['A−B', 'a b'], // MINUS SIGN is OUTSIDE the range: stripped, not folded

  // --- the -ise/-ize fold, including its quirks --------------------- //
  ['Optimized', 'optimis'],
  ['Optimised', 'optimis'],
  ['organization', 'organis'],
  ['Organisations', 'organis'], // `ation` matches first, \b fails, `ations` wins
  ['containerised deployment', 'containeris deployment'],
  ['containerization', 'containeris'],
  ['visualization', 'visualis'], // the leading "is" of "vis" cannot match
  ['advertising', 'advertis'], // `ing`
  ['raised', 'rais'], // `ed`
  ['prizes', 'pris'], // `es`; yes, really
  ['wise', 'wis'], // `e`; a known over-fire, preserved deliberately
  ['this', 'this'], // "is" with nothing after it: no match
  ['ISO', 'iso'], // "is" followed by "o": no match
  ['he is eating', 'he is eating'], // "is" followed by a space: no match

  // --- whitespace --------------------------------------------------- //
  ['  spaced   out  ', 'spaced out'],
  ['  MULTI\nLINE\tTABS ', 'multi line tabs'],
  ['', ''],
  ['   ', ''],
];

describe('normalise', () => {
  it.each(NORMALISE_CASES)('normalise(%j) === %j', (input, expected) => {
    expect(normalise(input)).toBe(expected);
  });

  it('is idempotent on already-normalised text', () => {
    for (const [, expected] of NORMALISE_CASES) {
      // Not true in general (the -ize fold can cascade), but it is true for
      // every output above, and a regression here means the fold changed.
      expect(normalise(expected)).toBe(expected);
    }
  });
});

/* ------------------------------------------------------------------ */
/* canonical                                                           */
/* ------------------------------------------------------------------ */

describe('canonical', () => {
  it.each([
    ['Postgres', 'postgresql'],
    ['  K8s  ', 'kubernetes'],
    ['RESTful', 'rest'],
    ['NodeJS', 'node.js'],
    ['Google Cloud', 'gcp'],
    ['Whatever', 'whatever'],
    ['', ''],
  ] as const)('canonical(%j) === %j', (input, expected) => {
    expect(canonical(input)).toBe(expected);
  });
});

/* ------------------------------------------------------------------ */
/* _contains: the lookaround word boundary                             */
/* ------------------------------------------------------------------ */

describe('contains', () => {
  it.each([
    // The bugs the lookarounds exist to prevent.
    ['Go', 'google cloud platform', false],
    ['R', 'react and r programming', true],
    ['R', 'react and ruby', false],
    ['C', 'c and c++ and scala', true],
    ['REST', 'restful apis', false],
    ['rest', 'rest apis', true],
    ['Postgres', 'postgresql tuning', false],
    // Characters that survive normalisation and must be escaped, not special.
    ['Node.js', 'worked with node.js daily', true],
    ['Node.js', 'worked with nodexjs daily', false], // proves the dot is escaped
    ['C++', 'built c++ services', true],
    ['c#', 'c# and f#', true],
    ['K8s', 'k8s cluster', true],
    ['CI/CD', 'ran ci/cd pipelines', true],
    // Empty needle short-circuits before the regex is built.
    ['', 'anything at all', false],
    ['   ', 'anything at all', false],
    ['%%%', 'anything at all', false], // normalises to "", same path
  ] as const)('contains(%j, %j) === %s', (term, hay, expected) => {
    expect(contains(term, hay)).toBe(expected);
  });
});

/* ------------------------------------------------------------------ */
/* _stem                                                               */
/* ------------------------------------------------------------------ */

describe('stem', () => {
  it.each([
    ['indexes', 'index'],
    ['indexing', 'index'],
    ['optimisation', 'optimis'],
    ['caches', 'cach'],
    ['cache', 'cache'], // len - len("es") is 3, below the 4-character floor
    ['queries', 'quer'],
    ['designed', 'design'],
    ['teams', 'team'],
    ['data', 'data'],
    ['es', 'es'], // too short for any suffix to apply
    ['', ''],
  ] as const)('stem(%j) === %j', (word, expected) => {
    expect(stem(word)).toBe(expected);
  });
});

/* ------------------------------------------------------------------ */
/* _covers                                                             */
/* ------------------------------------------------------------------ */

describe('covers', () => {
  it('falls through to whole-word containment first', () => {
    expect(covers('Docker', 'shipped docker images')).toBe(true);
  });

  it('refuses single-token requirements it does not literally contain', () => {
    expect(covers('Node', 'nodejs services')).toBe(false);
    expect(covers('Kubernetes', 'no container work here')).toBe(false);
  });

  it('clears the 2/3 threshold on a three-token phrase', () => {
    // "rest" and "design" match by stem; "api" does not, because the haystack
    // wrote "apis" and stem("apis") is "apis" (too short to lose the "s").
    expect(covers('REST API design', 'designed rest apis for internal teams')).toBe(true);
  });

  it('misses at exactly one half', () => {
    // stem("caching") is "cach", the haystack stems to "cache": 1 of 2.
    expect(covers('Redis caching', 'used redis to cache results')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* _metrics                                                            */
/* ------------------------------------------------------------------ */

describe('metrics', () => {
  it.each([
    ['Cut p95 latency by 40% and served 1,200 users', ['40%', '1,200 users']],
    ['Reduced build time from 12 minutes to 3 minutes', ['12 minutes', '3 minutes']],
    ['Served 250 requests', ['250']], // no unit: the bare \b\d{2,}\b branch
    ['Shipped 3 features', []], // single digit, no unit, no branch matches
    ['99.9% uptime', ['99.9%']],
    ['Handled 5k requests', ['5k']],
    ['Cut latency 300ms', ['300ms']],
    ['over 2 years', ['2 years']],
    ['Took 10x longer', ['10x']],
    ['$1,200 saved', ['$1,200']],
    ['₹5 lakh', ['₹5']],
    ['  40%  ', ['40%']], // group(0).strip()
    ['A/B test with 2 variants', []],
    ['no numbers here', []],
    ['', []],
  ] as const)('metrics(%j)', (text, expected) => {
    expect(metrics(text)).toEqual(expected);
  });

  it('lowercases, as group(0).strip().lower() does', () => {
    expect(metrics('Saved 40MS and 3 Days')).toEqual(['40ms', '3 days']);
  });

  it('is not affected by lastIndex leaking between calls', () => {
    const text = 'cut 40% and 12 minutes';
    const first = metrics(text);
    for (let i = 0; i < 5; i += 1) expect(metrics(text)).toEqual(first);
  });

  it('digitsOf strips everything but digits', () => {
    expect(digitsOf('1,200 users')).toBe('1200');
    expect(digitsOf('$1.5m')).toBe('15');
    expect(digitsOf('no digits')).toBe('');
  });
});

/* ------------------------------------------------------------------ */
/* _TECH_SHAPED, build_vocabulary, terms_present                       */
/* ------------------------------------------------------------------ */

describe('TECH_SHAPED', () => {
  it.each([
    ['Kubernetes', true],
    ['Kafka', true],
    ['node.js', true], // second alternative: carries a dot
    ['c++', true],
    ['k8s', true], // carries a digit
    // The first alternative stops at the slash, but the SECOND one accepts it:
    // `[A-Za-z0-9]*` takes "CI", `[0-9+#./]` takes "/", the tail takes "CD".
    // (build_vocabulary never sees it whole anyway — it splits on `[\s/]+`.)
    ['CI/CD', true],
    ['workflow', false], // lowercase, no marker
    ['multi-tenant', false],
    ['', false],
  ] as const)('TECH_SHAPED.test(%j) === %s', (word, expected) => {
    expect(TECH_SHAPED.test(word)).toBe(expected);
  });
});

describe('buildVocabulary', () => {
  const base = buildVocabulary();

  it('is sorted and seeded with both the tech list and the alias keys', () => {
    expect([...base]).toEqual([...base].sort());
    expect(base).toContain('kubernetes');
    expect(base).toContain('k8s'); // alias key, matchable as well as mapped
    expect(base).toContain('role-based access');
  });

  it('seeds a name-shaped posting term', () => {
    expect(buildVocabulary(['Bun'])).toContain('bun');
    expect(buildVocabulary(['Apache Kafka'])).toContain('apache kafka');
  });

  it('refuses capability phrases, which is the whole point of the filter', () => {
    expect(buildVocabulary(['workflow automation'])).not.toContain('workflow automation');
    expect(buildVocabulary(['multi-tenant data isolation'])).not.toContain(
      'multi-tenant data isolation',
    );
    expect(buildVocabulary(['production experience'])).not.toContain('production experience');
  });

  it('refuses terms that are too short, too long, or too many words', () => {
    expect(buildVocabulary(['a'])).not.toContain('a');
    expect(buildVocabulary(['One Two Three'])).not.toContain('one two three');
    expect(buildVocabulary(['A'.repeat(31)])).not.toContain('a'.repeat(31));
  });
});

describe('termsPresent', () => {
  const vocab = buildVocabulary();

  it('canonicalises what it finds', () => {
    expect(termsPresent('We used Postgres and Node.js with Redis', vocab)).toEqual(
      new Set(['postgresql', 'node.js', 'redis']),
    );
  });

  it('matches a plural against a singular vocabulary entry', () => {
    // "rest apis" is itself an alias key and wins the longest-first ordering,
    // mapping to "rest"; "webhooks" is in the vocabulary as written.
    expect(termsPresent('Built REST APIs and webhooks', vocab)).toEqual(
      new Set(['rest', 'webhooks']),
    );
  });

  it('does not let a short term shadow a longer one', () => {
    // "next" must not eat "next.js".
    expect(termsPresent('Shipped on Next.js', vocab)).toEqual(new Set(['next.js']));
  });

  it('skips single-character vocabulary entries such as "r"', () => {
    expect(termsPresent('r and go', vocab)).toEqual(new Set(['go']));
  });

  it('returns an empty set for empty input', () => {
    expect(termsPresent('', vocab)).toEqual(new Set());
    expect(termsPresent('anything', [])).toEqual(new Set());
  });

  it('gives the same answer every time despite the RegExp cache', () => {
    const text = 'Postgres, Redis, Kafka, Docker';
    const first = [...termsPresent(text, vocab)].sort();
    for (let i = 0; i < 10; i += 1) {
      expect([...termsPresent(text, vocab)].sort()).toEqual(first);
    }
  });
});

/* ------------------------------------------------------------------ */
/* escapeRegExp                                                        */
/* ------------------------------------------------------------------ */

describe('escapeRegExp', () => {
  it('neutralises every character that is special outside a class', () => {
    const specials = '.*+?^${}()|[]\\';
    const escaped = escapeRegExp(specials);
    expect(new RegExp(`^${escaped}$`).test(specials)).toBe(true);
  });

  it('leaves alone the characters Python escapes but JavaScript must not', () => {
    // Python's re.escape would emit "\ ", "\#", "\&", "\~", "\-" here. Under
    // the `u` flag those are SyntaxErrors in JavaScript; the matched language
    // is the same either way.
    expect(escapeRegExp('a b#c&d~e-f/g')).toBe('a b#c&d~e-f/g');
  });

  it('keeps normalised tech names matchable as literals', () => {
    for (const term of ['node.js', 'c++', 'c#', 'ci/cd', 'role-based access', 'pub/sub']) {
      expect(new RegExp(`^${escapeRegExp(term)}$`).test(term)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* pyRound                                                             */
/* ------------------------------------------------------------------ */

describe('pyRound', () => {
  it('rounds halves to even, where Math.round rounds away from zero', () => {
    expect(pyRound(2.5)).toBe(2);
    expect(Math.round(2.5)).toBe(3);
    expect(pyRound(3.5)).toBe(4);
    expect(pyRound(0.5)).toBe(0);
    expect(pyRound(1.5)).toBe(2);
    expect(pyRound(-2.5)).toBe(-2);
    expect(pyRound(-0.5)).toBe(-0);
  });

  it('breaks the one-decimal ties that a quarter-weighted score produces', () => {
    expect(pyRound(0.25, 1)).toBe(0.2);
    expect(pyRound(0.75, 1)).toBe(0.8);
    expect(pyRound(1.25, 1)).toBe(1.2);
    // The exact value that diverges on fixture case "D5 strong mechanisms".
    expect(pyRound(88.25, 1)).toBe(88.2);
    expect(Math.round(88.25 * 10) / 10).toBe(88.3);
  });

  it('rounds on the exact binary value, not the decimal that was typed', () => {
    // 2.675 is really 2.67499999999999982..., so it rounds DOWN in Python.
    expect(pyRound(2.675, 2)).toBe(2.67);
    // 0.35 is really 0.34999999999999997..., likewise.
    expect(pyRound(0.35, 1)).toBe(0.3);
    // 0.45 is really 0.450000000000000011..., so it rounds UP.
    expect(pyRound(0.45, 1)).toBe(0.5);
  });

  it('passes ordinary values straight through', () => {
    expect(pyRound(72.78583916083916, 1)).toBe(72.8);
    expect(pyRound(0.9068181818181817, 3)).toBe(0.907);
    expect(pyRound(100, 1)).toBe(100);
    expect(pyRound(0, 1)).toBe(0);
    expect(pyRound(-12.35, 1)).toBe(-12.3); // -12.35 is -12.3499999...
  });

  it('survives non-finite input the way the callers expect', () => {
    expect(pyRound(Number.NaN, 1)).toBeNaN();
    expect(pyRound(Number.POSITIVE_INFINITY, 1)).toBe(Number.POSITIVE_INFINITY);
  });
});
