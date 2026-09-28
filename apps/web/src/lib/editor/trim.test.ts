/**
 * A cut list is only worth reading if the number beside each line is the
 * real one, so nothing here hardcodes a score. Every cost assertion applies
 * the cut's own ops to a copy of the document and re-runs `computeAtsReport`,
 * the way ceiling.test.ts and gaps.test.ts do. If the weights move, these
 * follow them; if trim.ts ever starts estimating, they fail.
 *
 * The recency claim in the module header is checked rather than asserted:
 * the same sentence is planted in the newest role and in the oldest, and the
 * test insists the newest one costs more to lose.
 */

import { describe, expect, it } from "vitest";
import { computeAtsReport } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import { SAMPLE_DOC, SAMPLE_FACTS, SAMPLE_JOB, SAMPLE_REPORT } from "./fixtures";
import { applyDocPatch, tailoredOf, validateDocOps } from "./doc";
import { writingIssues } from "./writing";
import { cutsFor, type Cut } from "./trim";

function cuts(doc: ResumeDoc = SAMPLE_DOC): Cut[] {
  const report = computeAtsReport(SAMPLE_JOB, SAMPLE_FACTS, tailoredOf(doc));
  return cutsFor(SAMPLE_JOB, SAMPLE_FACTS, doc, report);
}

function scoreOf(doc: ResumeDoc): number {
  return computeAtsReport(SAMPLE_JOB, SAMPLE_FACTS, tailoredOf(doc)).overall;
}

/** The same document with one extra bullet on the role at `roleIndex`. */
function withBullet(roleIndex: number, text: string): ResumeDoc {
  return {
    ...SAMPLE_DOC,
    experience: SAMPLE_DOC.experience.map((exp, i) =>
      i === roleIndex
        ? { ...exp, bullets: [...exp.bullets, { text, source_ids: ["E9.B9"], keywords: [] }] }
        : exp,
    ),
  };
}

function costOfLastBulletIn(roleIndex: number, text: string): number {
  const doc = withBullet(roleIndex, text);
  const path = `/experience/${roleIndex}/bullets/${doc.experience[roleIndex]!.bullets.length - 1}`;
  const cut = cuts(doc).find((c) => c.path === path);
  if (!cut) throw new Error(`expected a cut offered for ${path}`);
  return cut.cost;
}

describe("cutsFor", () => {
  it("offers nothing without a posting, because an unpriced ranking is a guess", () => {
    expect(cutsFor(null, SAMPLE_FACTS, SAMPLE_DOC, SAMPLE_REPORT)).toEqual([]);
    expect(cutsFor(SAMPLE_JOB, SAMPLE_FACTS, SAMPLE_DOC, null)).toEqual([]);
  });

  it("finds something to cut on a document that has spare lines in it", () => {
    expect(cuts().length).toBeGreaterThan(0);
  });

  it("prices every cut by rescoring, never by a rule of thumb", () => {
    const base = scoreOf(SAMPLE_DOC);

    for (const cut of cuts()) {
      const after = scoreOf(applyDocPatch(SAMPLE_DOC, cut.ops));
      // Cost is what the removal takes off the number, rounded once.
      expect(cut.cost).toBeCloseTo(Math.round((base - after) * 10) / 10, 1);
    }
  });

  it("ranks cheapest first, so the top row is the line worth least", () => {
    const costs = cuts().map((c) => c.cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  it("breaks a tie on space, so equal-cost rows put the roomiest first", () => {
    const list = cuts();
    for (let i = 1; i < list.length; i += 1) {
      const prev = list[i - 1]!;
      const here = list[i]!;
      if (prev.cost !== here.cost) continue;
      expect(prev.lines).toBeGreaterThanOrEqual(here.lines);
    }
  });

  it("offers a cut that costs nothing at all, which is the whole point", () => {
    // A document this size always has a line the scorer is indifferent to.
    // If this ever fails, the list has stopped being useful before it has
    // stopped being correct.
    expect(cuts().some((c) => c.cost <= 0)).toBe(true);
  });

  it("never offers the contact details, education, the summary or a whole role", () => {
    for (const cut of cuts()) {
      expect(cut.path.startsWith("/contact")).toBe(false);
      expect(cut.path.startsWith("/education")).toBe(false);
      expect(cut.path.startsWith("/summary")).toBe(false);
      expect(cut.path.startsWith("/headline")).toBe(false);
      expect(cut.path.startsWith("/skills")).toBe(false);
      // Deleting a job leaves a gap in the timeline, and the patch guard
      // refuses it anyway. Offering it would be a button that always errors.
      expect(/^\/experience\/\d+$/.test(cut.path)).toBe(false);
    }
  });

  it("leaves the current role two bullets and every older role one", () => {
    const thin: ResumeDoc = {
      ...SAMPLE_DOC,
      experience: SAMPLE_DOC.experience.map((exp, i) => ({
        ...exp,
        bullets: exp.bullets.slice(0, i === 0 ? 2 : 1),
      })),
    };

    // Nothing from any role: the newest is at its floor of two, the rest at
    // their floor of one. A heading with nothing under it is worse than the
    // overflow it fixes.
    for (const cut of cuts(thin)) expect(cut.path.startsWith("/experience/")).toBe(false);

    // One more bullet on the newest role and it becomes cuttable again.
    const fatter = withBullet(0, "Shipped the reconciliation dashboard the finance team now closes the month on.");
    expect(cuts(fatter).some((c) => c.path.startsWith("/experience/0/"))).toBe(true);
  });

  it("costs an old bullet less than the same sentence in the newest role", () => {
    /*
      The recency ordering is claimed to fall out of the scorer's zone decay
      rather than from a rule in trim.ts. This is the check. One sentence,
      carrying a term the rest of the document never mentions, planted in
      the current role and then in the oldest one. Same words, same length,
      same prose quality, so the only thing left to move the number is the
      zone weight the scorer gives the role it sits in.
    */
    const line = "Rewrote the settlement core in Rust, cutting per-transaction CPU time by 40 percent.";
    const oldest = SAMPLE_DOC.experience.length - 1;

    const newest = costOfLastBulletIn(0, line);
    const older = costOfLastBulletIn(oldest, line);

    expect(newest).toBeGreaterThan(older);
    // And neither is free, because nothing else on the page claims Rust.
    expect(older).toBeGreaterThan(0);
  });

  it("offers a shorten instead of a deletion on a bullet that is only too long", () => {
    const long =
      "Owned the settlement and reconciliation path end to end across four teams, " +
      "running the weekly review, writing the runbooks, carrying the pager for it, " +
      "and rebuilding the retry ladder so a failed batch replays without operator " +
      "involvement and without double paying anybody.";
    const doc = withBullet(1, long);
    const path = `/experience/1/bullets/${doc.experience[1]!.bullets.length - 1}`;

    // The writing rules and the cut list have to agree about which line it is.
    expect(writingIssues(doc).some((i) => i.code === "too-long" && i.path === `${path}/text`)).toBe(
      true,
    );

    const cut = cuts(doc).find((c) => c.path === path);
    expect(cut?.shorten).toBeTruthy();
    expect(cut!.shorten!.lines).toBeGreaterThan(0);
    // Shortening frees less than deleting, and the row must not pretend
    // otherwise or people will take the destructive option for nothing.
    expect(cut!.shorten!.lines).toBeLessThan(cut!.lines);
  });

  it("leaves short bullets alone rather than suggesting a rewrite of them", () => {
    for (const cut of cuts()) {
      if (cut.text.length <= 240) expect(cut.shorten).toBeNull();
    }
  });

  it("never offers an edit that the patch guard would refuse", () => {
    // A row whose button always errors is worse than no row: the user reads
    // the cheapest cut on the page and cannot take it.
    for (const cut of cuts()) {
      expect(validateDocOps(SAMPLE_DOC, cut.ops).ok).toBe(true);
      expect(() => applyDocPatch(SAMPLE_DOC, cut.ops)).not.toThrow();
    }
  });

  it("frees at least one line per offer and says so in whole lines", () => {
    for (const cut of cuts()) {
      expect(cut.lines).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(cut.lines)).toBe(true);
    }
  });

  it("is stable: the same document twice gives the same order", () => {
    expect(cuts().map((c) => c.path)).toEqual(cuts().map((c) => c.path));
  });
});
