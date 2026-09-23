"use client";

import type { AtsReport, TailoredResume } from "@/lib/backend";

/**
 * Terms the posting wants, offered for one-click insertion.
 *
 * These are two different things wearing the same shape, and collapsing them
 * would turn this panel into a fabrication button.
 *
 * `recoverable` are terms your own resume already claims that the rewrite
 * dropped. Putting one back is free and completely true, so it is offered
 * plainly and in the affirmative.
 *
 * `missing` are terms that appear nowhere in your resume. The product exists to
 * stop those being added silently, so they are not hidden — a gap you cannot
 * see is a gap you cannot answer for — but adding one is framed as your own
 * assertion, styled differently, and counted as a hand edit the verification
 * stamp explicitly does not cover.
 */

function Chip({
  term,
  tone,
  onAdd,
}: {
  term: string;
  tone: "recover" | "assert";
  onAdd: () => void;
}) {
  const styles =
    tone === "recover"
      ? "border-verified/40 bg-verified-soft text-verified hover:border-verified"
      : "border-rule-strong bg-paper-raised text-ink-muted hover:border-caution hover:text-caution";

  return (
    <button
      type="button"
      onClick={onAdd}
      title={
        tone === "recover"
          ? "Your resume already claims this. Adding it back is free."
          : "Not in your resume. Add it only if you can defend it in an interview."
      }
      className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[0.75rem] transition-colors ${styles}`}
    >
      <span className="font-mono text-[0.625rem] leading-none">+</span>
      {term}
    </button>
  );
}

export function Suggestions({
  report,
  doc,
  onAddSkill,
}: {
  report: AtsReport;
  doc: TailoredResume;
  onAddSkill: (term: string, asserted: boolean) => void;
}) {
  // Anything already on the page is not a suggestion.
  const present = new Set(
    doc.skills.flatMap((g) => g.items.map((i) => i.toLowerCase().trim())),
  );
  const recoverable = report.recoverable_keywords.filter((t) => !present.has(t.toLowerCase()));
  const missing = report.missing_keywords.filter((t) => !present.has(t.toLowerCase()));

  if (!recoverable.length && !missing.length) return null;

  return (
    <div className="space-y-3 border-t border-rule pt-3">
      {recoverable.length > 0 && (
        <div>
          <p className="label mb-1.5 text-verified">Already yours</p>
          <div className="flex flex-wrap gap-1">
            {recoverable.map((term) => (
              <Chip key={term} term={term} tone="recover" onAdd={() => onAddSkill(term, false)} />
            ))}
          </div>
        </div>
      )}

      {missing.length > 0 && (
        <div>
          <p className="label mb-1.5">Not in your resume</p>
          <div className="flex flex-wrap gap-1">
            {missing.slice(0, 14).map((term) => (
              <Chip key={term} term={term} tone="assert" onAdd={() => onAddSkill(term, true)} />
            ))}
          </div>
          <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-faint">
            Your claim, not a verified one. Add only what you can defend.
          </p>
        </div>
      )}
    </div>
  );
}
