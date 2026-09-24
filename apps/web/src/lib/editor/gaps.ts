/**
 * What the posting asks for, what each answer is worth, and where it should go.
 *
 * The chips this feeds used to say two things: the term, and whether it was
 * already yours. That is the honest half of the problem and none of the useful
 * half. A required skill named three times in the posting looked exactly like a
 * nice-to-have named once, "+ gRPC" said nothing about what clicking it would
 * do, and every term landed in the skills list, which is the weakest place on
 * the page for a term to sit.
 *
 * So this module answers four questions per term, all of them from data that
 * already exists:
 *
 *   importance   `requirements[].importance` on the JobSpec. Required first.
 *   weight       `keywords[].weight`, 1 to 5, straight from the posting.
 *   delta        `computeAtsReport` applied to a copy of the document, minus
 *                the score now. The scorer is pure, deterministic and instant,
 *                so a projection here is arithmetic rather than a promise.
 *   placement    The skills list always. For a term the original resume
 *                already states in a bullet the rewrite dropped, also that
 *                bullet, verbatim, with its source id.
 *
 * Two lines hold everything else up, and neither is negotiable:
 *
 *   1. The green and amber split survives. `recoverable` is a term the parsed
 *      resume already claims, so putting it back asserts nothing new.
 *      `missing` is the user's own assertion and is counted as a hand edit.
 *      They are never merged into one list of "suggested keywords".
 *
 *   2. With no posting there are no suggestions. Not a fallback posting, not a
 *      fixture, not a guess. The editor scored a frontend resume against an
 *      invented payments role once and told the candidate to add Terraform.
 *      `job === null` returns `[]` here, and that is the whole handling.
 *
 * Pure. No React, no I/O, no clock, no randomness.
 */

import {
  computeAtsReport,
  contains,
  normalise,
  resumeTextOf,
  type AtsReport,
  type GapAnalysis,
  type ImportanceValue,
  type JobSpec,
  type MissingItem,
  type Op,
  type ResumeFacts,
} from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import { addSkillOps, applyDocPatch, pointer, tailoredOf } from "./doc";

/* --------------------------------------------------------------- types -- */

export type SuggestionKind = "recoverable" | "missing";

export type PlacementKind = "skills" | "bullet";

/**
 * One place a term could go, with the ops that would put it there.
 *
 * `traced` is not decoration. A restored bullet arrives carrying the id of the
 * fact it came from, so the provenance badge keeps counting it as traced to
 * the resume. A term typed into the skills list because the user asserts it
 * carries nothing, and the badge says so.
 */
export type Placement = {
  kind: PlacementKind;
  /** Button text. Short, and it names the destination, not the term. */
  label: string;
  /** What would actually land in the document. */
  preview: string;
  ops: Op[];
  /** Points this placement would move the score by. Null with no posting. */
  delta: number | null;
  /** Whether what lands carries a source id from the parsed resume. */
  traced: boolean;
};

export type Suggestion = {
  term: string;
  kind: SuggestionKind;
  importance: ImportanceValue;
  /** 1 to 5, from the posting. Absent from `keywords` means 1. */
  weight: number;
  /** The best placement's delta in points, or null when there is no posting. */
  delta: number | null;
  /** Skills, plus any bullet that could carry it. Best first. */
  placements: Placement[];
};

/* ------------------------------------------------------------- helpers -- */

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Every spelling of a keyword the scorer would accept. */
function formsOf(job: JobSpec, term: string): string[] {
  const key = normalise(term);
  const keyword = job.keywords.find((k) => normalise(k.term) === key);
  return keyword ? [keyword.term, ...keyword.variants] : [term];
}

function weightOf(job: JobSpec, term: string): number {
  const key = normalise(term);
  const keyword = job.keywords.find((k) => normalise(k.term) === key);
  if (!keyword) return 1;
  return Math.max(1, Math.min(5, keyword.weight || 1));
}

/**
 * Required or preferred, as the posting states it.
 *
 * A term that appears only in `keywords` was never stated as a requirement, so
 * it is reported as preferred rather than promoted to required on a guess.
 */
function importanceOf(job: JobSpec, term: string): ImportanceValue {
  const key = normalise(term);
  const exact = job.requirements.find((r) => normalise(r.term) === key);
  if (exact) return exact.importance;
  const inside = job.requirements.find((r) => contains(term, normalise(r.term)));
  return inside ? inside.importance : "preferred";
}

/** Terms the gap analysis calls blocking. Not an editing task, so not a chip. */
export function blockingGaps(gaps: GapAnalysis | null | undefined): MissingItem[] {
  if (!gaps) return [];
  return gaps.missing.filter((item) => item.severity === "blocking");
}

function isBlocked(term: string, blocked: ReadonlySet<string>): boolean {
  return blocked.has(normalise(term));
}

/* ---------------------------------------------------------- placements -- */

type BulletSite = {
  /** "experience" or "projects". */
  section: "experience" | "projects";
  docIndex: number;
  insertAt: number;
  where: string;
  text: string;
  sourceId: string;
};

/**
 * The original bullet that states this term, when the rewrite dropped it.
 *
 * A parser reads a term in a sentence as evidence and the same term in a
 * comma-separated list as a claim, and the tailoring prompt says as much. So
 * when the candidate's own resume already has a line naming the term, putting
 * that line back beats appending the word to a list.
 *
 * Deliberately narrow. This only ever restores a source bullet verbatim, and
 * only when no line in the document already carries that bullet's id. It never
 * edits prose to work a keyword in, because that would be writing a claim in
 * the candidate's voice that neither they nor the guard approved.
 */
function bulletSites(term: string, facts: ResumeFacts, doc: ResumeDoc): BulletSite[] {
  const sites: BulletSite[] = [];

  const scan = (
    section: "experience" | "projects",
    factGroups: Array<{ id: string; label: string; bullets: Array<{ id: string; text: string }> }>,
    docGroups: Array<{ source_id: string; bullets: Array<{ source_ids: string[] }> }>,
  ) => {
    for (const group of factGroups) {
      const docIndex = docGroups.findIndex((g) => g.source_id === group.id);
      if (docIndex === -1) continue;

      const order = new Map(group.bullets.map((b, i) => [b.id, i]));
      const docBullets = docGroups[docIndex].bullets;
      const taken = new Set(docBullets.flatMap((b) => b.source_ids));

      group.bullets.forEach((bullet, bulletIndex) => {
        if (!contains(term, normalise(bullet.text))) return;
        if (taken.has(bullet.id)) return;

        // Put it back where it was: after every line already standing that
        // came from an earlier bullet of the same role.
        const insertAt = docBullets.filter((b) => {
          const positions = b.source_ids
            .map((id) => order.get(id))
            .filter((i): i is number => i !== undefined);
          return positions.length > 0 && Math.min(...positions) < bulletIndex;
        }).length;

        sites.push({
          section,
          docIndex,
          insertAt,
          where: group.label,
          text: bullet.text,
          sourceId: bullet.id,
        });
      });
    }
  };

  scan(
    "experience",
    facts.experience.map((e) => ({ id: e.id, label: e.company, bullets: e.bullets })),
    doc.experience,
  );
  scan(
    "projects",
    facts.projects.map((p) => ({ id: p.id, label: p.name, bullets: p.bullets })),
    doc.projects,
  );

  return sites;
}

function bulletOps(site: BulletSite, term: string): Op[] {
  return [
    {
      op: "add",
      path: pointer(site.section, site.docIndex, "bullets", site.insertAt),
      value: { text: site.text, source_ids: [site.sourceId], keywords: [term] },
      source_ids: [site.sourceId],
      rationale: `Restored the ${site.where} line your resume already states, which names ${term}.`,
    },
  ];
}

/* ------------------------------------------------------------- scoring -- */

/**
 * What these ops would do to the score, in points.
 *
 * Applied to a copy and scored with the same pure function the header uses,
 * then subtracted. Nothing is estimated and nothing is cached: the ops that
 * produce the number are the ops the button will apply.
 */
export function deltaOf(
  job: JobSpec | null,
  facts: ResumeFacts,
  doc: ResumeDoc,
  report: AtsReport | null,
  ops: readonly Op[],
): number | null {
  if (!job || ops.length === 0) return null;
  const base = report ? report.overall : computeAtsReport(job, facts, tailoredOf(doc)).overall;
  let next: ResumeDoc;
  try {
    next = applyDocPatch(doc, ops);
  } catch {
    // An op that will not apply is worth nothing and must not be offered as
    // though it were. The placement is dropped by the caller.
    return null;
  }
  return round1(computeAtsReport(job, facts, tailoredOf(next)).overall - base);
}

/* --------------------------------------------------------- the ranking -- */

/**
 * Required above preferred, then heavier above lighter, then worth more above
 * worth less. The tie-break on the term keeps the order stable, because a list
 * that reshuffles between renders cannot be read.
 */
function compare(a: Suggestion, b: Suggestion): number {
  if (a.importance !== b.importance) return a.importance === "required" ? -1 : 1;
  if (a.weight !== b.weight) return b.weight - a.weight;
  const da = a.delta ?? 0;
  const db = b.delta ?? 0;
  if (da !== db) return db - da;
  return a.term.localeCompare(b.term);
}

export function suggestionsFor(
  job: JobSpec | null,
  facts: ResumeFacts,
  doc: ResumeDoc,
  report: AtsReport | null,
  gaps?: GapAnalysis | null,
): Suggestion[] {
  // No posting, no suggestions. See the header.
  if (!job || !report) return [];

  const blocked = new Set(blockingGaps(gaps).map((item) => normalise(item.jd_term)));
  const docText = resumeTextOf(tailoredOf(doc));

  const build = (term: string, kind: SuggestionKind): Suggestion | null => {
    if (!term.trim()) return null;
    if (isBlocked(term, blocked)) return null;
    // Already on the page in some spelling the scorer accepts. Nothing to add.
    if (formsOf(job, term).some((form) => contains(form, docText))) return null;

    const placements: Placement[] = [];

    /*
      A bullet is only ever offered for a recoverable term. A missing term has,
      by definition, no line in the parsed resume to restore, so there is
      nothing to put back and the only honest option is the list.
    */
    if (kind === "recoverable") {
      for (const site of bulletSites(term, facts, doc)) {
        const ops = bulletOps(site, term);
        const delta = deltaOf(job, facts, doc, report, ops);
        if (delta === null) continue;
        placements.push({
          kind: "bullet",
          label: `Put back the ${site.where} line`,
          preview: site.text,
          ops,
          delta,
          traced: true,
        });
      }
    }

    const skills = addSkillOps(doc, term);
    const skillsDelta = deltaOf(job, facts, doc, report, skills);
    if (skills.length > 0 && skillsDelta !== null) {
      placements.push({
        kind: "skills",
        label: "Add to the skills list",
        preview: term,
        ops: skills,
        delta: skillsDelta,
        traced: false,
      });
    }

    if (placements.length === 0) return null;

    placements.sort((a, b) => {
      const d = (b.delta ?? 0) - (a.delta ?? 0);
      if (d !== 0) return d;
      // Equal points: a line the resume already wrote beats a word in a list.
      if (a.traced !== b.traced) return a.traced ? -1 : 1;
      return 0;
    });

    return {
      term,
      kind,
      importance: importanceOf(job, term),
      weight: weightOf(job, term),
      delta: placements[0].delta,
      placements,
    };
  };

  const out: Suggestion[] = [];
  const seen = new Set<string>();
  const push = (term: string, kind: SuggestionKind) => {
    const key = normalise(term);
    if (seen.has(key)) return;
    seen.add(key);
    const suggestion = build(term, kind);
    if (suggestion) out.push(suggestion);
  };

  // Recoverable first so a term appearing in both lists is treated as the
  // cheaper of the two. It cannot happen today; it costs nothing to be sure.
  for (const term of report.recoverable_keywords) push(term, "recoverable");
  for (const term of report.missing_keywords) push(term, "missing");

  return out.sort(compare);
}

/** The suggestions split the way the panel renders them. */
export function groupByImportance(suggestions: readonly Suggestion[]): {
  required: Suggestion[];
  preferred: Suggestion[];
} {
  return {
    required: suggestions.filter((s) => s.importance === "required"),
    preferred: suggestions.filter((s) => s.importance === "preferred"),
  };
}
