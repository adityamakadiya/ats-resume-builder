"use client";

/**
 * Everything the product thinks should change, in one place.
 *
 * There are two kinds and they were not comparable, which is why they are
 * tabs rather than one list. A keyword suggestion is "this term is missing
 * or badly placed", and taking it is one click with a known point value. A
 * writing suggestion is "this sentence is weak", and taking it means
 * reading a proposed rewrite and deciding. Interleaving them by points
 * would put a one-click win under a paragraph of prose to read, and the
 * user would stop scrolling before reaching the cheap ones.
 *
 * Keywords lead because they are cheaper and, on most documents, worth
 * more. The count on each tab is what makes that ordering safe: you can
 * see there is writing work waiting without being made to read it first.
 */

import { useMemo, useState } from "react";
import type { AtsReport, GapAnalysis, JobSpec, Op, ResumeFacts } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import { groupByLine, writingIssues } from "@/lib/editor/writing";
import { SuggestionChips } from "./SuggestionChips";
import { WritingCard } from "./WritingCard";

type Tab = "keywords" | "writing";

export function SuggestionsPanel({
  report,
  doc,
  facts,
  job,
  gaps,
  onAddKeyword,
  onApply,
}: {
  report: AtsReport | null;
  doc: ResumeDoc;
  facts: ResumeFacts;
  job: JobSpec | null;
  gaps: GapAnalysis;
  onAddKeyword: (term: string, kind: "recoverable" | "missing") => void;
  onApply: (ops: Op[], label: string, path: string) => void;
}) {
  /*
    Recomputed on every document change, and that is affordable because
    the detector is pure string work with no scoring and no network in it.
    A suggestion list that lags the document by a keystroke is a list that
    tells people to fix things they have already fixed.
  */
  const lines = useMemo(() => groupByLine(writingIssues(doc)), [doc]);

  const keywordCount = report
    ? report.missing_keywords.length + report.recoverable_keywords.length
    : 0;

  const [tab, setTab] = useState<Tab>("keywords");

  return (
    <section aria-label="Suggestions">
      <div role="tablist" aria-label="Suggestion kinds" className="flex gap-1 border-b border-rule">
        <TabButton
          id="keywords"
          active={tab}
          count={keywordCount}
          onClick={setTab}
          label="Keywords"
        />
        <TabButton id="writing" active={tab} count={lines.length} onClick={setTab} label="Writing" />
      </div>

      <div
        role="tabpanel"
        id="panel-keywords"
        aria-labelledby="tab-keywords"
        hidden={tab !== "keywords"}
        className="pt-2"
      >
        <SuggestionChips report={report} doc={doc} onAdd={onAddKeyword} />
      </div>

      <div
        role="tabpanel"
        id="panel-writing"
        aria-labelledby="tab-writing"
        hidden={tab !== "writing"}
        className="pt-2"
      >
        {lines.length === 0 ? (
          <p className="text-[0.8125rem] leading-relaxed text-ink-muted">
            Nothing mechanical left to fix. Every bullet opens on the work, names how it
            worked, and ends on what changed.
          </p>
        ) : (
          <>
            <p className="mb-2 text-[0.75rem] leading-snug text-ink-faint">
              Found by reading your document against the same rules the score uses, so
              fixing one of these moves the number. The rewrite is written on request and
              checked against your resume before you see it.
            </p>
            <ul className="space-y-2">
              {lines.map((line) => (
                <li key={line.path}>
                  <WritingCard
                    line={line}
                    doc={doc}
                    facts={facts}
                    job={job}
                    report={report}
                    onApply={onApply}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function TabButton({
  id,
  active,
  count,
  label,
  onClick,
}: {
  id: Tab;
  active: Tab;
  count: number;
  label: string;
  onClick: (tab: Tab) => void;
}) {
  const selected = active === id;
  return (
    <button
      type="button"
      role="tab"
      id={`tab-${id}`}
      aria-selected={selected}
      aria-controls={`panel-${id}`}
      onClick={() => onClick(id)}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[0.8125rem] transition-colors ${
        selected
          ? "border-stamp font-medium text-ink"
          : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {label}
      <span
        className={`font-mono text-[0.6875rem] tabular-nums ${
          count > 0 ? "text-ink-faint" : "text-ink-faint/50"
        }`}
      >
        {count}
      </span>
    </button>
  );
}
