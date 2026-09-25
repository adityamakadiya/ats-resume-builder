/**
 * The detector has to agree with the scorer, because a suggestion the score
 * then ignores is worse than none: the user does the work and watches the
 * number stay still.
 *
 * So these tests check the rules against the same vocabularies the scorer
 * reads, and check the two things that make a suggestion list usable rather
 * than noisy: one card per line, and nothing flagged that the user cannot
 * act on.
 */

import { describe, expect, it } from "vitest";
import { BANNED_OPENERS } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import { SAMPLE_DOC } from "./fixtures";
import { groupByLine, writingIssues, type IssueCode } from "./writing";

function docWith(bullets: string[], summary = "Backend engineer. Built things. Looking for work."): ResumeDoc {
  return {
    ...SAMPLE_DOC,
    summary: { text: summary, source_ids: [] },
    projects: [],
    experience: [
      {
        ...SAMPLE_DOC.experience[0]!,
        bullets: bullets.map((text) => ({ text, source_ids: [], keywords: [] })),
      },
    ],
  };
}

function codesFor(doc: ResumeDoc): IssueCode[] {
  return writingIssues(doc).map((i) => i.code);
}

describe("weak openers", () => {
  it.each([...BANNED_OPENERS])("flags a bullet opening with %s", (opener) => {
    const doc = docWith([
      `${opener} the reconciliation pipeline with a queue, cutting the window to minutes.`,
    ]);
    expect(codesFor(doc)).toContain("weak-opener");
  });

  it("leaves a bullet that opens on the work alone", () => {
    const doc = docWith([
      "Rebuilt the reconciliation pipeline around a Kafka queue, cutting close-of-day from six hours to twenty minutes.",
    ]);
    expect(codesFor(doc)).not.toContain("weak-opener");
  });
});

describe("outcome and mechanism", () => {
  it("flags a duty with neither", () => {
    const codes = codesFor(docWith(["Attended daily standups and sprint planning sessions."]));
    expect(codes).toContain("no-outcome");
    expect(codes).toContain("no-mechanism");
  });

  it("accepts a figure as an outcome", () => {
    const codes = codesFor(
      docWith(["Reindexed the ledger table, dropping p99 read latency from 840ms to 96ms."]),
    );
    expect(codes).not.toContain("no-outcome");
  });

  it("accepts a stated consequence when the resume has no number", () => {
    /*
      The tailor prompt explicitly tells the model to write a qualitative
      outcome where the source has no figure. Flagging that would punish it
      for following its own instructions and push it towards inventing one.
    */
    const codes = codesFor(
      docWith(["Introduced idempotency keys across the payments API, eliminating duplicate charges."]),
    );
    expect(codes).not.toContain("no-outcome");
  });
});

describe("the rules that keep the list short", () => {
  it("flags a repeated opener once, on the second bullet", () => {
    const doc = docWith([
      "Designed the settlement queue, cutting the close window to minutes.",
      "Designed the retry layer with backoff, removing the duplicate-charge class of incident.",
      "Designed the cache warming job, so the first request of the day is not the slow one.",
    ]);
    const repeats = writingIssues(doc).filter((i) => i.code === "repeated-opener");
    expect(repeats).toHaveLength(1);
  });

  it("does not flag the same opener across different roles", () => {
    const doc: ResumeDoc = {
      ...docWith([]),
      experience: [
        {
          ...SAMPLE_DOC.experience[0]!,
          bullets: [{ text: "Built the settlement queue, cutting the close window.", source_ids: [], keywords: [] }],
        },
        {
          ...SAMPLE_DOC.experience[0]!,
          company: "Older Co",
          bullets: [{ text: "Built the tracking service with Redis streams, holding ordering.", source_ids: [], keywords: [] }],
        },
      ],
    };
    expect(codesFor(doc)).not.toContain("repeated-opener");
  });

  it("does not stack a repeated-opener card onto a weak-opener one", () => {
    // Two cards for one edit, and the user fixes it once and sees the
    // other remain.
    const doc = docWith([
      "Helped with the settlement queue, cutting the close window to minutes.",
      "Helped with the retry layer using backoff, removing duplicate charges.",
    ]);
    expect(codesFor(doc)).not.toContain("repeated-opener");
  });

  it("ignores a fragment too short to judge", () => {
    expect(writingIssues(docWith(["Node.js"]))).toHaveLength(0);
  });

  it("groups every issue on a line into one card", () => {
    const doc = docWith(["Assisted with various tasks as required by the team."]);
    const grouped = groupByLine(writingIssues(doc));

    expect(grouped).toHaveLength(1);
    expect(grouped[0]!.issues.length).toBeGreaterThan(1);
    // And the card sorts by how much is wrong with it.
    expect(grouped[0]!.weight).toBe(grouped[0]!.issues.reduce((n, i) => n + i.weight, 0));
  });
});

describe("the summary", () => {
  it("flags one sentence and a paragraph, not three", () => {
    expect(codesFor(docWith([], "Backend engineer who ships."))).toContain("summary-too-short");
    expect(
      codesFor(docWith([], "One. Two. Three. Four. Five. Six sentences is a paragraph.")),
    ).toContain("summary-too-long");
    expect(
      codesFor(
        docWith([], "Backend engineer, six years, payments. Rebuilt settlement around Kafka. Looking for platform work."),
      ).filter((c) => c.startsWith("summary-")),
    ).toHaveLength(0);
  });

  it("flags the opening every screener has read today", () => {
    const doc = docWith([], "Results-driven engineer. Passionate about scale. Seeking a role.");
    expect(codesFor(doc)).toContain("filler");
  });
});

describe("the whole list", () => {
  it("puts the most valuable fix first", () => {
    const issues = writingIssues(docWith(["Attended standups.", "Worked on the billing service every day."]));
    const weights = issues.map((i) => i.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });

  it("gives every issue a path an edit can be applied to", () => {
    for (const issue of writingIssues(docWith(["Assisted with various tasks as required."]))) {
      expect(issue.path).toMatch(/^\/(summary|experience|projects)\//);
    }
  });

  it("says nothing about a document that is already written well", () => {
    const doc = docWith(
      [
        "Rebuilt settlement reconciliation around a Kafka queue, cutting close-of-day from six hours to twenty minutes.",
        "Introduced idempotency keys across the payments API, eliminating the duplicate-charge class of incident.",
      ],
      "Backend engineer, six years, payments. Rebuilt the reconciliation pipeline. Looking for platform work.",
    );
    expect(writingIssues(doc)).toHaveLength(0);
  });
});
