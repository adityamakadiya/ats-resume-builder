/**
 * How long is this resume, before anything has been rendered?
 *
 * The tailor step runs on the server. There is no DOM there, so there is no
 * `scrollHeight` to read, which is why the only length control the product
 * had was a sentence in the prompt telling the model to "aim for one to two
 * pages". A model cannot see a page, so that instruction did nothing: a draft
 * that came to 2.4 pages and one that came to 1.9 were indistinguishable from
 * where the model was standing, and neither the prompt nor the pipeline ever
 * learned which it had produced.
 *
 * This is the missing measurement, done arithmetically. It is not a layout
 * engine and it is not trying to be. It reproduces the one thing print.css
 * actually does to decide height: stack a known number of boxes whose heights
 * are all expressed in em of the body size, and multiply.
 *
 * THE DERIVATION, because a number nobody can check is a number nobody should
 * trust.
 *
 *   A4 at 96 CSS pixels to the inch is 1122.52px tall and 793.7px wide. That
 *   is the same constant fit.ts falls back to, and the same page print.css
 *   declares with --page-w / --page-h.
 *
 *   The density ladder in print.css sets four things per rung: the page
 *   padding, a --block-gap multiplier, the leading and the body size. Every
 *   other length in the stylesheet is em of the body, scaled by --block-gap,
 *   so the whole document's height is (a number of em) x (the body size in
 *   px) + the padding, and that number of em is a pure function of the
 *   content. RUNGS below is a transcription of that table, nothing more.
 *
 *   Each box's cost in em is read straight off print.css. A bullet is
 *   leading em per wrapped line, plus --gap-line between siblings. A section
 *   heading is 0.82em of type at the body leading, plus its rule offset, its
 *   bottom margin and the section's top margin. And so on through
 *   ELEMENTS below, which cites the rule it came from in each case.
 *
 *   Wrapping is the one thing that cannot be read off the stylesheet, so it
 *   was measured. Rendering the frozen fixtures in headless Chromium, the
 *   widest single line of a bullet in the standard template at rung 0 came
 *   to 98 characters in a 634px column at 14.667px type, and the five-line
 *   summary of standard--long came to 90 characters a line averaged across
 *   its four full lines and one short one. That puts the mean advance width
 *   of this text at about 0.45em, which is the usual figure for mixed-case
 *   Helvetica or Arial and is what CHAR_EM holds.
 *
 * WHAT IT IS CALIBRATED AGAINST, and how well.
 *
 *   The nine frozen fixtures in packages/templates/test/fixtures/html were
 *   rendered in headless Chromium at every rung and their heights recorded.
 *   standard--long comes to 2.46 pages of content at rung 0, which is the
 *   three printed pages that were measured by hand. length.test.ts asserts
 *   this estimator against those real heights for the standard and compact
 *   families and states the error band it holds to. Read that test before
 *   trusting a number out of here; it is the only reason to.
 *
 *   Modern is deliberately out of scope. It is a two-column layout, so its
 *   sidebar and its main column share vertical space and a single stacked
 *   sum is the wrong model of it. Estimating a modern document as if it were
 *   standard over-states its height, which is the safe direction for a
 *   length check but is not an estimate anyone should quote.
 */

import type { TailoredResume } from "@ats/core";

/** A4 at 96 CSS pixels to the inch. Same number fit.ts falls back to. */
export const PAGE_HEIGHT_PX = 1122.52;
/** 210mm at the same scale. */
export const PAGE_WIDTH_PX = 793.7;

/**
 * The density ladder, transcribed from print.css. `pad` is inches, `body` is
 * points, `gap` is the --block-gap multiplier and `lead` the line-height.
 * If the stylesheet's ladder moves, this moves with it or the estimate is a
 * measurement of a page that no longer exists.
 */
export const RUNGS = [
  { pad: 0.75, gap: 1, lead: 1.35, body: 11 },
  { pad: 0.68, gap: 0.88, lead: 1.3, body: 10.5 },
  { pad: 0.6, gap: 0.76, lead: 1.24, body: 10 },
  { pad: 0.52, gap: 0.65, lead: 1.18, body: 9.5 },
  { pad: 0.45, gap: 0.55, lead: 1.12, body: 9 },
] as const;

export type Rung = 0 | 1 | 2 | 3 | 4;

/**
 * The rung the budget is written against.
 *
 * Not rung 0, because budgeting at the roomiest setting would make every
 * resume short. Not rung 4 either: a document that only fits at 9pt type and
 * 0.45in margins fits in the same sense that a suitcase you have to sit on
 * closes. Rung 2 is 10pt at 0.6in, an ordinary professional resume, and
 * budgeting there leaves fit.ts two roomier rungs for a short document and
 * two tighter ones to absorb an overshoot before the page count breaks.
 */
export const BUDGET_RUNG: Rung = 2;

/** Mean advance width of this text, in em. Measured, see the header. */
const CHAR_EM = 0.45;

/**
 * Per-element costs in em of the body size, before the --block-gap scale.
 * `gap` entries are multiplied by the rung's --block-gap, `fixed` entries are
 * not, and `lead` entries are multiplied by the rung's line-height because
 * they are lines of type.
 *
 * Each one cites the rule it came from. Do not tune these to make a test
 * pass; go and read the rule.
 */
const ELEMENTS = {
  /** .rz-name: 1.95em at line-height 1.05. Standard only, compact is 1.6em. */
  nameStandard: 1.95 * 1.05,
  nameCompact: 1.6 * 1.05,
  /** .rz-headline: margin-top 0.24 x gap, then 1em at line-height 1.25. */
  headlineGap: 0.24,
  headline: 1.25,
  /** .rz-contact: margin-top 0.42 x gap, then 0.93em at line-height 1.45. */
  contactGap: 0.42,
  contact: 0.93 * 1.45,
  /** .rz--standard .rz-header padding-bottom 0.7 x gap, compact 0.45. */
  headerPadStandard: 0.7,
  headerPadCompact: 0.45,
  /** .rz-h2: 0.82em (compact 0.78) of type set at the body leading. */
  h2Standard: 0.82,
  h2Compact: 0.78,
  /** .rz-h2 padding-bottom --rule-offset 0.26, margin-bottom 0.42 x 1.1. */
  h2Below: 0.26 + 0.42 * 1.1,
  /** .rz-entry-title: 1em at line-height 1.3. */
  entryTitle: 1.3,
  /** .rz-entry-line--sub: margin-top 0.5 x --gap-line, 0.93em at leading. */
  subGap: 0.2 * 0.5,
  subLine: 0.93,
  /** .rz-edu-degree is the same shape as the sub line. */
  eduDegree: 0.93,
} as const;

/** --gap-* tokens, as their --block-gap multipliers. Standard then compact. */
const GAPS = {
  standard: { section: 1.15, entry: 0.78, head: 0.42, line: 0.2 },
  compact: { section: 0.82, entry: 0.55, head: 0.3, line: 0.14 },
} as const;

export type Family = keyof typeof GAPS;

export type LengthEstimate = {
  /** Estimated rendered height in CSS pixels, padding included. */
  heightPx: number;
  /** The same height counted in body line heights, padding excluded. This is
   *  the currency the budget is quoted in, because a line is something a
   *  writer can count and a pixel is not. */
  lines: number;
  /** Pages that height occupies. Fractional, deliberately: 2.05 and 2.9 are
   *  different problems and rounding them both to 3 throws that away. */
  pages: number;
  /** Lines of the candidate's own prose: summary, skills rows, bullets. This
   *  is the number the prompt gives the model, because it is the only part of
   *  the page the model actually controls. */
  textLines: number;
  /** Where those lines went, for a repair that has to name a place to cut. */
  breakdown: {
    summary: number;
    skills: number;
    experience: Array<{ company: string; bullets: number; lines: number }>;
    projects: number;
    other: number;
  };
};

function wrappedLines(text: string, charsPerLine: number): number {
  if (!text.trim()) return 0;
  return Math.max(1, Math.ceil(text.length / charsPerLine));
}

/**
 * Estimate the rendered height of a tailored resume.
 *
 * `contactLines` exists because TailoredResume has no contact block: contact
 * details are claimed facts and live on ResumeFacts, and the template joins
 * the two. One line is what a name, an email, a phone and two links come to
 * at full width, and it is what every fixture renders.
 */
export function estimateLength(
  doc: TailoredResume,
  opts: { rung?: Rung; family?: Family; contactLines?: number } = {},
): LengthEstimate {
  const rung = RUNGS[opts.rung ?? BUDGET_RUNG];
  const family: Family = opts.family ?? "standard";
  const gaps = GAPS[family];

  const bodyPx = (rung.body / 72) * 96;
  const padPx = rung.pad * 96;
  const contentWidthPx = PAGE_WIDTH_PX - 2 * padPx;
  const charsPerLine = Math.max(20, Math.floor(contentWidthPx / (CHAR_EM * bodyPx)));
  // .rz-bullets has padding-left 1.05em (compact 0.95em), so a bullet wraps
  // a little earlier than a paragraph does.
  const bulletIndentEm = family === "compact" ? 0.95 : 1.05;
  const bulletChars = Math.max(
    20,
    Math.floor((contentWidthPx - bulletIndentEm * bodyPx) / (CHAR_EM * bodyPx)),
  );

  const L = rung.lead;
  const g = rung.gap;
  const line = (n: number) => n * L;
  const gap = (n: number) => n * g;

  let em = 0;
  let textLines = 0;

  // Header. Name, headline, contact, the rule under it and its bottom margin.
  em +=
    (family === "compact" ? ELEMENTS.nameCompact : ELEMENTS.nameStandard) +
    gap(ELEMENTS.headlineGap) +
    ELEMENTS.headline +
    gap(ELEMENTS.contactGap) +
    ELEMENTS.contact * (opts.contactLines ?? 1) +
    gap(family === "compact" ? ELEMENTS.headerPadCompact : ELEMENTS.headerPadStandard) +
    gap(gaps.section);

  // .rz-section:first-of-type has no top margin, so the first heading is
  // cheaper than the rest. Tracked rather than approximated because on a
  // sparse resume it is a whole line of the difference.
  let sectionsSeen = 0;
  const heading = () => {
    sectionsSeen += 1;
    return (
      line(family === "compact" ? ELEMENTS.h2Compact : ELEMENTS.h2Standard) +
      gap(ELEMENTS.h2Below) +
      (sectionsSeen === 1 ? 0 : gap(gaps.section))
    );
  };

  const breakdown: LengthEstimate["breakdown"] = {
    summary: 0,
    skills: 0,
    experience: [],
    projects: 0,
    other: 0,
  };

  if (doc.summary.text.trim()) {
    const n = wrappedLines(doc.summary.text, charsPerLine);
    em += heading() + line(n);
    textLines += n;
    breakdown.summary = n;
  }

  if (doc.skills.length) {
    // The skills grid is one row per group, its height set by whichever of
    // the label and the values wraps furthest. The label column is
    // max-content, so the values get what is left; approximating that as the
    // full width understates a long group by well under a line.
    let n = 0;
    for (const group of doc.skills) n += wrappedLines(group.items.join(", "), charsPerLine);
    em += heading() + line(n) + gap(gaps.line) * Math.max(0, doc.skills.length - 1);
    textLines += n;
    breakdown.skills = n;
  }

  if (doc.experience.length) {
    em += heading();
    doc.experience.forEach((role, i) => {
      let n = 0;
      for (const b of role.bullets) n += wrappedLines(b.text, bulletChars);
      em +=
        (i === 0 ? 0 : gap(gaps.entry)) +
        ELEMENTS.entryTitle +
        gap(ELEMENTS.subGap) +
        line(ELEMENTS.subLine) +
        (role.bullets.length ? gap(gaps.head) : 0) +
        line(n) +
        gap(gaps.line) * Math.max(0, role.bullets.length - 1);
      textLines += n;
      breakdown.experience.push({ company: role.company, bullets: role.bullets.length, lines: n });
    });
  }

  if (doc.projects.length) {
    em += heading();
    doc.projects.forEach((project, i) => {
      let n = 0;
      for (const b of project.bullets) n += wrappedLines(b.text, bulletChars);
      // A project entry has a title line but no sub line: the url sits on the
      // title row, right aligned, where the dates go on a role.
      em +=
        (i === 0 ? 0 : gap(gaps.entry)) +
        ELEMENTS.entryTitle +
        (project.bullets.length ? gap(gaps.head) : 0) +
        line(n) +
        gap(gaps.line) * Math.max(0, project.bullets.length - 1);
      textLines += n;
      breakdown.projects += n;
    });
  }

  if (doc.education.length) {
    em += heading();
    doc.education.forEach((_edu, i) => {
      em +=
        (i === 0 ? 0 : gap(gaps.entry)) +
        ELEMENTS.entryTitle +
        gap(ELEMENTS.subGap) +
        line(ELEMENTS.eduDegree);
    });
    // Education is one line each by instruction, so it is furniture rather
    // than prose and does not come out of the writing budget.
  }

  if (doc.certifications.length) {
    let n = 0;
    for (const cert of doc.certifications) n += wrappedLines(cert.text, bulletChars);
    em += heading() + line(n) + gap(gaps.line) * Math.max(0, doc.certifications.length - 1);
    textLines += n;
    breakdown.other += n;
  }

  for (const section of doc.other_sections) {
    let n = 0;
    for (const b of section.bullets) n += wrappedLines(b.text, bulletChars);
    em += heading() + line(n) + gap(gaps.line) * Math.max(0, section.bullets.length - 1);
    textLines += n;
    breakdown.other += n;
  }

  const heightPx = em * bodyPx + 2 * padPx;

  return {
    heightPx,
    lines: em / L,
    pages: heightPx / PAGE_HEIGHT_PX,
    textLines,
    breakdown,
  };
}

/**
 * How many line heights a page holds at the budget rung.
 *
 *   page height       1122.52px
 *   n pages           n x 1122.52
 *   less padding      the flow pays --page-pad once at the top and once at
 *                     the bottom, whatever the page count, so 2 x 0.6in =
 *                     115.2px comes off the total and not off each page
 *   line height       10pt = 13.333px, x 1.24 leading = 16.53px
 *
 * One page: (1122.52 - 115.2) / 16.53 = 60.9 lines. Two: 128.8.
 */
export function linesPerDocument(pages: number, rungIndex: Rung = BUDGET_RUNG): number {
  const rung = RUNGS[rungIndex];
  const bodyPx = (rung.body / 72) * 96;
  return (pages * PAGE_HEIGHT_PX - 2 * rung.pad * 96) / (bodyPx * rung.lead);
}

/**
 * A resume of a given shape carrying a given number of written lines.
 *
 * The budget cannot be worked out by subtracting furniture from a page,
 * which was the first attempt and was wrong by about eleven lines over two
 * pages. Furniture is not a constant: every bullet brings a --gap-line with
 * it, so the cost of the hundredth line is a fraction higher than the cost
 * of the first, and a subtraction misses all of it. The budget is therefore
 * found by construction. Build the document, price it with the same
 * function that prices a real one, and keep adding lines until it stops
 * fitting.
 */
function canonical(shape: Shape, writtenLines: number): TailoredResume {
  // One character under the wrap point, so a bullet is exactly one line.
  const full = "x".repeat(WRITING_BUDGET_CHARS - 1);
  const bullet = () => ({ text: full, source_ids: [], keywords: [] });

  // The summary and the skills rows come out of the same budget as the
  // bullets, because they are equally the candidate's own writing.
  let left = Math.max(0, writtenLines - SUMMARY_LINES - shape.skills);
  const holders = shape.roles + shape.projects;
  const each = Math.floor(left / holders);
  const take = (n: number) => {
    const got = Math.max(0, Math.min(n, left));
    left -= got;
    return got;
  };

  const experience = Array.from({ length: shape.roles }, (_, i) => ({
    source_id: `E${i}`,
    company: "",
    title: "",
    location: "",
    start_date: "",
    end_date: "",
    bullets: Array.from({ length: take(each) }, bullet),
  }));
  const projects = Array.from({ length: shape.projects }, (_, i) => ({
    source_id: `P${i}`,
    name: "",
    url: "",
    bullets: Array.from({ length: take(each) }, bullet),
  }));
  // The remainder of the even spread lands on the most recent role, which is
  // where the prompt puts the extra bullets anyway.
  if (experience.length) experience[0].bullets.push(...Array.from({ length: take(left) }, bullet));

  return {
    headline: "",
    summary: { text: "x".repeat(WRITING_BUDGET_CHARS * SUMMARY_LINES - 1), source_ids: [] },
    skills: Array.from({ length: shape.skills }, () => ({
      category: "",
      items: [full],
      source_ids: [],
    })),
    experience,
    projects,
    education: Array.from({ length: shape.education }, (_, i) => ({
      source_id: `ED${i}`,
      institution: "",
      degree: "",
      dates: "",
    })),
    certifications: [],
    other_sections: [],
    section_order: [],
    rewrite_notes: [],
  };
}

type Shape = { roles: number; skills: number; projects: number; education: number };

/** The three sentence summary the prompt asks for, in lines. */
const SUMMARY_LINES = 3;
/** Characters a line holds at the budget rung. Derived, not guessed:
 *  (678.5px column - 1.05em indent) / 0.45em at 10pt = 110. */
const WRITING_BUDGET_CHARS = 110;

/**
 * The two shapes the budget is quoted for.
 *
 * A one page resume is not half a two page one, because the furniture is
 * paid once per document rather than once per page. Quoting half the two
 * page figure would tell a candidate writing a one pager that they have room
 * they do not have, which is exactly the class of bad advice this whole
 * change exists to remove.
 */
const ONE_PAGE_SHAPE: Shape = { roles: 3, skills: 3, projects: 1, education: 1 };
const TWO_PAGE_SHAPE: Shape = { roles: 4, skills: 4, projects: 3, education: 2 };

/** The most written lines of the given shape that still fit in `pages`. */
function writingBudget(pages: number, shape: Shape): number {
  let best = 0;
  for (let n = 1; n <= 250; n += 1) {
    const doc = canonical(shape, n);
    if (estimateLength(doc, { family: "standard" }).pages > pages) break;
    best = n;
  }
  return best;
}

/**
 * The numbers written into the TAILOR prompt.
 *
 * The prompt keeps them as literals, because the cached prefix has to be
 * byte-stable and a prompt assembled out of computed constants is a prompt
 * that changes when a stylesheet does, silently and without a version bump.
 * prompts.test.ts asserts that the literals and these agree, so the two can
 * only go out of step in a way a test run catches.
 */
export const WRITING_BUDGET = {
  onePage: writingBudget(1, ONE_PAGE_SHAPE),
  twoPages: writingBudget(2, TWO_PAGE_SHAPE),
  charsPerLine: WRITING_BUDGET_CHARS,
} as const;

/**
 * Is this draft too long to print, given what fit.ts can do about it?
 *
 * The threshold is not the budget. fit.ts will spend four rungs of density
 * before it gives up, so a draft that overruns the rung 2 budget is usually
 * still a perfectly good two page resume set a little tighter. What is worth
 * a model call is a draft that does not fit at rung 4 either, because at that
 * point the ladder is exhausted and the only remaining lever is cutting
 * words.
 *
 * The 15 per cent margin on top is the estimator's error band, rounded
 * against the product's interest: a false negative costs a slightly tight
 * resume, a false positive costs a model call and, worse, throws away
 * content that would have fitted.
 */
export function isOverLength(
  doc: TailoredResume,
  maxPages = 2,
): { over: boolean; pages: number; estimate: LengthEstimate } {
  const estimate = estimateLength(doc, { rung: 4 });
  return { over: estimate.pages > maxPages * 1.15, pages: estimate.pages, estimate };
}

/**
 * Where to take the trim from, named, so the repair is a targeted cut rather
 * than a rerun of the whole rewrite.
 *
 * The order is the placement ladder in the TAILOR prompt read backwards. The
 * cheapest line on the page is the one furthest from the posting, so the
 * oldest role goes first, then projects, then the other sections, and the
 * current role is the last thing anybody touches.
 */
export function trimPlan(estimate: LengthEstimate, linesToCut: number): string[] {
  const plan: string[] = [];
  let remaining = linesToCut;

  const roles = estimate.breakdown.experience;
  for (let i = roles.length - 1; i >= 1 && remaining > 0; i -= 1) {
    const role = roles[i];
    if (role.bullets <= 1) continue;
    const drop = Math.min(role.bullets - 1, Math.ceil(remaining / 2));
    plan.push(`drop ${drop} bullet(s) from ${role.company}, the older role`);
    remaining -= drop * (role.lines / Math.max(1, role.bullets));
  }

  if (remaining > 0 && estimate.breakdown.projects > 0) {
    plan.push("drop the weakest project, or its second bullet");
    remaining -= 2;
  }
  if (remaining > 0 && estimate.breakdown.other > 0) {
    plan.push("drop the least relevant of the extra sections");
    remaining -= estimate.breakdown.other;
  }
  if (remaining > 0 && estimate.breakdown.summary > 3) {
    plan.push("tighten the summary to three short sentences");
    remaining -= estimate.breakdown.summary - 3;
  }
  if (remaining > 0) {
    plan.push(
      "shorten the longest bullets so each is one line, starting with the ones that run to three",
    );
  }

  return plan;
}
