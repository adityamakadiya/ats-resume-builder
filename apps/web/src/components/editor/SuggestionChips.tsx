"use client";

/**
 * Two lists that look similar and mean opposite things.
 *
 * `recoverable_keywords` are terms the original resume already claims and the
 * rewrite dropped. Putting one back adds nothing the candidate was not already
 * saying, so it is offered plainly, in the traced colour, and costs them
 * nothing.
 *
 * `missing_keywords` appear nowhere in the resume. They are shown rather than
 * hidden, because a gap you cannot see is a gap you cannot answer for in the
 * room. But adding one is the user asserting something, so it is styled as a
 * caution, worded as a warning, and counted as a hand edit that the traced
 * badge will keep reporting for as long as it stays.
 *
 * Collapsing these into one list of "suggested keywords" would turn this panel
 * into a fabrication button. They stay apart.
 */

import type { AtsReport } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";

export type SuggestionChipsProps = {
  report: AtsReport;
  doc: ResumeDoc;
  onAdd: (term: string, kind: "recoverable" | "missing") => void;
};

function Chip({
  term,
  kind,
  onAdd,
}: {
  term: string;
  kind: "recoverable" | "missing";
  onAdd: () => void;
}) {
  const recoverable = kind === "recoverable";
  return (
    <button
      type="button"
      onClick={onAdd}
      data-kind={kind}
      title={
        recoverable
          ? "Your resume already claims this, putting it back is free."
          : "Not in your resume, add only if you can defend it."
      }
      className={`inline-flex items-center gap-1 rounded-xs border px-1.5 py-0.5 text-[0.75rem] transition-colors ${
        recoverable
          ? "border-traced/40 bg-traced-soft text-traced hover:border-traced"
          : "border-caution/40 bg-caution-soft text-caution hover:border-caution"
      }`}
    >
      <span aria-hidden="true" className="font-mono text-[0.625rem] leading-none">
        +
      </span>
      {term}
    </button>
  );
}

export function SuggestionChips({ report, doc, onAdd }: SuggestionChipsProps) {
  const present = new Set(
    doc.skills.flatMap((g) => g.items.map((i) => i.toLowerCase().trim())),
  );
  const recoverable = report.recoverable_keywords.filter((t) => !present.has(t.toLowerCase()));
  const missing = report.missing_keywords.filter((t) => !present.has(t.toLowerCase()));

  if (recoverable.length === 0 && missing.length === 0) return null;

  return (
    <section aria-labelledby="suggestions-heading" className="border-t border-rule pt-3">
      <h2 id="suggestions-heading" className="label">
        Terms the posting wants
      </h2>

      {recoverable.length > 0 && (
        <div className="mt-2.5">
          <p className="text-[0.75rem] leading-snug text-traced">
            Already yours. Your resume claims these, the rewrite dropped them. Putting one
            back is free.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {recoverable.map((term) => (
              <Chip key={term} term={term} kind="recoverable" onAdd={() => onAdd(term, "recoverable")} />
            ))}
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <div className="mt-3">
          <p className="text-[0.75rem] leading-snug text-caution">
            Not in your resume. Add one only if you can defend it in an interview. It counts
            as a hand edit.
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {missing.slice(0, 14).map((term) => (
              <Chip key={term} term={term} kind="missing" onAdd={() => onAdd(term, "missing")} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
