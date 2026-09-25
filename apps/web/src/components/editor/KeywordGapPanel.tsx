"use client";

/**
 * What the posting asks for, ranked by what it is worth, with somewhere to put
 * it.
 *
 * This replaces a cloud of undifferentiated chips. A cloud cannot say that one
 * of those words is a stated must-have named three times and the next is a
 * nice-to-have named once, cannot say that clicking the first is worth seven
 * points and the second two, and cannot say that the best home for a term is
 * a line the candidate already wrote rather than the end of a comma list.
 * Four facts, all of them already in the data, none of them previously shown.
 *
 * The one thing carried across unchanged is the colour rule, because it is the
 * only thing on this panel that is about honesty rather than ranking:
 *
 *   green   the parsed resume already claims this term. Putting it back
 *           asserts nothing new, stays traced to the resume, and is free.
 *   amber   the resume says it nowhere. Adding it is the candidate's own
 *           assertion, the guard never checked it, and it counts as a hand
 *           edit for as long as it stays on the page.
 *
 * Blocking gaps are not in the list at all. A blocking gap is a fact about the
 * application, not a button, and offering to type it into a skills list would
 * be offering to lie about it. They sit at the bottom, unclickable, with the
 * reason the analysis gave.
 */

import { useMemo } from "react";
import type { AtsReport, GapAnalysis, JobSpec, ResumeFacts } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import {
  blockingGaps,
  groupByImportance,
  suggestionsFor,
  type Placement,
  type Suggestion,
} from "@/lib/editor/gaps";

export type KeywordGapPanelProps = {
  job: JobSpec | null;
  facts: ResumeFacts;
  doc: ResumeDoc;
  report: AtsReport | null;
  gaps: GapAnalysis | null;
  /** Apply one placement of one suggestion. The panel never mutates anything. */
  onApply: (suggestion: Suggestion, placement: Placement) => void;
};

/* ---------------------------------------------------------------- bits -- */

function points(delta: number | null): string {
  if (delta === null) return "";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}`;
}

/**
 * How hard the posting leans on this term, 1 to 5, as five hairlines.
 *
 * A number would have to compete with the points figure beside it, and the
 * points figure is the one worth reading. This is peripheral by design: you
 * see the shape of the column without stopping on any row.
 */
function Weight({ weight }: { weight: number }) {
  return (
    <span
      className="inline-flex items-end gap-px"
      role="img"
      aria-label={`Weighted ${weight} of 5 in the posting`}
    >
      {[1, 2, 3, 4, 5].map((step) => (
        <span
          key={step}
          aria-hidden="true"
          className={`w-[2px] rounded-[1px] ${
            step <= weight ? "bg-ink-faint" : "bg-rule"
          }`}
          style={{ height: `${3 + step}px` }}
        />
      ))}
    </span>
  );
}

function Row({
  suggestion,
  onApply,
}: {
  suggestion: Suggestion;
  onApply: (suggestion: Suggestion, placement: Placement) => void;
}) {
  const recoverable = suggestion.kind === "recoverable";
  const [primary, ...rest] = suggestion.placements;

  return (
    <li className="border-t border-rule/70 py-1.5 first:border-t-0">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onApply(suggestion, primary)}
          data-kind={suggestion.kind}
          data-placement={primary.kind}
          title={
            recoverable
              ? `Your resume already claims this, putting it back is free. ${primary.label}.`
              : `Not in your resume, add only if you can defend it. ${primary.label}.`
          }
          className={`inline-flex min-w-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.75rem] transition-colors ${
            recoverable
              ? "border-traced/40 bg-traced-soft text-traced hover:border-traced"
              : "border-caution/40 bg-caution-soft text-caution hover:border-caution"
          }`}
        >
          <span aria-hidden="true" className="font-mono text-[0.625rem] leading-none">
            +
          </span>
          <span className="truncate">{suggestion.term}</span>
        </button>

        <Weight weight={suggestion.weight} />

        <span
          className="ml-auto shrink-0 font-mono text-[0.6875rem] tabular-nums text-ink"
          aria-label={`Worth ${points(suggestion.delta)} points`}
        >
          {points(suggestion.delta)}
          <span className="text-ink-faint"> pts</span>
        </span>
      </div>

      {/*
        Where it lands, and the alternative.

        A term in a sentence reads as evidence; the same term in a list reads
        as a claim, and every parser weights it that way. So when the original
        resume has a line that already states the term, that line is offered
        beside the list, verbatim, carrying the source id it came with. It is
        never rewritten to work the term in: that would be writing a claim in
        the candidate's voice that nobody checked.
      */}
      <p className="mt-0.5 pl-0.5 text-[0.6875rem] leading-snug text-ink-faint">
        {primary.kind === "bullet" ? (
          <>Lands in a line you already wrote: {`"${primary.preview.slice(0, 44).trim()}..."`}</>
        ) : (
          <>Lands in the skills list.</>
        )}
      </p>

      {rest.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1 pl-0.5">
          {rest.map((placement, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onApply(suggestion, placement)}
              title={placement.kind === "bullet" ? placement.preview : undefined}
              className="inline-flex items-center gap-1.5 rounded-md border border-rule px-1.5 py-0.5 text-[0.6875rem] text-ink-muted transition-colors hover:border-rule-strong hover:text-ink"
            >
              <span>{placement.label}</span>
              <span className="font-mono tabular-nums text-ink-faint">
                {points(placement.delta)}
              </span>
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function Group({
  title,
  note,
  suggestions,
  onApply,
}: {
  title: string;
  note: string;
  suggestions: Suggestion[];
  onApply: (suggestion: Suggestion, placement: Placement) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="mt-3">
      <h3 className="label flex items-baseline gap-2">
        {title}
        <span className="font-mono tabular-nums">{suggestions.length}</span>
        <span className="font-sans text-[0.6875rem] font-normal tracking-normal normal-case text-ink-faint">
          {note}
        </span>
      </h3>
      <ul className="mt-1">
        {suggestions.map((suggestion) => (
          <Row key={suggestion.term} suggestion={suggestion} onApply={onApply} />
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------- panel -- */

export function KeywordGapPanel({
  job,
  facts,
  doc,
  report,
  gaps,
  onApply,
}: KeywordGapPanelProps) {
  /*
    Every figure on this panel is `computeAtsReport` run against a copy of the
    document. It is pure and it is fast, but it is not free, so it runs when
    the document, the posting or the score move and not on every render.
  */
  const suggestions = useMemo(
    () => suggestionsFor(job, facts, doc, report, gaps),
    [job, facts, doc, report, gaps],
  );
  const blocking = useMemo(() => blockingGaps(gaps), [gaps]);
  const { required, preferred } = useMemo(
    () => groupByImportance(suggestions),
    [suggestions],
  );

  if (suggestions.length === 0 && blocking.length === 0) return null;

  return (
    <section aria-labelledby="suggestions-heading" className="border-t border-rule pt-3">
      <h2 id="suggestions-heading" className="label">
        Terms the posting wants
      </h2>

      {/*
        The legend is a disclosure now. As three always-on paragraphs it was
        about four lines of prose between the heading and the first thing
        anybody could click, and it pushed the form below the fold: measured
        at y=1108 in a 900px viewport, so the document was off screen on
        arrival on a laptop.

        It is read once and true forever, which is exactly the content that
        should be available rather than present. The colours still carry the
        meaning on their own, and the one-line summary names it.
      */}
      {suggestions.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer list-none text-[0.75rem] leading-snug text-ink-faint select-none hover:text-ink-muted">
            <span className="text-traced">Green</span> is already yours,{" "}
            <span className="text-caution">amber</span> is your own claim.{" "}
            <span className="underline underline-offset-2">What that means</span>
          </summary>
          <div className="mt-1.5 space-y-0.5">
            <p className="text-[0.75rem] leading-snug text-traced">
              Green is already yours. Your resume claims it, the rewrite dropped it, and
              putting it back stays traced to your resume.
            </p>
            <p className="text-[0.75rem] leading-snug text-caution">
              Amber is not in your resume. Adding one is your own assertion and the guard
              never checked it. It counts as a hand edit.
            </p>
            <p className="text-[0.6875rem] leading-snug text-ink-faint">
              Points are what the score does when the term lands, computed against this
              document, not estimated.
            </p>
          </div>
        </details>
      )}

      <Group
        title="Required"
        note="the posting states these as must-haves"
        suggestions={required}
        onApply={onApply}
      />
      <Group
        title="Preferred"
        note="nice to have, or named only in passing"
        suggestions={preferred}
        onApply={onApply}
      />

      {blocking.length > 0 && (
        <div className="mt-3.5 rounded-md border border-rule bg-paper-sunk/60 px-2.5 py-2">
          <h3 className="label flex items-baseline gap-2">
            Not an editing task
            <span className="font-mono tabular-nums">{blocking.length}</span>
          </h3>
          <p className="mt-1 text-[0.6875rem] leading-snug text-ink-faint">
            These are gaps in the application, not in the wording. There is no chip for
            them, because typing one into a list would not make it true.
          </p>
          <ul className="mt-1.5 space-y-1">
            {blocking.map((item, i) => (
              <li key={i} className="text-[0.75rem] leading-snug text-ink-muted">
                <span className="text-ink">{item.jd_term}</span>
                <span className="font-mono text-[0.625rem] tracking-wider uppercase text-ink-faint">
                  {" "}
                  {item.severity}
                </span>
                {item.note && <span className="block">{item.note}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
