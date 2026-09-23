"use client";

/**
 * The number, and what it is made of.
 *
 * Computed in this process by `computeBreakdown`, which is a pure function of
 * the posting, the parsed facts and the document. No request, no cache, no
 * loading state: the numeral moves while you are still holding the key down.
 * That is worth the pixels because a score you have to wait for is a score you
 * stop trusting, and one you can move by typing teaches you what moves it.
 *
 * The delta only appears when the number actually changes, and it leaves after
 * a few seconds. A pill that is permanently on screen reading +0.0 is noise.
 */

import { useEffect, useRef, useState } from "react";
import type { AtsReport, ScoreBreakdownV2 } from "@ats/core";

function Bar({ label, value, hint }: { label: string; value: number; hint: string }) {
  const width = Math.max(0, Math.min(100, value));
  return (
    <div className="group/bar">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[0.75rem] text-ink-muted" title={hint}>
          {label}
        </span>
        <span className="font-mono text-[0.6875rem] tabular-nums text-ink">
          {value.toFixed(0)}
        </span>
      </div>
      <div className="mt-1 h-px w-full bg-paper-sunk">
        <div
          className="h-px bg-ink transition-[width] duration-300 ease-out"
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

export function ScoreCard({
  report,
  breakdown,
}: {
  report: AtsReport;
  breakdown: ScoreBreakdownV2;
}) {
  const overall = report.overall;
  const [delta, setDelta] = useState<number | null>(null);
  const previous = useRef(overall);

  useEffect(() => {
    const moved = Math.round((overall - previous.current) * 10) / 10;
    previous.current = overall;
    if (moved === 0) return;
    setDelta(moved);
    const timer = setTimeout(() => setDelta(null), 2600);
    return () => clearTimeout(timer);
  }, [overall]);

  const tone =
    overall >= 75 ? "text-traced" : overall >= 55 ? "text-ink" : "text-stamp";

  return (
    <section aria-labelledby="score-heading">
      <h2 id="score-heading" className="label">
        ATS score
      </h2>

      <div className="mt-1 flex items-baseline gap-2">
        <output
          aria-live="polite"
          aria-label={`ATS score ${overall.toFixed(1)} out of 100`}
          className={`font-display text-[3.75rem] leading-[0.85] tabular-nums ${tone}`}
        >
          {overall.toFixed(0)}
        </output>
        <span className="font-mono text-[0.625rem] text-ink-faint">/100</span>

        {delta !== null && (
          <span
            className={`rise ml-auto rounded-xs border px-1.5 py-0.5 font-mono text-[0.6875rem] tabular-nums ${
              delta > 0
                ? "border-traced/40 bg-traced-soft text-traced"
                : "border-stamp/40 bg-stamp-soft text-stamp"
            }`}
          >
            {delta > 0 ? "+" : ""}
            {delta.toFixed(1)}
          </span>
        )}
      </div>

      <p className="mt-2 text-[0.75rem] leading-snug text-ink-faint">
        Computed here from the posting, not fetched. It moves as you type.
      </p>

      <div className="mt-4 space-y-2.5">
        <Bar
          label="Keyword coverage"
          value={breakdown.keyword_coverage}
          hint="Weighted terms from the posting that appear in the document."
        />
        <Bar
          label="Requirements met"
          value={breakdown.requirement_coverage}
          hint="Stated must-haves a screener checks first."
        />
        <Bar
          label="Evidence"
          value={breakdown.evidence_density}
          hint="Bullets that end in a result rather than a duty."
        />
        <Bar
          label="Specificity"
          value={breakdown.specificity}
          hint="Bullets that name the mechanism, not just the outcome."
        />
        <Bar
          label="Experience match"
          value={breakdown.experience_match}
          hint="Years shown against years asked for."
        />
      </div>

      {breakdown.penalty.total > 0 && (
        <p className="mt-3 border-t border-rule pt-2 font-mono text-[0.6875rem] text-stamp">
          -{breakdown.penalty.total.toFixed(1)} padding
          <span className="mt-0.5 block font-sans text-[0.75rem] leading-snug text-ink-faint">
            {breakdown.penalty.notes.slice(0, 2).join("; ")}
          </span>
        </p>
      )}
    </section>
  );
}
