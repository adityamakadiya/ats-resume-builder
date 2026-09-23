/**
 * Port of the shared helpers in `backend/src/atsresume/pipeline/scoring.py`.
 *
 * scoring_v2 imports `_contains`, `_covers`, `resume_text_of`, `facts_text_of`
 * and `score_experience_match` from there, so they are part of the algorithm
 * under test, not incidental plumbing. `_stem` and `_STOPWORDS` come with them.
 */

import { canonical, escapeRegExp, normalise } from '../vocabulary/index';
import type { JobSpec, ResumeFacts, TailoredResume } from '../schema/index';

/**
 * Whole-word containment.
 *
 * Substring matching is the classic bug here: without boundaries "R" matches
 * "React", "Go" matches "Google", and "C" matches almost everything.
 *
 * The boundaries are the same lookaround pair Python uses, not `\b` — see the
 * regex notes in `vocabulary/index.ts`.
 */
export function contains(term: string, haystack: string): boolean {
  const needle = normalise(term);
  if (!needle) return false;
  return new RegExp(`(?<![a-z0-9])${escapeRegExp(needle)}(?![a-z0-9])`).test(haystack);
}

/** Words that carry no matching signal in a requirement phrase. */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'and', 'or', 'the', 'a', 'an', 'of', 'for', 'with', 'in', 'on', 'to', 'by',
  'using', 'used', 'strong', 'solid', 'hands', 'experience', 'knowledge',
  'working', 'good', 'excellent', 'proven', 'including', 'such', 'as', 'etc',
  'ability', 'understanding', 'familiarity', 'exposure', 'plus', 'must', 'have',
]);

const SUFFIXES = ['ations', 'ation', 'ingly', 'ings', 'ing', 'ies', 'ied', 'ed', 'es', 's'] as const;

/** Crude suffix stripping, enough to tie 'indexes' to 'indexing'. */
export function stem(word: string): string {
  for (const suffix of SUFFIXES) {
    if (word.length - suffix.length >= 4 && word.endsWith(suffix)) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

const COVERAGE_THRESHOLD = 2 / 3;

/**
 * Whether the resume covers a requirement, which is often a whole sentence.
 *
 * Single-word requirements keep the strict whole-word rule. Multi-word ones are
 * scored on how much of their content they find.
 */
export function covers(term: string, haystack: string): boolean {
  if (contains(term, haystack)) return true;

  const tokens = splitWords(normalise(term)).filter(
    (t) => t.length > 2 && !STOPWORDS.has(t),
  );
  if (tokens.length < 2) return false;

  const hayStems = new Set(splitWords(haystack).map((w) => stem(canonical(w))));
  let hits = 0;
  for (const token of tokens) {
    if (hayStems.has(stem(canonical(token))) || contains(token, haystack)) hits += 1;
  }
  return hits / tokens.length >= COVERAGE_THRESHOLD;
}

/**
 * Python's bare `str.split()`: split on runs of whitespace and drop the empty
 * strings at either end. `"".split()` is `[]`, where JS `"".split(" ")` is
 * `[""]`, and that difference silently adds a phantom token.
 */
export function splitWords(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/);
}

/** Everything in the tailored document that a keyword screen would read. */
export function resumeTextOf(tailored: TailoredResume): string {
  const parts: string[] = [tailored.headline, tailored.summary.text];
  for (const group of tailored.skills) {
    parts.push(group.category);
    parts.push(...group.items);
  }
  for (const exp of tailored.experience) {
    parts.push(exp.title, exp.company, exp.location);
    parts.push(...exp.bullets.map((b) => b.text));
  }
  for (const proj of tailored.projects) {
    parts.push(proj.name);
    parts.push(...proj.bullets.map((b) => b.text));
  }
  for (const edu of tailored.education) {
    parts.push(edu.degree, edu.institution);
  }
  parts.push(...tailored.certifications.map((c) => c.text));
  for (const section of tailored.other_sections) {
    parts.push(section.heading);
    parts.push(...section.bullets.map((b) => b.text));
  }
  return normalise(parts.filter((p) => p).join(' \n '));
}

/** The same, for the original facts. */
export function factsTextOf(facts: ResumeFacts): string {
  const parts: string[] = [facts.headline, facts.summary];
  for (const exp of facts.experience) {
    parts.push(exp.company, exp.title, ...exp.tech);
    parts.push(...exp.bullets.map((b) => b.text));
  }
  for (const proj of facts.projects) {
    parts.push(proj.name, proj.description, ...proj.tech);
    parts.push(...proj.bullets.map((b) => b.text));
  }
  for (const group of facts.skills) {
    parts.push(group.category);
    parts.push(...group.items);
  }
  for (const edu of facts.education) {
    parts.push(edu.institution, edu.degree, edu.details);
  }
  parts.push(...facts.certifications.map((c) => c.text));
  for (const section of facts.other_sections) {
    parts.push(section.heading);
    parts.push(...section.bullets.map((b) => b.text));
  }
  return normalise(parts.filter((p) => p).join(' \n '));
}

/**
 * How the candidate's years read against the band the JD asked for.
 *
 * `job.experience_years.min or 0.0` in Python treats 0.0 as falsy, which `||`
 * reproduces here. Do not swap it for `??`.
 */
export function scoreExperienceMatch(job: JobSpec, facts: ResumeFacts): number {
  const wantedMin = job.experience_years.min || 0;
  const years = facts.total_years_experience || 0;

  if (wantedMin <= 0) return 75;
  if (years <= 0) return 50;

  if (years >= wantedMin) {
    const wantedMax = job.experience_years.max || 0;
    if (wantedMax && years > wantedMax + 3) return 80;
    return 100;
  }

  const shortfall = (wantedMin - years) / wantedMin;
  return Math.max(0, 100 * (1 - shortfall));
}
