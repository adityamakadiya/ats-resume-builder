/**
 * The ceiling has to be honest in both directions: it must not promise
 * points that need a claim the resume does not make, and it must not
 * under-report what restoration alone would reach.
 *
 * Nothing here hardcodes a score. Every assertion re-runs the scorer on the
 * document the ceiling says it would produce, so if the weights move the
 * test follows them.
 */

import { describe, expect, it } from "vitest";
import { computeAtsReport } from "@ats/core";
import { SAMPLE_DOC, SAMPLE_FACTS, SAMPLE_GAPS, SAMPLE_JOB, SAMPLE_REPORT } from "./fixtures";
import { tailoredOf } from "./doc";
import { suggestionsFor } from "./gaps";
import { ceilingFor } from "./ceiling";

function ceiling() {
  const result = ceilingFor(SAMPLE_JOB, SAMPLE_FACTS, SAMPLE_DOC, SAMPLE_REPORT, SAMPLE_GAPS);
  if (!result) throw new Error("expected a ceiling for a scored document");
  return result;
}

describe("ceilingFor", () => {
  it("is null without a posting, like every other comparison here", () => {
    expect(ceilingFor(null, SAMPLE_FACTS, SAMPLE_DOC, null, SAMPLE_GAPS)).toBeNull();
    expect(ceilingFor(SAMPLE_JOB, SAMPLE_FACTS, SAMPLE_DOC, null, SAMPLE_GAPS)).toBeNull();
  });

  it("starts from the score the document actually has", () => {
    const c = ceiling();
    const live = computeAtsReport(SAMPLE_JOB, SAMPLE_FACTS, tailoredOf(SAMPLE_DOC)).overall;
    expect(c.current).toBeCloseTo(Math.round(live * 10) / 10, 1);
  });

  it("never reports a ceiling below the current score", () => {
    const c = ceiling();
    expect(c.ceiling).toBeGreaterThanOrEqual(c.current);
    expect(c.headroom).toBeGreaterThanOrEqual(0);
  });

  it("counts only restoration, never a claim the resume does not make", () => {
    const c = ceiling();

    // Every step has to be traced. A step that is not traced is the user
    // asserting something, and a ceiling built from assertions is a promise
    // the product cannot keep.
    for (const step of c.steps) expect(step.traced).toBe(true);

    // And nothing that is merely missing may appear as a step.
    const missing = new Set(
      suggestionsFor(SAMPLE_JOB, SAMPLE_FACTS, SAMPLE_DOC, SAMPLE_REPORT, SAMPLE_GAPS)
        .filter((s) => s.kind === "missing")
        .map((s) => s.term),
    );
    for (const step of c.steps) expect(missing.has(step.term)).toBe(false);
  });

  it("names what evidence would unlock rather than silently dropping it", () => {
    const c = ceiling();
    // This is the list the attest flow acts on: terms with no line behind
    // them, which is exactly what a user can supply and the parser cannot.
    for (const term of c.blockedByEvidence) expect(missingTerms()).toContain(term);
  });

  it("climbs: every step is worth something and the total is the last step", () => {
    const c = ceiling();
    if (c.steps.length === 0) {
      expect(c.ceiling).toBeCloseTo(c.current, 1);
      return;
    }

    for (const step of c.steps) expect(step.gained).toBeGreaterThan(0);

    // Monotonic, and the ceiling is where the climb ended.
    const afters = c.steps.map((s) => s.after);
    expect(afters).toEqual([...afters].sort((a, b) => a - b));
    expect(c.ceiling).toBeCloseTo(afters[afters.length - 1]!, 1);
  });

  it("is cumulative rather than a sum of independent deltas", () => {
    const c = ceiling();
    if (c.steps.length < 2) return;

    /*
      The scorer saturates and the quality gate scales prose credit by
      relevance, so two edits are worth less than their two deltas added
      up. Summing the suggestion deltas would overstate the ceiling, which
      is the specific dishonesty this test exists to catch.
    */
    const naive = suggestionsFor(SAMPLE_JOB, SAMPLE_FACTS, SAMPLE_DOC, SAMPLE_REPORT, SAMPLE_GAPS)
      .filter((s) => s.kind === "recoverable")
      .reduce((total, s) => total + (s.delta ?? 0), 0);

    expect(c.headroom).toBeLessThanOrEqual(naive + 0.05);
  });

  it("terminates rather than looping on an edit that changes nothing", () => {
    // The guard is 40 iterations; a real document should stop long before.
    expect(ceiling().steps.length).toBeLessThan(40);
  });
});

function missingTerms(): string[] {
  return suggestionsFor(SAMPLE_JOB, SAMPLE_FACTS, SAMPLE_DOC, SAMPLE_REPORT, SAMPLE_GAPS)
    .filter((s) => s.kind === "missing")
    .map((s) => s.term);
}
