/**
 * Finding the fact a refused line was supposed to have come from.
 *
 * When the guard rejects a line, the useful thing to show is not the error
 * code. It is the sentence in the original resume that the rewrite was
 * supposed to be a faithful version of, set next to what the model actually
 * wrote. That comparison is the entire argument for trusting the rest of the
 * page, so it has to be a real lookup rather than a plausible-looking string.
 *
 * The chain is: violation location -> the line at that location in the
 * document -> its `source_ids` -> the fact carrying that id. When any link is
 * missing the answer is null, and the dialog says it could not locate the
 * source rather than showing something that reads like one.
 */

import type { ResumeFacts, TruthViolation } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";

export type SourceFact = {
  id: string;
  text: string;
  /** Where in the original resume it sits, in words a person can check. */
  label: string;
};

/** Every fact in the parsed resume, by the id the guard cites. */
export function factIndex(facts: ResumeFacts): Map<string, SourceFact> {
  const index = new Map<string, SourceFact>();
  const put = (id: string, text: string, label: string) => {
    if (id && text) index.set(id, { id, text, label });
  };

  put("SUMMARY", facts.summary, "Summary of your original resume");
  for (const exp of facts.experience) {
    const where = `${exp.title}, ${exp.company}`;
    put(exp.id, exp.bullets.map((b) => b.text).join(" "), where);
    for (const bullet of exp.bullets) put(bullet.id, bullet.text, where);
  }
  for (const proj of facts.projects) {
    put(proj.id, proj.description, `Project: ${proj.name}`);
    for (const bullet of proj.bullets) put(bullet.id, bullet.text, `Project: ${proj.name}`);
  }
  for (const group of facts.skills) {
    put(group.id, group.items.join(", "), `Skills, ${group.category}`);
  }
  for (const cert of facts.certifications) put(cert.id, cert.text, "Certifications");
  for (const section of facts.other_sections) {
    for (const bullet of section.bullets) put(bullet.id, bullet.text, section.heading);
  }
  for (const edu of facts.education) {
    put(edu.id, `${edu.degree}, ${edu.institution}, ${edu.dates}`, "Education");
  }
  return index;
}

/**
 * The `source_ids` carried by the line the violation names.
 *
 * Locations are the strings `allLines()` in `@ats/core` produces, which is why
 * they are parsed here rather than guessed at: "Summary", "Skills / Languages",
 * "Experience / Meridian Payments / bullet 3", "Project / Queuewatch / bullet 1",
 * and "<heading> / bullet N" for anything else.
 */
export function sourceIdsAt(doc: ResumeDoc, location: string): string[] {
  const parts = location.split("/").map((p) => p.trim());

  if (parts[0] === "Summary" && parts.length === 1) return doc.summary.source_ids;

  if (parts[0] === "Skills" && parts[1]) {
    return doc.skills.find((g) => g.category === parts[1])?.source_ids ?? [];
  }

  const bulletNumber = Number((parts[2] ?? "").replace(/^bullet\s*/, ""));
  if (!Number.isFinite(bulletNumber) || bulletNumber < 1) return [];
  const at = bulletNumber - 1;

  if (parts[0] === "Experience") {
    return doc.experience.find((e) => e.company === parts[1])?.bullets[at]?.source_ids ?? [];
  }
  if (parts[0] === "Project") {
    return doc.projects.find((p) => p.name === parts[1])?.bullets[at]?.source_ids ?? [];
  }
  return doc.other_sections.find((s) => s.heading === parts[0])?.bullets[at]?.source_ids ?? [];
}

/** The fact a refused line should have been traceable to, or null. */
export function resolveSource(
  doc: ResumeDoc,
  facts: ResumeFacts,
  violation: TruthViolation,
): SourceFact | null {
  const index = factIndex(facts);
  for (const id of sourceIdsAt(doc, violation.location)) {
    const found = index.get(id);
    if (found) return found;
  }
  return null;
}

/**
 * Plain English for a violation code.
 *
 * Written from the product's side of the table: we refused to write this, and
 * here is the rule we refused under. None of them say the app failed, because
 * it did not. Refusing is the feature.
 */
export const REFUSAL_REASON: Record<string, string> = {
  UNSOURCED_METRIC:
    "A number appeared that your resume does not support. We will not invent a figure, or round one up, because it is the first thing an interviewer checks.",
  UNSOURCED_TECH:
    "A tool or technology was named that appears nowhere in your resume. Claiming it would be your claim, not something we can trace.",
  UNSOURCED_LINE:
    "The line could not be traced back to anything in your resume, so we refused to keep it.",
  UNKNOWN_SOURCE_ID:
    "The line cited a fact that does not exist in your parsed resume. A citation that does not resolve is not a citation.",
  ALTERED_EMPLOYER_FACT:
    "A company, title or date was changed. Employment history is the fastest thing to verify, so it is never rewritten.",
  DUPLICATED_METRIC:
    "The same figure was reused for a second achievement. One result, one number.",
  UNSUPPORTED_CLAIM:
    "The claim goes further than your resume does. We keep the strength of the original, not more than it.",
};

/** A question the user can answer to make the line truthful. */
export function repairQuestion(violation: TruthViolation, source: SourceFact | null): string {
  const where = source ? ` ${source.label}.` : "";
  switch (violation.code) {
    case "UNSOURCED_METRIC":
      return `What is the real figure for this line?${where} Give me the number and I will write the line around it.`;
    case "UNSOURCED_TECH":
      return `Did you actually use this, and where?${where} If you did, tell me what you built with it and I will add a line you can defend.`;
    case "ALTERED_EMPLOYER_FACT":
      return "What is the exact company, title and date range? I will put the original back.";
    default:
      return `What in your experience backs this up?${where} Tell me and I will rewrite the line from that.`;
  }
}
