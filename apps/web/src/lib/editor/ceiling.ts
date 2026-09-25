/**
 * How high this resume can honestly go against this posting.
 *
 * A bare score is unanchored. "43 out of 100" invites the question "out of
 * what population", and there is no population: the number is an internal
 * measurement, not a percentile against other applicants. Reported alone it
 * is either ignored or over-read, and neither is useful.
 *
 * A ceiling anchors it without needing a reference distribution at all:
 *
 *     You are at 43. The most this resume can honestly reach here is 61.
 *
 * That is two numbers a person can act on. A wide gap is a work list. A
 * narrow gap on a low score is the honest signal to apply somewhere else,
 * and it is a better answer than a model's opinion because it is arithmetic
 * over the same scorer that produced the 43.
 *
 * WHAT COUNTS AS HONEST
 *
 * Only edits that make no new claim:
 *
 *   recoverable   the term is in the parsed resume and the rewrite dropped
 *                 it. Putting it back is restoration, and it stays traced.
 *   stranded      the term is on the page but only in a list or the summary.
 *                 Moving it into the bullet it belongs to is re-placement.
 *
 * Terms that are simply absent are NOT in the ceiling. Adding one is the
 * user's own assertion, and a ceiling that counted assertions would be a
 * promise that the product cannot keep. That is the seam with attested
 * facts: attesting one moves it out of "missing" and the ceiling rises,
 * which is the honest way for that number to go up.
 *
 * Cumulative, not a sum of deltas. The scorer saturates - the second mention
 * of a term earns nothing - and the quality gate scales prose credit by
 * relevance, so adding two terms is worth less than the two deltas added
 * together. Each step is applied to the document the last step produced.
 */

import { computeAtsReport, type AtsReport, type GapAnalysis, type JobSpec, type ResumeFacts } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import type { Op } from "@ats/core";
import { applyDocPatch, tailoredOf } from "./doc";
import { suggestionsFor, type Suggestion } from "./gaps";

export type CeilingStep = {
  term: string;
  /** What the run did with it, for the work list. */
  label: string;
  /** The score after this step, so the list reads as a climb. */
  after: number;
  /** What this step was worth in place, after everything before it. */
  gained: number;
  traced: boolean;
};

export type Ceiling = {
  current: number;
  /** Where honest edits alone would land. Never below `current`. */
  ceiling: number;
  /** ceiling - current, rounded once. */
  headroom: number;
  steps: CeilingStep[];
  /**
   * Terms with no line behind them at all, in the document or the ledger.
   * These are what attesting unlocks: once the user says where they used
   * one, it becomes a fact, gains a bullet placement, and the ceiling
   * rises by however much that is actually worth.
   */
  blockedByEvidence: string[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Placements the ceiling is allowed to count.
 *
 * A bullet placement, and only a bullet placement. A bullet exists here
 * only when there is a fact in the ledger carrying that term, which is
 * either a line the parser read out of the uploaded file or one the user
 * attested to deliberately - naming the role and writing the sentence.
 * Both are statements somebody is prepared to stand behind at interview.
 *
 * The skills-list placement is excluded even though it scores. Adding a
 * word to a list is one click and no thought, and a ceiling that counted
 * those would be measuring how many buttons exist rather than how good
 * this application can get.
 *
 * Attested bullets are counted and NOT marked traced, which is the point:
 * they raise what the document can honestly claim while the provenance
 * line goes on reporting that the uploaded file does not say it.
 */
function honestPlacement(suggestion: Suggestion) {
  return suggestion.placements.find((p) => p.kind === "bullet") ?? null;
}

export function ceilingFor(
  job: JobSpec | null,
  facts: ResumeFacts,
  doc: ResumeDoc,
  report: AtsReport | null,
  gaps?: GapAnalysis | null,
): Ceiling | null {
  if (!job || !report) return null;

  const current = round1(report.overall);
  let working = doc;
  let running = report.overall;
  const steps: CeilingStep[] = [];

  /*
    Re-derived after every step rather than computed once. Restoring a bullet
    can carry several terms at once, so the suggestion list shrinks by more
    than one entry per step, and a list captured up front would offer edits
    that no longer do anything.
  */
  for (let guard = 0; guard < 40; guard += 1) {
    const live = computeAtsReport(job, facts, tailoredOf(working));
    const suggestions = suggestionsFor(job, facts, working, live, gaps);

    let best: {
      suggestion: Suggestion;
      ops: readonly Op[];
      label: string;
      gain: number;
      traced: boolean;
    } | null = null;

    for (const suggestion of suggestions) {
      const placement = honestPlacement(suggestion);
      if (!placement || placement.delta === null || placement.delta <= 0) continue;
      if (!best || placement.delta > best.gain) {
        best = {
          suggestion,
          ops: placement.ops,
          label: placement.label,
          gain: placement.delta,
          traced: placement.traced,
        };
      }
    }

    if (!best) break;

    let next: ResumeDoc;
    try {
      next = applyDocPatch(working, best.ops);
    } catch {
      break;
    }

    const after = computeAtsReport(job, facts, tailoredOf(next)).overall;
    // A step that does not move the number is not a step.
    if (after <= running + 0.05) break;

    steps.push({
      term: best.suggestion.term,
      label: best.label,
      after: round1(after),
      gained: round1(after - running),
      traced: best.traced,
    });
    working = next;
    running = after;
  }

  const blockedByEvidence = suggestionsFor(job, facts, working, report, gaps)
    .filter((s) => s.kind === "missing")
    .map((s) => s.term);

  const ceiling = round1(Math.max(running, report.overall));

  return {
    current,
    ceiling,
    headroom: round1(ceiling - current),
    steps,
    blockedByEvidence,
  };
}
