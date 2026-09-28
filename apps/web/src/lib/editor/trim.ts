/**
 * Which line to drop when the resume runs over the page.
 *
 * The overflow banner used to say "this is running to a second page, cut a
 * bullet" and stop there. That hands back the hardest decision in the job:
 * every line on the page is something the candidate did, they are all true,
 * and the person reading the banner has no way to tell which one the
 * screener would have missed least. Most people responded by cutting the
 * last thing they wrote, which is usually the most recent and therefore the
 * most expensive line on the page.
 *
 * This is `ceiling.ts` run backwards. That module asks, for each honest
 * addition, how many POINTS it is worth. This one asks, for each removable
 * line, how many POINTS it costs and how many LINES it frees. Same scorer,
 * same method: build the op, apply it to a copy, rescore, subtract. Nothing
 * here is estimated, because a cut list built from estimates would rank the
 * user's resume by a rule of thumb and present it as arithmetic.
 *
 * WHY CHEAPEST FIRST
 *
 * The list is sorted by what the cut costs, ascending, so the top of it is
 * the line the candidate loses least by dropping. A bullet at 0.0 is free:
 * every keyword it carries is claimed somewhere the scorer values at least
 * as highly, and the prose gains nothing the rest of the page does not
 * already have. A cut can also come out NEGATIVE, meaning the document
 * scores better without the line, and that is not a bug to clamp away: it
 * is usually a filler bullet or a repeated opener dragging the prose gate
 * down, and it should sit at the very top of the list.
 *
 * RECENCY IS NOT A RULE HERE, AND DOES NOT NEED TO BE
 *
 * The scorer weights keyword evidence by zone: the current role at 1.0, then
 * 0.85, 0.72, 0.62, then a 0.6 floor, with projects at 0.8 and the skills
 * list at 0.5 (ZONE_ROLE_DECAY in packages/core/src/scoring/index.ts). It
 * also saturates, taking the best zone a term appears in rather than a sum.
 * Two consequences fall out without a line of ranking code:
 *
 *   - an old bullet whose terms are also claimed in a newer role costs
 *     exactly 0.0, because the maximum across zones does not move;
 *   - an old bullet carrying a term found nowhere else costs that term's
 *     weight scaled by the decay, which is strictly less than the same
 *     term's loss out of the current role.
 *
 * Verified in trim.test.ts against the sample fixtures rather than asserted
 * here. The one place the arithmetic does NOT order by age is prose quality:
 * metric density and outcome markers are counted over the whole document, so
 * a 2019 bullet with the only hard number in it can cost more than a 2024
 * bullet without one. That is the scorer being right and a recency rule
 * being wrong, so no separate rule is applied.
 *
 * WHAT IS NEVER OFFERED, AND WHY
 *
 *   contact details      Not content. A resume with no phone number is not
 *                        shorter, it is unreturnable.
 *   any whole role       `protectedPathError` in packages/core/src/patch
 *                        already refuses an op on `/experience/N`, because
 *                        deleting a job leaves an unexplained gap in the
 *                        timeline that a recruiter reads as concealment.
 *                        The candidate can do it by hand in the form; the
 *                        product will not suggest it.
 *   the last bullets of  A heading with nothing under it is worse than the
 *   the current role     line that was removed, and the role being applied
 *                        for is read hardest. Two bullets minimum there,
 *                        one everywhere else.
 *   education            Kept whole for a candidate with little experience,
 *                        where the degree is the strongest thing on the
 *                        page and the scorer cannot see that it is doing
 *                        the work of a first role. Above the threshold it
 *                        is two lines, which is not where a page overflow
 *                        is won. Cheap to keep, expensive to get wrong.
 *   the summary          Cutting it is a rewrite, not a deletion, and the
 *                        Writing tab already owns rewrites.
 *   skills list items    A word inside a wrapped list almost never frees a
 *                        whole line, so it would rank on a saving that does
 *                        not exist.
 *
 * Certifications, projects and the tail sections are offered. Nobody expects
 * those lists to be exhaustive, so dropping one makes no claim and hides
 * nothing.
 *
 * Pure. No React, no I/O, no clock, no randomness, and no model call.
 */

import {
  experienceInRecencyOrder,
  type AtsReport,
  type JobSpec,
  type Op,
  type ResumeFacts,
} from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import { pointer, tailoredOf } from "./doc";
import { deltaOf } from "./gaps";
import { writingIssues } from "./writing";

/* --------------------------------------------------------------- types -- */

export type CutKind =
  | "experience-bullet"
  | "project-bullet"
  | "project"
  | "section-bullet"
  | "section"
  | "certification";

/**
 * The alternative to deleting a line that is only too long.
 *
 * `writing.ts` flags a bullet over 240 characters with code "too-long",
 * on the grounds that a three-line bullet is skipped rather than read. That
 * is the same complaint the page budget is making, and it has a cheaper
 * answer than deletion: the overflow lines are the ones past the second, and
 * losing them costs nothing at all because the claim survives. So a cut on a
 * too-long line carries this, and the row offers the rewrite first.
 *
 * No ops and no cost. The shorter sentence does not exist yet, and the only
 * thing that can write it honestly is the rewrite behind /api/suggest with
 * the guard on the other side of it. Inventing a delta for text nobody has
 * seen is exactly the estimate this module refuses to make.
 */
export type ShortenInstead = {
  /** Lines the overflow alone is costing, on the same arithmetic as below. */
  lines: number;
  why: string;
};

export type Cut = {
  kind: CutKind;
  /** JSON pointer to what would go. Also the row key and the edit key. */
  path: string;
  /** Where it is, in words, matching the writing panel's phrasing. */
  where: string;
  /** The line as it stands, or the first line of a multi-line entry. */
  text: string;
  /** What the apply button applies. Always a single remove. */
  ops: Op[];
  /**
   * Points this cut costs, computed by applying `ops` and rescoring.
   * Zero is free. Negative means the document scores better without it.
   */
  cost: number;
  /** Roughly how many rendered lines this frees. See CHARS_PER_LINE. */
  lines: number;
  /** One sentence naming what is actually lost. Never names the rule. */
  why: string;
  /** Set when shortening would answer the same problem. */
  shorten: ShortenInstead | null;
};

/* ------------------------------------------------------------- metrics -- */

/*
  How many rendered lines a bullet takes.

  Deliberately the crudest possible model, and deliberately the same constant
  the writing rules already use: writing.ts calls 240 characters "about two
  lines at resume width", so a line is about 120. This is NOT a measurement
  and must not be presented as one, which is why the UI says "about N lines"
  and the ranking never breaks a tie on it before it has broken one on points.
  Real measurement belongs to the fitter, which has the rendered DOM; this
  only has to be right enough to tell a one-line item from a four-line one.
*/
const CHARS_PER_LINE = 120;

/** A bullet past this is a paragraph. Mirrors LONG_BULLET in writing.ts. */
const LONG_BULLET = 240;

/** Bullets the current role keeps whatever the page budget says. */
const MIN_BULLETS_CURRENT_ROLE = 2;

/** Bullets every other role keeps, so no heading is left standing alone. */
const MIN_BULLETS_OLDER_ROLE = 1;

function linesOf(text: string): number {
  const clean = text.trim();
  if (!clean) return 0;
  return Math.max(1, Math.ceil(clean.length / CHARS_PER_LINE));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------ the list -- */

type Candidate = {
  kind: CutKind;
  path: string;
  where: string;
  text: string;
  lines: number;
  why: string;
};

/**
 * Which entry in `doc.experience` the scorer reads as the current role.
 *
 * Read from the scorer rather than assumed to be index 0. `experienceInRecencyOrder`
 * is what decides the zone weights, so asking it is the only way to be sure
 * the role this module protects is the role the scorer is paying full price
 * for. Resumes do arrive out of order.
 */
function currentRoleIndex(doc: ResumeDoc): number {
  const first = experienceInRecencyOrder(tailoredOf(doc))[0];
  if (!first) return -1;
  return doc.experience.indexOf(first);
}

function candidatesFor(doc: ResumeDoc): Candidate[] {
  const out: Candidate[] = [];
  const current = currentRoleIndex(doc);

  doc.experience.forEach((exp, i) => {
    const keep = i === current ? MIN_BULLETS_CURRENT_ROLE : MIN_BULLETS_OLDER_ROLE;
    const live = exp.bullets.filter((b) => b.text.trim()).length;
    if (live <= keep) return;

    exp.bullets.forEach((bullet, b) => {
      const text = bullet.text.trim();
      if (!text) return;
      out.push({
        kind: "experience-bullet",
        path: pointer("experience", i, "bullets", b),
        where: `${exp.company || "Experience"}, bullet ${b + 1}`,
        text,
        lines: linesOf(text),
        why:
          i === current
            ? "This is in the role being read hardest, so check what it claims is said elsewhere."
            : "An older role, where the scorer already discounts what a line is worth.",
      });
    });
  });

  /*
    A project with one bullet goes whole or not at all. Removing its only
    line leaves the project name and URL standing over nothing, which reads
    as a rendering fault and still costs the heading line. Multi-bullet
    projects are offered a line at a time and as a block, and the arithmetic
    decides which of the two the user is shown first.
  */
  doc.projects.forEach((proj, i) => {
    const live = proj.bullets.filter((b) => b.text.trim());
    const name = proj.name || "Project";
    const block = live.reduce((n, b) => n + linesOf(b.text), 0) + 1;

    out.push({
      kind: "project",
      path: pointer("projects", i),
      where: name,
      text: live[0]?.text.trim() ?? name,
      lines: block,
      // The heading line goes too, which is why a whole small project often
      // frees more than a bullet out of a big one.
      why: "The whole project, including its heading line. Nobody expects this list to be complete.",
    });

    if (live.length <= 1) return;
    proj.bullets.forEach((bullet, b) => {
      const text = bullet.text.trim();
      if (!text) return;
      out.push({
        kind: "project-bullet",
        path: pointer("projects", i, "bullets", b),
        where: `${name}, bullet ${b + 1}`,
        text,
        lines: linesOf(text),
        why: "One line of a project that stays on the page.",
      });
    });
  });

  doc.other_sections.forEach((sec, i) => {
    const live = sec.bullets.filter((b) => b.text.trim());
    const heading = sec.heading || "Section";
    const block = live.reduce((n, b) => n + linesOf(b.text), 0) + 1;

    out.push({
      kind: "section",
      path: pointer("other_sections", i),
      where: heading,
      text: live[0]?.text.trim() ?? heading,
      lines: block,
      why: `The whole ${heading} section, heading included.`,
    });

    if (live.length <= 1) return;
    sec.bullets.forEach((bullet, b) => {
      const text = bullet.text.trim();
      if (!text) return;
      out.push({
        kind: "section-bullet",
        path: pointer("other_sections", i, "bullets", b),
        where: `${heading}, item ${b + 1}`,
        text,
        lines: linesOf(text),
        why: `One item out of ${heading}.`,
      });
    });
  });

  doc.certifications.forEach((cert, i) => {
    const text = cert.text.trim();
    if (!text) return;
    out.push({
      kind: "certification",
      path: pointer("certifications", i),
      where: "Certifications",
      text,
      lines: linesOf(text),
      why: "A credential, not evidence of doing the work. Check the posting does not name it.",
    });
  });

  return out;
}

/** The too-long bullets, by pointer to the bullet rather than to its text. */
function shortenable(doc: ResumeDoc): Map<string, ShortenInstead> {
  const out = new Map<string, ShortenInstead>();

  for (const issue of writingIssues(doc)) {
    if (issue.code !== "too-long") continue;
    // writing.ts points at `/.../text`; a cut removes the bullet object.
    const bulletPath = issue.path.replace(/\/text$/, "");
    const over = linesOf(issue.text) - Math.ceil(LONG_BULLET / CHARS_PER_LINE);
    if (over <= 0) continue;
    out.set(bulletPath, {
      lines: over,
      why: "This one runs long. Tightening it frees most of the same space and keeps the claim.",
    });
  }

  return out;
}

/**
 * Every line worth offering to cut, cheapest first.
 *
 * With no posting there is no scorer to price a cut with, and a list ordered
 * by an unknown cost is not a ranking, it is a guess wearing one. Returns
 * empty, the same answer `suggestionsFor` gives for the same reason.
 */
export function cutsFor(
  job: JobSpec | null,
  facts: ResumeFacts,
  doc: ResumeDoc,
  report: AtsReport | null,
): Cut[] {
  if (!job || !report) return [];

  const hints = shortenable(doc);
  const cuts: Cut[] = [];

  for (const candidate of candidatesFor(doc)) {
    const ops: Op[] = [{ op: "remove", path: candidate.path }];
    /*
      The same call `gaps.ts` prices an addition with, so a cut and a
      restoration of the same line are guaranteed to be two readings of one
      number rather than two implementations that drift. It applies the ops
      to a copy and rescores; a `null` back means the op would not apply at
      all, and an offer that cannot be taken must not be shown.
    */
    const delta = deltaOf(job, facts, doc, report, ops);
    if (delta === null) continue;

    cuts.push({
      kind: candidate.kind,
      path: candidate.path,
      where: candidate.where,
      text: candidate.text,
      ops,
      // deltaOf reports the movement; a cut costs what the movement takes.
      cost: round1(-delta),
      lines: candidate.lines,
      why: candidate.why,
      shorten: hints.get(candidate.path) ?? null,
    });
  }

  return cuts.sort(compare);
}

/**
 * Cheapest first, and only then biggest.
 *
 * Points lead because the whole point of the list is that the user stops
 * reading at the top of it: whatever is first is what they will cut. Space
 * breaks the tie, because among lines that cost nothing the right one to
 * drop is the one that buys the most room. The pointer breaks the rest, so
 * the order cannot reshuffle between renders on an equal pair.
 */
function compare(a: Cut, b: Cut): number {
  if (a.cost !== b.cost) return a.cost - b.cost;
  if (a.lines !== b.lines) return b.lines - a.lines;
  return a.path.localeCompare(b.path);
}
