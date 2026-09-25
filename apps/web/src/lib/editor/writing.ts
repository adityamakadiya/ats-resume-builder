/**
 * What is wrong with the writing, found without asking a model.
 *
 * Every rule here is one the scorer already enforces or the tailor prompt
 * already states, and it reuses their vocabularies rather than restating
 * them. That is the point: a suggestion the score then disagrees with is
 * worse than no suggestion, because the user does the work and watches the
 * number fail to move. BANNED_OPENERS, MECHANISM_TERMS, OUTCOME_MARKERS and
 * FILLER_PHRASES come from @ats/core, so there is exactly one definition of
 * "vague" in this codebase and both halves read it.
 *
 * DETECTION IS DETERMINISTIC, REWRITING IS NOT. Finding a weak line needs no
 * intelligence and must never cost a model call: it has to run on every
 * keystroke, be identical every time, and be testable. Writing the better
 * version does need one, so that is a separate step behind /api/suggest,
 * and it is offered per line rather than run over the whole document.
 *
 * WHAT IS DELIBERATELY NOT FLAGGED. Anything the user cannot fix by editing,
 * and anything that is a matter of taste. A missing technology is a gap, not
 * a writing problem, and it belongs to the keyword panel. Sentence rhythm,
 * word choice and tone are not mechanically checkable and a rule that
 * pretends otherwise produces confident nonsense.
 */

import {
  BANNED_OPENERS,
  FILLER_PHRASES,
  MECHANISM_TERMS,
  OUTCOME_MARKERS,
  normalise,
} from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import { pointer } from "./doc";

export type IssueCode =
  | "weak-opener"
  | "no-outcome"
  | "no-mechanism"
  | "too-long"
  | "repeated-opener"
  | "filler"
  | "summary-too-short"
  | "summary-too-long";

export type Issue = {
  code: IssueCode;
  /** JSON pointer to the text this is about, so a fix is an op. */
  path: string;
  /** Where it is, in words, for the card heading. */
  where: string;
  /** The text as it stands. */
  text: string;
  /** One sentence the user can act on. Never names the rule. */
  why: string;
  /**
   * What a fix is worth, roughly, in the scorer's own terms. Not points:
   * the real delta needs the rewritten text, which does not exist yet.
   */
  weight: number;
};

/*
  A bullet over this reads as a paragraph and gets skipped. Two lines at
  resume width is about 240 characters; the tailor prompt says the same
  thing in words.
*/
const LONG_BULLET = 240;
/** Under this a "bullet" is a fragment, and the rules below do not apply. */
const TOO_SHORT_TO_JUDGE = 25;

const METRIC = /\d/;

function firstWord(text: string): string {
  return normalise(text).split(/\s+/)[0] ?? "";
}

function hasOutcome(text: string): boolean {
  if (METRIC.test(text)) return true;
  const hay = normalise(text);
  return OUTCOME_MARKERS.some((m) =>
    new RegExp(`(?<![a-z])${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z])`).test(hay),
  );
}

function hasMechanism(text: string): boolean {
  const hay = normalise(text);
  for (const term of MECHANISM_TERMS) {
    if (new RegExp(`(?<![a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9])`).test(hay)) {
      return true;
    }
  }
  return false;
}

function fillerIn(text: string): string | null {
  const hay = normalise(text);
  return FILLER_PHRASES.find((phrase) => hay.includes(normalise(phrase))) ?? null;
}

/** Sentences, roughly. Good enough to count, which is all this needs. */
function sentences(text: string): string[] {
  return text
    .split(/[.!?]+\s/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function bulletIssues(
  text: string,
  path: string,
  where: string,
  seenOpeners: Map<string, number>,
): Issue[] {
  const out: Issue[] = [];
  const trimmed = text.trim();
  if (trimmed.length < TOO_SHORT_TO_JUDGE) return out;

  const opener = firstWord(trimmed);

  if (BANNED_OPENERS.has(opener)) {
    out.push({
      code: "weak-opener",
      path,
      where,
      text: trimmed,
      why: `Opening with "${opener}" describes being near the work rather than doing it. Lead with what you actually built or changed.`,
      weight: 3,
    });
  } else {
    /*
      Only counted when the opener is otherwise acceptable. Flagging a
      repeat AND a banned opener on the same line gives the user two cards
      for one edit, and the banned one is the more useful of the two.
    */
    const count = (seenOpeners.get(opener) ?? 0) + 1;
    seenOpeners.set(opener, count);
    if (count === 2) {
      out.push({
        code: "repeated-opener",
        path,
        where,
        text: trimmed,
        why: `Another bullet in this role already opens with "${opener}". Repetition inside one role reads as one achievement described twice.`,
        weight: 1,
      });
    }
  }

  if (!hasOutcome(trimmed)) {
    out.push({
      code: "no-outcome",
      path,
      where,
      text: trimmed,
      why: "This says what was done but not what changed because of it. End on the result, with a figure if your resume has one and a plain consequence if it does not.",
      weight: 4,
    });
  }

  if (!hasMechanism(trimmed)) {
    out.push({
      code: "no-mechanism",
      path,
      where,
      text: trimmed,
      why: "Nothing here says how it worked. Naming the mechanism, the index, the queue, the cache, the retry, is what a senior reader screens on and no keyword filter can fake it.",
      weight: 3,
    });
  }

  if (trimmed.length > LONG_BULLET) {
    out.push({
      code: "too-long",
      path,
      where,
      text: trimmed,
      why: `At ${trimmed.length} characters this runs to three or more lines, and a bullet that long is skipped rather than read. Cut it to the one claim that matters.`,
      weight: 2,
    });
  }

  const filler = fillerIn(trimmed);
  if (filler) {
    out.push({
      code: "filler",
      path,
      where,
      text: trimmed,
      why: `"${filler}" is a self-assessment, not evidence. It costs a line and tells a screener nothing.`,
      weight: 2,
    });
  }

  return out;
}

/**
 * Every writing problem in the document, most valuable first.
 *
 * Pure and cheap: no model, no network, no scoring. Safe to call on every
 * render, which is what lets the panel stay in step with the document while
 * somebody is typing into it.
 */
export function writingIssues(doc: ResumeDoc): Issue[] {
  const out: Issue[] = [];

  const summary = doc.summary.text.trim();
  if (summary) {
    const count = sentences(summary).length;
    if (count < 2) {
      out.push({
        code: "summary-too-short",
        path: pointer("summary", "text"),
        where: "Summary",
        text: summary,
        why: "One sentence cannot say what you are, what you have built and what you are aiming at. Three can.",
        weight: 4,
      });
    } else if (count > 4) {
      out.push({
        code: "summary-too-long",
        path: pointer("summary", "text"),
        where: "Summary",
        text: summary,
        why: `${count} sentences is a paragraph, and the summary is read in about four seconds. Keep the three that earn their place.`,
        weight: 3,
      });
    }

    const filler = fillerIn(summary);
    if (filler) {
      out.push({
        code: "filler",
        path: pointer("summary", "text"),
        where: "Summary",
        text: summary,
        why: `"${filler}" is the opening a screener has read a hundred times today. Say what you have actually done instead.`,
        weight: 3,
      });
    }
  }

  doc.experience.forEach((exp, i) => {
    // Openers repeat within a role, not across the document: two roles both
    // opening with "Built" is fine and common.
    const openers = new Map<string, number>();
    exp.bullets.forEach((bullet, b) => {
      out.push(
        ...bulletIssues(
          bullet.text,
          pointer("experience", i, "bullets", b, "text"),
          `${exp.company || "Experience"}, bullet ${b + 1}`,
          openers,
        ),
      );
    });
  });

  doc.projects.forEach((proj, i) => {
    const openers = new Map<string, number>();
    proj.bullets.forEach((bullet, b) => {
      out.push(
        ...bulletIssues(
          bullet.text,
          pointer("projects", i, "bullets", b, "text"),
          `${proj.name || "Project"}, bullet ${b + 1}`,
          openers,
        ),
      );
    });
  });

  return out.sort((a, b) => b.weight - a.weight);
}

/**
 * One card per line, not one per rule.
 *
 * A bullet with no outcome and no mechanism is one rewrite, and showing it
 * twice would have the user fix it, watch the second card stay, and lose
 * confidence in all of them.
 */
export type LineIssues = { path: string; where: string; text: string; issues: Issue[]; weight: number };

export function groupByLine(issues: Issue[]): LineIssues[] {
  const byPath = new Map<string, LineIssues>();

  for (const issue of issues) {
    const existing = byPath.get(issue.path);
    if (existing) {
      existing.issues.push(issue);
      existing.weight += issue.weight;
      continue;
    }
    byPath.set(issue.path, {
      path: issue.path,
      where: issue.where,
      text: issue.text,
      issues: [issue],
      weight: issue.weight,
    });
  }

  return [...byPath.values()].sort((a, b) => b.weight - a.weight);
}
