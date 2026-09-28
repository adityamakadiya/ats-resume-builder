/**
 * The calibration. This file is the only reason to believe length.ts.
 *
 * MEASURED, not asserted from a formula. Every number in HEIGHTS below came
 * out of headless Chromium rendering the frozen fixtures in
 * packages/templates/test/fixtures/html at each rung of the density ladder,
 * reading `.rz` scrollHeight with the min-height floor lifted so a short
 * document reports its real height rather than the one page print.css gives
 * it. They are fractions of an A4 page, 1122.52px.
 *
 * The anchor is standard--long at rung 0: 2.463 pages of content, which is
 * the three printed pages that were measured by hand off the PDF. If a change
 * to print.css moves these, re-measure them; do not nudge the estimator until
 * the old numbers come back.
 *
 * Modern is absent on purpose. It is two columns, so a stacked sum is the
 * wrong model of it, and length.ts says so.
 */

import { describe, expect, it } from "vitest";
import type { TailoredResume } from "@ats/core";
import { long, rich, sparse } from "@ats/templates/fixtures";

import {
  BUDGET_RUNG,
  WRITING_BUDGET,
  estimateLength,
  isOverLength,
  trimPlan,
  type Family,
  type Rung,
} from "./length";

/** [family][fixture][rung] -> pages of content, measured in Chromium. */
const HEIGHTS: Record<Family, Record<"sparse" | "rich" | "long", number[]>> = {
  standard: {
    sparse: [0.448, 0.408, 0.366, 0.327, 0.29],
    rich: [1.197, 1.042, 0.904, 0.755, 0.673],
    long: [2.463, 1.858, 1.665, 1.398, 1.247],
  },
  compact: {
    sparse: [0.419, 0.383, 0.345, 0.308, 0.275],
    rich: [1.129, 0.984, 0.854, 0.714, 0.639],
    long: [2.345, 1.758, 1.581, 1.329, 1.191],
  },
};

const DOCS = { sparse, rich, long };

/** The shapes length.ts quotes the budget for, restated here rather than
 *  exported, so a change to them has to be made deliberately in both places
 *  and cannot quietly redefine the thing the test is checking. */
const ONE_PAGE_SHAPE = { roles: 3, skills: 3, projects: 1, education: 1 };
const TWO_PAGE_SHAPE = { roles: 4, skills: 4, projects: 3, education: 2 };

/** A document of the given shape carrying exactly `lines` lines of writing,
 *  spread over its bullets. One character short of the wrap point, so a
 *  rounding difference cannot silently add a line. */
function filled(
  shape: { roles: number; skills: number; projects: number; education: number },
  lines: number,
): TailoredResume {
  const full = "x".repeat(109);
  const bullet = () => ({ text: full, source_ids: [], keywords: [] });

  // The summary and the skills rows come out of the same budget.
  let left = lines - 3 - shape.skills;
  const perRole = Math.max(1, Math.floor(left / (shape.roles + shape.projects)));

  const take = (n: number) => {
    const got = Math.max(0, Math.min(n, left));
    left -= got;
    return got;
  };

  const doc: TailoredResume = {
    headline: "Backend Engineer",
    summary: { text: "x".repeat(109 * 3), source_ids: [] },
    skills: Array.from({ length: shape.skills }, (_, i) => ({
      category: `Group ${i}`,
      items: [full],
      source_ids: [],
    })),
    experience: Array.from({ length: shape.roles }, (_, i) => ({
      source_id: `E${i}`,
      company: `Company ${i}`,
      title: "Engineer",
      location: "",
      start_date: "",
      end_date: "",
      bullets: Array.from({ length: take(perRole) }, bullet),
    })),
    projects: Array.from({ length: shape.projects }, (_, i) => ({
      source_id: `P${i}`,
      name: `Project ${i}`,
      url: "",
      bullets: Array.from({ length: take(perRole) }, bullet),
    })),
    education: Array.from({ length: shape.education }, (_, i) => ({
      source_id: `ED${i}`,
      institution: "University",
      degree: "BSc",
      dates: "2016 - 2020",
    })),
    certifications: [],
    other_sections: [],
    section_order: [],
    rewrite_notes: [],
  };

  // Whatever is left over after the even spread goes on the first role, so
  // the document really does carry the full budget.
  doc.experience[0].bullets.push(...Array.from({ length: take(left) }, bullet));
  return doc;
}

/**
 * THE ERROR BAR, stated honestly.
 *
 * Across the thirty measurements below the estimate lands within 0.22 of a
 * page of the rendered height, and within 13 per cent in relative terms. The
 * two bands are asserted together because either alone flatters it: the
 * absolute band is trivially met by the sparse fixture, which is a third of
 * a page whatever you do to it, and the relative band is hardest exactly
 * there, where being 0.05 of a page out is 12 per cent of a very short
 * document. The worst relative case in the table is compact--sparse at rung
 * 0, 0.37 estimated against 0.42 measured.
 *
 * The absolute band is what matters for the length check, because the
 * question asked of it is always "is this over two pages", and it is why
 * isOverLength() carries a 15 per cent margin before it will spend a model
 * call: an estimate that can be a fifth of a page wrong must not be allowed
 * to cut a bullet off a resume that would in fact have fitted.
 *
 * Where the error comes from, in order of size:
 *   - Wrapping. One mean character width stands in for real glyph advances,
 *     so a bullet sitting a few characters either side of a wrap point is
 *     predicted a whole line out. This is most of it.
 *   - The fixtures render in whatever sans the machine has, Helvetica or
 *     Arial, because Inter is not loaded into a file:// page. Inter is a
 *     little wider, so against a real preview the estimate runs slightly
 *     short rather than slightly long.
 *   - break-inside: avoid on an entry pushes a whole role to the next page,
 *     which a continuous sum cannot see at all. It only moves the printed
 *     page count, never the height, which is the other reason the check is
 *     made on height and not on ceil().
 */
const ABS_TOLERANCE_PAGES = 0.22;
const REL_TOLERANCE = 0.13;

describe("estimateLength against the rendered fixtures", () => {
  const cases: Array<[Family, keyof typeof DOCS, Rung]> = [];
  for (const family of ["standard", "compact"] as const) {
    for (const name of ["sparse", "rich", "long"] as const) {
      for (const rung of [0, 1, 2, 3, 4] as const) cases.push([family, name, rung]);
    }
  }

  it.each(cases)("%s / %s at rung %i", (family, name, rung) => {
    const measured = HEIGHTS[family][name][rung];
    const { pages } = estimateLength(DOCS[name], { family, rung });

    expect(Math.abs(pages - measured)).toBeLessThanOrEqual(ABS_TOLERANCE_PAGES);
    expect(Math.abs(pages - measured) / measured).toBeLessThanOrEqual(REL_TOLERANCE);
  });

  it("reproduces the hand-measured three pages of standard--long", () => {
    // The one fixture whose printed page count was counted off a PDF rather
    // than computed. ceil() of the height is the printed count, and the
    // estimate has to agree on it or nothing downstream means anything.
    const { pages } = estimateLength(long, { family: "standard", rung: 0 });
    expect(Math.ceil(pages)).toBe(3);
  });
});

describe("the writing budget", () => {
  it("is derived at the rung the ladder is likely to settle on", () => {
    // Rung 2 is the middle of the ladder. Budgeting at 0 would make every
    // resume short; budgeting at 4 would make every resume 9pt.
    expect(BUDGET_RUNG).toBe(2);
  });

  it("is a number a resume of that length actually reaches", () => {
    /*
      The check that the budget is neither wishful nor stingy. A document of
      the assumed shape, written exactly to the budget, has to land close to
      the page count it was quoted for: under it, or it is a lie, and not far
      under it, or it is leaving a third of a page of evidence unwritten.
    */
    const atBudget = filled(TWO_PAGE_SHAPE, WRITING_BUDGET.twoPages);
    const { pages, textLines } = estimateLength(atBudget, { family: "standard" });

    expect(textLines).toBe(WRITING_BUDGET.twoPages);
    expect(pages).toBeLessThanOrEqual(2);
    expect(pages).toBeGreaterThan(1.85);
  });

  it("is a number a one page resume actually reaches", () => {
    const atBudget = filled(ONE_PAGE_SHAPE, WRITING_BUDGET.onePage);
    const { pages } = estimateLength(atBudget, { family: "standard" });

    expect(pages).toBeLessThanOrEqual(1);
    expect(pages).toBeGreaterThan(0.85);
  });

  it("holds the one page budget below half the two page one", () => {
    // Furniture is paid once per document, not once per page, so a one page
    // resume gets less than half the writing room of a two page one. A
    // budget that halved the two page figure would tell a candidate writing
    // a one pager they have room they do not have.
    expect(WRITING_BUDGET.onePage).toBeLessThan(WRITING_BUDGET.twoPages / 2);
  });

  it("is quoted for a shape, and says so, because furniture is not free", () => {
    /*
      The honest limitation, pinned so nobody reads the budget as a promise.
      The long fixture writes only 54 lines, well inside the 94 line two page
      budget, and still renders at over one and a half pages, because it
      carries six jobs, four projects and eight section headings. The budget
      prices the furniture of a normal resume; a document that doubles the
      furniture has spent the difference before it writes a word. This is why
      the length check measures the document rather than trusting the count.
    */
    const { textLines, pages } = estimateLength(long, { family: "standard" });
    expect(textLines).toBeLessThan(WRITING_BUDGET.twoPages);
    expect(pages).toBeGreaterThan(1.5);
  });
});

describe("isOverLength", () => {
  it("leaves alone anything the density ladder can still absorb", () => {
    // standard--long is three pages at rung 0 and 1.25 pages at rung 4. The
    // ladder handles it. Asking a model to cut it would be throwing away
    // content to solve a problem the renderer had already solved.
    expect(isOverLength(long).over).toBe(false);
    expect(isOverLength(rich).over).toBe(false);
    expect(isOverLength(sparse).over).toBe(false);
  });

  it("fires on a document the tightest rung cannot save", () => {
    // Four times the long fixture's experience. There is no rung for this.
    const enormous = {
      ...long,
      experience: [...long.experience, ...long.experience, ...long.experience, ...long.experience],
    };
    const result = isOverLength(enormous);
    expect(result.over).toBe(true);
    expect(result.pages).toBeGreaterThan(3);
  });

  it("respects a one page request", () => {
    expect(isOverLength(long, 1).over).toBe(true);
  });
});

describe("trimPlan", () => {
  it("cuts from the back of the placement ladder, never the current role", () => {
    const estimate = estimateLength(long, { family: "standard" });
    const plan = trimPlan(estimate, 12);

    expect(plan.length).toBeGreaterThan(0);
    // The first role in the document is the most recent one, and the scorer
    // pays most for its bullets. It must not be named.
    expect(plan.join("\n")).not.toContain(long.experience[0].company);
    // The oldest role is the first thing offered up.
    expect(plan[0]).toContain(long.experience[long.experience.length - 1].company);
  });

  it("still returns advice when there is nothing structural left to drop", () => {
    const estimate = estimateLength(sparse, { family: "standard" });
    expect(trimPlan(estimate, 20).length).toBeGreaterThan(0);
  });
});
