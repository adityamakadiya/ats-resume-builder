/**
 * Port of `backend/src/atsresume/pipeline/scoring_v2.py`.
 *
 * Five dimensions, two of them genuinely new, plus bounded penalties:
 *
 *     keyword_coverage     0.35   saturating: the second mention earns nothing
 *     requirement_coverage 0.20   required weighted 2x preferred
 *     evidence_density     0.20   share of bullets stating a concrete outcome
 *     specificity          0.15   share of bullets naming a real mechanism
 *     experience_match     0.10
 *
 * Evidence and specificity are scaled by a relevance gate running from 0.35 at
 * zero job relevance to 1.0 at full relevance, so well-written prose about
 * unrelated work cannot climb past roughly 22.
 *
 * `SubScores.section_completeness` carries **evidence density**, not sections;
 * `AtsReport` reports section completeness as a flat 100 and surfaces genuinely
 * missing sections through {@link sectionWarnings} instead.
 *
 * Every `round()` in the Python maps to {@link pyRound}, never `Math.round`.
 */

import type {
  AtsReport,
  JobSpec,
  ResumeFacts,
  TailoredResume,
} from '../schema/index';
import { Importance } from '../schema/index';
import { escapeRegExp, normalise } from '../vocabulary/index';
import { pyRound } from '../util/py-round';
import { digitsOf, metrics } from './metrics';
import {
  contains,
  covers,
  factsTextOf,
  resumeTextOf,
  scoreExperienceMatch,
  splitWords,
} from './text';

export const WEIGHTS = {
  keyword_coverage: 0.3,
  requirement_coverage: 0.18,
  // A recruiter reads the most recent title against the req title before
  // reading anything else. Nothing in v2 measured it.
  title_match: 0.12,
  evidence_density: 0.2,
  specificity: 0.15,
  // Down from 0.10: years-in-band is the weakest relevance signal and it was
  // carrying weight that title match earns.
  experience_match: 0.05,
} as const;

export const PENALTIES = {
  stuffing_per_excess: 0.5,
  stuffing_per_term_cap: 2.0,
  stuffing_cap: 8.0,
  repeated_figure_each: 1.5,
  repeated_figure_cap: 4.0,
  filler_each: 1.0,
  filler_cap: 5.0,
  total_cap: 15.0,
} as const;

/** Below this share of job relevance, prose quality stops earning full credit. */
export const QUALITY_GATE_FLOOR = 0.35;

/* ------------------------------------------------------------------ */
/* Where a term appears, and what that is worth                        */
/* ------------------------------------------------------------------ */
/*
  Coverage used to run over one flat string, so "Kubernetes" in the skills
  list counted exactly as much as "Kubernetes" in the job the candidate is
  doing right now. No recruiter reads those as the same claim, and the flat
  version rewards the cheapest edit on the page: append the missing terms to
  the skills list and the number goes up without the resume being any truer.

  Every term is now worth the most valuable place it appears. Two axes:
  evidenced (inside a bullet) versus claimed (a list), and how recent the
  evidence is. A term in the current role still earns 1.0, so a resume whose
  present job is the job being applied for can still reach 100.

  These constants are mirrored in backend/src/atsresume/pipeline/scoring_v2.py
  and the fixture check fails if the two disagree.
*/
export const ZONE_CURRENT_ROLE = 1.0;
export const ZONE_ROLE_DECAY: readonly number[] = [1.0, 0.85, 0.72, 0.62];
export const ZONE_ROLE_FLOOR = 0.6;
export const ZONE_PROJECT = 0.8;
export const ZONE_EDUCATION = 0.6;
export const ZONE_SUMMARY = 0.55;
export const ZONE_SKILLS = 0.5;
export const ZONE_OTHER = 0.55;

const PRESENT_RE = /\b(present|current|currently|now|ongoing|to date|till date|date)\b/i;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;

/** The ladder, as postings use it. No marker means mid. */
export const SENIORITY_BANDS: Readonly<Record<string, number>> = {
  intern: 0, internship: 0, trainee: 0, graduate: 0, fresher: 0,
  junior: 1, jr: 1, entry: 1, associate: 1,
  mid: 2, intermediate: 2,
  senior: 3, sr: 3,
  staff: 4, lead: 4, principal: 5, architect: 4, manager: 4,
  head: 5, director: 6, vp: 7, chief: 8, cto: 8, ceo: 8,
};
export const DEFAULT_BAND = 2;

export const UNDERQUALIFIED_PER_LEVEL = 20;
export const UNDERQUALIFIED_CAP = 55;
// Asymmetric on purpose: both directions get rejected, but a senior applying
// down is screened out for fit and salary, not for being unable to do it.
export const OVERQUALIFIED_PER_LEVEL = 10;
export const OVERQUALIFIED_CAP = 30;

export const TITLE_STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'at', 'with',
  'i', 'ii', 'iii', 'iv', 'v', '1', '2', '3', '4', '5',
  'engineer2', 'level', 'grade', 'band',
]);

/** The posting states no title often enough that 0 would lie and 100 would gift. */
export const TITLE_UNKNOWN = 70;

/* ------------------------------------------------------------------ */
/* Vocabularies                                                        */
/* ------------------------------------------------------------------ */

/*
  Compared against `firstWord`, which normalises, so these have to be stored
  normalised. "utilised" and "utilized" were not: normalise stems the ise/ize
  suffix so both become "utilis", and neither stored spelling ever matched.
  Two dead entries out of nine, for one of the most common words on a badly
  written resume and one the tailor prompt explicitly bans.
*/
export const BANNED_OPENERS: ReadonlySet<string> = new Set([
  'helped', 'assisted', 'participated', 'worked', 'responsible',
  'spearheaded', 'leveraged',
  // normalise('utilised') === normalise('utilized') === 'utilis'
  'utilis',
]);

export const FILLER_PHRASES: readonly string[] = [
  'team player', 'hard working', 'hardworking', 'detail oriented',
  'detail-oriented', 'self motivated', 'self-motivated', 'results driven',
  'results-driven', 'go getter', 'fast learner', 'quick learner',
  'passionate about', 'excellent communication', 'strong work ethic',
  'think outside the box', 'dynamic professional', 'proven track record',
  'highly motivated', 'good team player',
];

export const MECHANISM_TERMS: ReadonlySet<string> = new Set([
  'queue', 'index', 'indexes', 'indexing', 'cache', 'caching', 'replica',
  'replication', 'partition', 'partitioning', 'sharding', 'shard',
  'migration', 'migrations', 'retry', 'retries', 'backoff', 'webhook',
  'cron', 'worker', 'workers', 'pool', 'pooling', 'transaction',
  'transactions', 'idempotency', 'idempotent', 'pagination', 'paginated',
  'debounce', 'throttle', 'memoisation', 'memoization', 'lazy loading',
  'rate limit', 'rate limiting', 'circuit breaker', 'batching', 'batch',
  'streaming', 'backpressure', 'checkpoint', 'rollback', 'deadlock',
  'connection pool', 'read replica', 'materialised view',
  'materialized view', 'query plan', 'bulk insert', 'upsert', 'fan out',
  'pub sub', 'dead letter', 'bloom filter', 'lru', 'ttl', 'compaction',
  'prefetch', 'code splitting', 'tree shaking', 'virtualised list',
  'virtualized list', 'server side rendering', 'feature flag',
  'blue green', 'canary', 'autoscaling', 'load balancer', 'reverse proxy',
  'schema', 'foreign key', 'normalisation', 'denormalised', 'cursor',
  'polling', 'long polling', 'websocket', 'middleware', 'interceptor',
  'compression', 'quantisation', 'quantization', 'embedding',
  'vector search', 'chunking', 'tokenisation', 'tokenization',
]);

export const OUTCOME_MARKERS: readonly string[] = [
  'cutting', 'reducing', 'eliminating', 'removing', 'so that', 'which let',
  'which meant', 'enabling', 'allowing', 'preventing', 'unblocking',
  'shortening', 'freeing', 'halving', 'improving', 'speeding up',
  'avoiding', 'letting', 'making it possible', 'without needing',
  'instead of', 'down from', 'up from', 'ahead of', 'ending',
];

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

/** How many times a term appears as a whole word in normalised text. */
function countTerm(term: string, haystack: string): number {
  const needle = normalise(term);
  if (!needle) return 0;
  const re = new RegExp(`(?<![a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`, 'g');
  let n = 0;
  while (re.exec(haystack) !== null) n += 1;
  return n;
}

/**
 * Every experience and project bullet, in document order.
 *
 * Education, certifications and free-form sections are excluded on purpose.
 */
export function bulletTexts(tailored: TailoredResume): string[] {
  const out: string[] = [];
  for (const exp of tailored.experience) out.push(...exp.bullets.map((b) => b.text));
  for (const proj of tailored.projects) out.push(...proj.bullets.map((b) => b.text));
  return out;
}

function firstWord(text: string): string {
  const words = splitWords(normalise(text));
  return words[0] ?? '';
}

/** A concrete outcome: a figure, or a stated qualitative consequence. */
function hasOutcome(bullet: string): boolean {
  if (metrics(bullet).length > 0) return true;
  const hay = normalise(bullet);
  // Note the boundary here is `[a-z]`, not `[a-z0-9]` as elsewhere. Faithful
  // to the Python; do not "unify" it.
  return OUTCOME_MARKERS.some((m) =>
    new RegExp(`(?<![a-z])${escapeRegExp(m)}(?![a-z])`).test(hay),
  );
}

function hasMechanism(bullet: string): boolean {
  const hay = normalise(bullet);
  for (const term of MECHANISM_TERMS) {
    if (new RegExp(`(?<![a-z0-9])${escapeRegExp(term)}(?![a-z0-9])`).test(hay)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

export interface KeywordOutcomeV2 {
  matched: string[];
  missing: string[];
  counts: Record<string, number>;
  score: number;
  /** term -> the zone it earned its weight in. Empty under flat scoring. */
  placements: Record<string, string>;
}

/**
 * A region of the resume, and what a term found there is worth.
 *
 * `text` is normalised at construction, because `countTerm` normalises the
 * needle and assumes the haystack already is.
 */
export interface Zone {
  name: string;
  text: string;
  weight: number;
}

function isPresent(endDate: string): boolean {
  return PRESENT_RE.test(endDate ?? '');
}

function latestYear(text: string): number {
  const found = (text ?? '').match(YEAR_RE);
  return found ? Math.max(...found.map(Number)) : 0;
}

/**
 * Most recent role first.
 *
 * Resumes are conventionally reverse-chronological and the parser preserves
 * document order, so the original index is the tie-breaker rather than the
 * signal: a correctly ordered resume is unaffected, and one that is not gets
 * read correctly anyway.
 */
export function experienceInRecencyOrder(
  tailored: TailoredResume,
): TailoredResume['experience'] {
  return tailored.experience
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const ap = isPresent(a.entry.end_date) ? 1 : 0;
      const bp = isPresent(b.entry.end_date) ? 1 : 0;
      if (ap !== bp) return bp - ap;
      const ay = latestYear(a.entry.end_date);
      const by = latestYear(b.entry.end_date);
      if (ay !== by) return by - ay;
      return a.index - b.index;
    })
    .map((pair) => pair.entry);
}

function roleWeight(rank: number): number {
  return rank < ZONE_ROLE_DECAY.length ? ZONE_ROLE_DECAY[rank]! : ZONE_ROLE_FLOOR;
}

function zone(name: string, text: string, weight: number): Zone | null {
  const body = normalise(text);
  return body.trim() ? { name, text: body, weight } : null;
}

/**
 * The document, cut into regions worth different amounts.
 *
 * Bullets are separated from the headings around them deliberately: a company
 * name should not match a keyword at all, and a role title should not make
 * every term in that role look evidenced.
 */
export function keywordZones(tailored: TailoredResume): Zone[] {
  const out: Array<Zone | null> = [];

  out.push(zone('summary', `${tailored.headline} ${tailored.summary.text}`, ZONE_SUMMARY));

  experienceInRecencyOrder(tailored).forEach((exp, rank) => {
    const body = exp.bullets.map((b) => b.text).join(' ');
    out.push(zone(`experience[${rank}]`, `${exp.title} ${body}`, roleWeight(rank)));
  });

  for (const proj of tailored.projects) {
    const text = [proj.name, ...proj.bullets.map((b) => b.text)].join(' ');
    out.push(zone('project', text, ZONE_PROJECT));
  }

  const skills = tailored.skills
    .map((group) => [group.category, ...group.items].join(' '))
    .join(' ');
  out.push(zone('skills', skills, ZONE_SKILLS));

  const learned = [
    ...tailored.education.map((e) => `${e.institution} ${e.degree}`),
    ...tailored.certifications.map((c) => c.text),
  ].join(' ');
  out.push(zone('education', learned, ZONE_EDUCATION));

  const other = tailored.other_sections
    .map((sec) => [sec.heading, ...sec.bullets.map((b) => b.text)].join(' '))
    .join(' ');
  out.push(zone('other', other, ZONE_OTHER));

  return out.filter((z): z is Zone => z !== null);
}

/**
 * Weighted coverage that saturates at the first mention.
 *
 * With `zones`, a term earns the weight of the best place it appears rather
 * than a flat full mark. Saturation is unchanged: the maximum is taken across
 * zones, never a sum, so mentioning a term everywhere is worth exactly what
 * mentioning it in the best place is worth.
 */
export function scoreKeywordCoverage(
  job: JobSpec,
  resume: string,
  zones?: readonly Zone[],
): KeywordOutcomeV2 {
  if (job.keywords.length === 0) {
    return { matched: [], missing: [], counts: {}, score: 0, placements: {} };
  }

  const matched: string[] = [];
  const missing: string[] = [];
  const counts: Record<string, number> = {};
  const placements: Record<string, string> = {};
  let earned = 0;
  let possible = 0;

  for (const keyword of job.keywords) {
    const weight = Math.max(1, Math.min(5, keyword.weight || 1));
    possible += weight;
    const forms = [keyword.term, ...keyword.variants];
    const occurrences = forms.reduce((n, form) => n + countTerm(form, resume), 0);
    counts[keyword.term] = occurrences;

    if (!occurrences) {
      missing.push(keyword.term);
      continue;
    }

    matched.push(keyword.term);

    if (!zones) {
      earned += weight; // saturated: occurrences > 1 adds nothing
      continue;
    }

    let best = 0;
    let where = '';
    for (const z of zones) {
      if (forms.some((form) => countTerm(form, z.text))) {
        if (z.weight > best) {
          best = z.weight;
          where = z.name;
        }
      }
    }

    if (best === 0) {
      // In the flat text but in no zone: a company name, a date line. Treat
      // it as the weakest kind of claim rather than as absent.
      best = ZONE_SKILLS;
      where = 'unplaced';
    }

    earned += weight * best;
    placements[keyword.term] = where;
  }

  return {
    matched,
    missing,
    counts,
    score: possible ? (earned / possible) * 100 : 0,
    placements,
  };
}

/* ------------------------------------------------------------------ */
/* Title and seniority                                                 */
/* ------------------------------------------------------------------ */

function titleTokens(title: string): { role: Set<string>; band: number | null } {
  const words = normalise(title).split(/[^a-z0-9+#]+/).filter(Boolean);
  let band: number | null = null;
  const role: string[] = [];
  for (const word of words) {
    const level = SENIORITY_BANDS[word];
    if (level !== undefined) {
      // The highest marker wins: "senior engineering manager" is a manager.
      band = band === null ? level : Math.max(band, level);
      continue;
    }
    if (TITLE_STOPWORDS.has(word)) continue;
    role.push(word);
  }
  return { role: new Set(role), band };
}

/**
 * How close the candidate's current title is to the one being filled.
 *
 * Two parts, because they fail differently. Role overlap asks whether this is
 * the same kind of job; seniority distance asks whether it is the same rung.
 *
 * Recall against the posting, not symmetric overlap: a longer candidate title
 * is not worse for carrying extra words.
 */
export function scoreTitleMatch(job: JobSpec, tailored: TailoredResume): number {
  const target = titleTokens(job.title);
  if (target.role.size === 0) return TITLE_UNKNOWN;

  const order = experienceInRecencyOrder(tailored);
  const current = order.length > 0 ? order[0]!.title : '';
  const cand = titleTokens(current);
  const head = titleTokens(tailored.headline);

  const recall = (tokens: Set<string>): number => {
    if (tokens.size === 0) return 0;
    let hits = 0;
    for (const t of target.role) if (tokens.has(t)) hits += 1;
    return (hits / target.role.size) * 100;
  };

  // The headline is self-declared and rewritten by this very pipeline, so it
  // is worth slightly less than a title an employer actually gave.
  const overlap = Math.max(recall(cand.role), recall(head.role) * 0.9);

  const required = target.band === null ? DEFAULT_BAND : target.band;
  const held = cand.band === null ? DEFAULT_BAND : cand.band;
  const gap = held - required;

  let penalty = 0;
  if (gap < 0) penalty = Math.min(UNDERQUALIFIED_CAP, -gap * UNDERQUALIFIED_PER_LEVEL);
  else if (gap > 0) penalty = Math.min(OVERQUALIFIED_CAP, gap * OVERQUALIFIED_PER_LEVEL);

  return Math.max(0, Math.min(100, overlap - penalty));
}

/** Stated requirements, with a must-have worth twice a nice-to-have. */
export function scoreRequirementCoverage(job: JobSpec, resume: string): number {
  if (job.requirements.length === 0) return 0;
  let earned = 0;
  let possible = 0;
  for (const req of job.requirements) {
    const weight = req.importance === Importance.REQUIRED ? 2 : 1;
    possible += weight;
    if (covers(req.term, resume)) earned += weight;
  }
  return possible ? (earned / possible) * 100 : 0;
}

/** Share of experience and project bullets that state a concrete outcome. */
export function scoreEvidenceDensity(tailored: TailoredResume): number {
  const bullets = bulletTexts(tailored);
  if (bullets.length === 0) return 0;
  const hits = bullets.filter((b) => hasOutcome(b)).length;
  return (hits / bullets.length) * 100;
}

/** Share of bullets naming a mechanism rather than performing ceremony. */
export function scoreSpecificity(tailored: TailoredResume): number {
  const bullets = bulletTexts(tailored);
  if (bullets.length === 0) return 0;
  const hits = bullets.filter(
    (b) => hasMechanism(b) && !BANNED_OPENERS.has(firstWord(b)),
  ).length;
  return (hits / bullets.length) * 100;
}

/* ------------------------------------------------------------------ */
/* Penalties                                                           */
/* ------------------------------------------------------------------ */

export interface PenaltyDetail {
  stuffing: number;
  repeated_figures: number;
  filler: number;
  total: number;
  notes: string[];
}

/** A term said more than twice across the document is being stuffed. */
function stuffingPenalty(counts: Record<string, number>): [number, string[]] {
  let total = 0;
  const notes: string[] = [];
  for (const term of Object.keys(counts).sort()) {
    const count = counts[term] ?? 0;
    const excess = count - 2;
    if (excess <= 0) continue;
    const cost = Math.min(
      PENALTIES.stuffing_per_term_cap,
      excess * PENALTIES.stuffing_per_excess,
    );
    total += cost;
    notes.push(`'${term}' appears ${count} times`);
  }
  return [Math.min(PENALTIES.stuffing_cap, total), notes];
}

/** The same number attached to two different achievements. */
function repeatedFigurePenalty(bullets: readonly string[]): [number, string[]] {
  const seen = new Map<string, number>();
  for (const bullet of bullets) {
    const perBullet = new Set(metrics(bullet).map(digitsOf));
    for (const digits of perBullet) {
      if (digits) seen.set(digits, (seen.get(digits) ?? 0) + 1);
    }
  }
  const repeated = [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([d]) => d)
    .sort();
  const total = Math.min(
    PENALTIES.repeated_figure_cap,
    repeated.length * PENALTIES.repeated_figure_each,
  );
  const notes = repeated.map(
    (d) => `the figure ${d} appears on ${seen.get(d)} different bullets`,
  );
  return [total, notes];
}

function fillerPenalty(tailored: TailoredResume, resumeText: string): [number, string[]] {
  const notes: string[] = [];
  let count = 0;
  for (const bullet of bulletTexts(tailored)) {
    const opener = firstWord(bullet);
    if (BANNED_OPENERS.has(opener)) {
      count += 1;
      notes.push(`bullet opens with '${opener}'`);
    }
  }
  for (const phrase of FILLER_PHRASES) {
    // Plain substring containment, not whole-word. Faithful to the Python.
    if (resumeText.includes(normalise(phrase))) {
      count += 1;
      notes.push(`subjective filler: '${phrase}'`);
    }
  }
  return [Math.min(PENALTIES.filler_cap, count * PENALTIES.filler_each), notes];
}

export function computePenalties(
  tailored: TailoredResume,
  counts: Record<string, number>,
  resumeText: string,
): PenaltyDetail {
  const [stuffing, n1] = stuffingPenalty(counts);
  const [repeated, n2] = repeatedFigurePenalty(bulletTexts(tailored));
  const [filler, n3] = fillerPenalty(tailored, resumeText);
  const total = Math.min(PENALTIES.total_cap, stuffing + repeated + filler);
  return {
    stuffing,
    repeated_figures: repeated,
    filler,
    total,
    notes: [...n1, ...n2, ...n3],
  };
}

/* ------------------------------------------------------------------ */
/* Section hygiene — a checklist, not a score                          */
/* ------------------------------------------------------------------ */

/** Hygiene notes for the UI to render as a checklist. */
export function sectionWarnings(tailored: TailoredResume): string[] {
  const out: string[] = [];
  if (!tailored.summary.text.trim()) {
    out.push('No summary section. A recruiter reads this first.');
  }
  if (tailored.skills.length === 0) {
    out.push('No skills section. Keyword screens look here before anywhere else.');
  }
  if (tailored.experience.length === 0 && tailored.projects.length === 0) {
    out.push('No experience or projects section. There is nothing to screen.');
  }
  if (tailored.education.length === 0) {
    out.push('No education section. Many screens filter on a degree field.');
  }
  if (!tailored.headline.trim()) {
    out.push('No headline. The title line is what a title-match filter reads.');
  }
  const empty = tailored.experience.filter((e) => e.bullets.length === 0).map((e) => e.company);
  if (empty.length > 0) {
    out.push(`Experience entries with no bullets: ${empty.join(', ')}.`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Composite                                                           */
/* ------------------------------------------------------------------ */

/** Every number behind the overall score. Nothing here is rounded away. */
export interface ScoreBreakdownV2 {
  overall: number;
  keyword_coverage: number;
  requirement_coverage: number;
  title_match: number;
  evidence_density: number;
  specificity: number;
  experience_match: number;
  relevance: number;
  quality_gate: number;
  penalty: PenaltyDetail;
  matched_keywords: string[];
  missing_keywords: string[];
  recoverable_keywords: string[];
  keyword_counts: Record<string, number>;
  keyword_placements: Record<string, string>;
  warnings: string[];
}

/** `ScoreBreakdownV2.summary_line()`. */
export function summaryLine(b: ScoreBreakdownV2): string {
  return (
    `Breakdown — keywords ${fixed(b.keyword_coverage, 0)}, ` +
    `requirements ${fixed(b.requirement_coverage, 0)}, ` +
    `title ${fixed(b.title_match, 0)}, ` +
    `evidence ${fixed(b.evidence_density, 0)}, ` +
    `specificity ${fixed(b.specificity, 0)}, ` +
    `experience ${fixed(b.experience_match, 0)}; ` +
    `quality gate x${fixed(b.quality_gate, 2)}; ` +
    `penalties -${fixed(b.penalty.total, 1)} ` +
    `(stuffing ${fixed(b.penalty.stuffing, 1)}, ` +
    `repeated figures ${fixed(b.penalty.repeated_figures, 1)}, ` +
    `filler ${fixed(b.penalty.filler, 1)}).`
  );
}

/**
 * Python's `f"{x:.Nf}"`, which rounds half-to-even on the exact double, where
 * `toFixed` rounds half away from zero. Route through pyRound first.
 */
function fixed(value: number, digits: number): string {
  return pyRound(value, digits).toFixed(digits);
}

/** `%g`-style formatting, as used in the experience recommendation. */
function generalFormat(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(parseFloat(value.toPrecision(6)));
}

export function computeBreakdown(
  job: JobSpec,
  facts: ResumeFacts,
  tailored: TailoredResume,
): ScoreBreakdownV2 {
  const tailoredText = resumeTextOf(tailored);
  const originalText = factsTextOf(facts);

  const zones = keywordZones(tailored);
  const keywords = scoreKeywordCoverage(job, tailoredText, zones);
  const requirements = scoreRequirementCoverage(job, tailoredText);
  const title = scoreTitleMatch(job, tailored);
  const evidence = scoreEvidenceDensity(tailored);
  const specificity = scoreSpecificity(tailored);
  const experience = scoreExperienceMatch(job, facts);

  // How much of this posting the document actually speaks to, 0-100.
  // Title match belongs here: a document for a different kind of job is not
  // relevant to this one however many of its nouns happen to overlap.
  const relevanceWeight =
    WEIGHTS.keyword_coverage + WEIGHTS.requirement_coverage + WEIGHTS.title_match;
  const relevance =
    (keywords.score * WEIGHTS.keyword_coverage +
      requirements * WEIGHTS.requirement_coverage +
      title * WEIGHTS.title_match) /
    relevanceWeight;

  const gate = QUALITY_GATE_FLOOR + (1 - QUALITY_GATE_FLOOR) * (relevance / 100);

  const raw =
    keywords.score * WEIGHTS.keyword_coverage +
    requirements * WEIGHTS.requirement_coverage +
    title * WEIGHTS.title_match +
    (evidence * WEIGHTS.evidence_density + specificity * WEIGHTS.specificity) * gate +
    experience * WEIGHTS.experience_match;

  const penalty = computePenalties(tailored, keywords.counts, tailoredText);
  const overall = Math.max(0, Math.min(100, raw - penalty.total));

  const recoverable = keywords.missing.filter(
    (term) =>
      contains(term, originalText) ||
      job.keywords.some(
        (kw) => kw.term === term && kw.variants.some((v) => contains(v, originalText)),
      ),
  );
  const recoverableSet = new Set(recoverable);
  const trulyMissing = keywords.missing.filter((t) => !recoverableSet.has(t));

  return {
    overall: pyRound(overall, 1),
    keyword_coverage: pyRound(keywords.score, 1),
    requirement_coverage: pyRound(requirements, 1),
    title_match: pyRound(title, 1),
    evidence_density: pyRound(evidence, 1),
    specificity: pyRound(specificity, 1),
    experience_match: pyRound(experience, 1),
    relevance: pyRound(relevance, 1),
    quality_gate: pyRound(gate, 3),
    penalty,
    matched_keywords: keywords.matched,
    missing_keywords: trulyMissing,
    recoverable_keywords: recoverable,
    keyword_counts: keywords.counts,
    keyword_placements: keywords.placements,
    warnings: sectionWarnings(tailored),
  };
}

export function computeAtsReport(
  job: JobSpec,
  facts: ResumeFacts,
  tailored: TailoredResume,
): AtsReport {
  const b = computeBreakdown(job, facts, tailored);
  return {
    overall: b.overall,
    sub_scores: {
      keyword_match: b.keyword_coverage,
      skills_coverage: b.requirement_coverage,
      // Not weighted any more. Reported as 100 because it always was on a
      // document this pipeline produces; sectionWarnings() is where a
      // genuinely missing section now surfaces.
      section_completeness: 100,
      experience_match: b.experience_match,
      title_match: b.title_match,
      evidence_density: b.evidence_density,
      specificity: b.specificity,
      relevance_gate: b.quality_gate,
      penalty: b.penalty.total,
    },
    matched_keywords: b.matched_keywords,
    missing_keywords: b.missing_keywords,
    recoverable_keywords: b.recoverable_keywords,
    recommendations: recommendations(b, job, facts),
  };
}

/**
 * Zones that are a claim rather than evidence. A term sitting only in one of
 * these is the cheapest real improvement available: already true, already on
 * the page, and needing only to be attached to something that happened.
 */
export const CLAIM_ZONES: ReadonlySet<string> = new Set([
  'skills', 'summary', 'education', 'other', 'unplaced',
]);

/** Matched terms that never appear in a bullet. */
export function strandedTerms(b: ScoreBreakdownV2): string[] {
  return Object.entries(b.keyword_placements)
    .filter(([, where]) => CLAIM_ZONES.has(where))
    .map(([term]) => term)
    .sort();
}

function recommendations(
  b: ScoreBreakdownV2,
  job: JobSpec,
  facts: ResumeFacts,
): string[] {
  const out: string[] = [summaryLine(b)];

  if (b.recoverable_keywords.length > 0) {
    out.push(
      'Put these back — your original resume already claims them, the tailored version ' +
        `dropped them: ${b.recoverable_keywords.slice(0, 6).join(', ')}.`,
    );
  }
  if (b.keyword_coverage < 60 && b.missing_keywords.length > 0) {
    out.push(
      'Keyword coverage is low. These cannot be added truthfully, so treat them as a ' +
        `skills gap rather than an editing task: ${b.missing_keywords.slice(0, 6).join(', ')}.`,
    );
  }
  const stranded = strandedTerms(b);
  if (stranded.length > 0) {
    out.push(
      'These are on the page but only as a claim — they appear in a list or the ' +
        'summary, never in a bullet describing work: ' +
        `${stranded.slice(0, 6).join(', ')}. Moving one into the experience it ` +
        'actually belongs to is worth more than adding a new term anywhere.',
    );
  }
  if (b.title_match < 55) {
    out.push(
      `Your most recent title reads a long way from "${job.title}". That is the ` +
        'first line a screener compares and the most common reason a relevant ' +
        'resume is passed over. If the work genuinely matches, say so in the ' +
        'headline; if it does not, this posting is a stretch and worth weighing ' +
        'against a closer one.',
    );
  }
  if (b.requirement_coverage < 60) {
    const required = job.requirements
      .filter((r) => r.importance === Importance.REQUIRED)
      .map((r) => r.term);
    out.push(
      'Several stated must-haves are unmet' +
        (required.length > 0 ? ` (${required.slice(0, 5).join(', ')})` : '') +
        '. A recruiter screens on these first.',
    );
  }
  if (b.evidence_density < 60) {
    out.push(
      'Most bullets describe duties rather than results. Each one should end in what ' +
        'changed — a figure where the original resume has one, a stated consequence where ' +
        'it does not.',
    );
  }
  if (b.specificity < 50) {
    out.push(
      'The bullets say what was done but not how it worked. Name the mechanism — the ' +
        'index, the queue, the cache, the retry — because that is what a senior reader ' +
        'screens on and no keyword filter can fake it.',
    );
  }
  if (b.experience_match < 70) {
    const wanted =
      job.experience_years.raw || `${generalFormat(job.experience_years.min)}+ years`;
    out.push(
      `The posting asks for ${wanted} and the resume shows about ` +
        `${generalFormat(facts.total_years_experience)}. Lead with depth and shipped outcomes rather ` +
        'than tenure.',
    );
  }
  if (b.penalty.total > 0) {
    out.push(
      `Lost ${fixed(b.penalty.total, 1)} points to padding: ${b.penalty.notes.slice(0, 4).join('; ')}.`,
    );
  }
  out.push(...b.warnings);
  if (out.length === 1) {
    out.push('No mechanical gaps found. The remaining leverage is in the writing.');
  }
  return out;
}

export * from './text';
export { metrics, digitsOf } from './metrics';
export { pyRound } from '../util/py-round';
