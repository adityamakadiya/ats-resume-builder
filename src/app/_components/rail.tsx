"use client";

import type { AtsReport, GapAnalysis, Strategy, TruthReport } from "@/lib/backend";

/**
 * Everything that is not the resume.
 *
 * The document is the product; this is reference. So it stays narrow, drops the
 * explanatory prose that belonged on a results page, and keeps the long-form
 * judgement folded away behind disclosure triangles. What stays open is only
 * what changes what you would type next: the score, the terms you are missing,
 * and whether the draft verified.
 */

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[0.75rem] text-ink-muted">{label}</span>
        <span className="font-mono text-[0.6875rem] tabular-nums text-ink">
          {Math.round(value)}
        </span>
      </div>
      <div className="mt-1 h-px w-full bg-paper-sunk">
        <div className="draw h-px bg-ink" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

function Fold({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="border-t border-rule pt-3">
      <summary className="label cursor-pointer select-none list-none hover:text-ink">
        {title}
      </summary>
      <div className="mt-2.5 space-y-2 text-[0.8125rem] leading-snug text-ink-muted">
        {children}
      </div>
    </details>
  );
}

const VERDICT: Record<string, string> = {
  yes: "Apply",
  yes_with_caveats: "Apply, with caveats",
  probably_not: "Probably not",
};

export function Rail({
  report,
  truth,
  gaps,
  strategy,
  editedCount,
  rewriteNotes,
}: {
  report: AtsReport;
  truth: TruthReport;
  gaps: GapAnalysis;
  strategy: Strategy;
  editedCount: number;
  rewriteNotes: string[];
}) {
  const tone =
    report.overall >= 75 ? "text-verified" : report.overall >= 55 ? "text-ink" : "text-stamp";

  return (
    <aside className="space-y-4">
      <div>
        <div className="flex items-baseline gap-1.5">
          <span className={`font-display text-5xl leading-none tabular-nums ${tone}`}>
            {Math.round(report.overall)}
          </span>
          <span className="font-mono text-[0.625rem] text-ink-faint">/100</span>
        </div>
        <div className="mt-3 space-y-2">
          <Meter label="Keywords" value={report.sub_scores.keyword_match} />
          <Meter label="Skills" value={report.sub_scores.skills_coverage} />
          <Meter label="Sections" value={report.sub_scores.section_completeness} />
          <Meter label="Experience" value={report.sub_scores.experience_match} />
        </div>
      </div>

      {report.recoverable_keywords.length > 0 && (
        <div className="border-l-2 border-caution bg-caution-soft px-2.5 py-2">
          <p className="font-mono text-[0.625rem] uppercase tracking-wider text-caution">
            Already yours, currently absent
          </p>
          <p className="mt-1 text-[0.8125rem] text-caution">
            {report.recoverable_keywords.join(", ")}
          </p>
        </div>
      )}

      {report.missing_keywords.length > 0 && (
        <div>
          <p className="label mb-1.5">Cannot claim</p>
          <p className="text-[0.8125rem] leading-snug text-ink-muted">
            {report.missing_keywords.slice(0, 12).join(", ")}
          </p>
        </div>
      )}

      <div className="border-t border-rule pt-3">
        {truth.passed ? (
          <p className="text-[0.8125rem] text-verified">
            <span className="font-mono text-[0.625rem] uppercase tracking-wider">Verified</span>
            <span className="block text-ink-muted">
              Every generated line traces to your resume.
            </span>
          </p>
        ) : (
          <p className="text-[0.8125rem] text-stamp">
            <span className="font-mono text-[0.625rem] uppercase tracking-wider">Unverified</span>
            <span className="block">
              {truth.error_count} generated line{truth.error_count === 1 ? "" : "s"} could not be
              traced.
            </span>
          </p>
        )}
        {editedCount > 0 && (
          <p className="mt-1.5 text-[0.8125rem] text-caution">
            {editedCount} line{editedCount === 1 ? "" : "s"} edited by you, not checked.
          </p>
        )}
      </div>

      {!truth.passed && (
        <Fold title="What failed">
          <ul className="space-y-2">
            {truth.violations.map((v, i) => (
              <li key={i}>
                <span className="font-mono text-[0.625rem] text-stamp">{v.code}</span>
                <span className="block">{v.detail}</span>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      <Fold title={VERDICT[strategy.should_apply] ?? "Should you apply"}>
        <p>{strategy.fit_estimate}</p>
        <p>
          <span className="text-ink">Strength.</span> {strategy.biggest_strength}
        </p>
        <p>
          <span className="text-ink">Gap.</span> {strategy.biggest_gap}
        </p>
        <ul className="list-disc space-y-1 pl-4">
          {strategy.interview_emphasis.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ul>
        <p>
          <span className="text-ink">
            {strategy.cover_letter_worthwhile ? "Cover letter." : "Skip the cover letter."}
          </span>{" "}
          {strategy.cover_letter_rationale}
        </p>
        <p>
          <span className="text-ink">Outreach.</span> {strategy.outreach_angle}
        </p>
      </Fold>

      {gaps.recruiter_concerns.length > 0 && (
        <Fold title="Screener will hesitate on">
          <ul className="list-disc space-y-1 pl-4">
            {gaps.recruiter_concerns.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Fold>
      )}

      {report.recommendations.length > 0 && (
        <Fold title="What to do">
          <ol className="list-decimal space-y-1 pl-4">
            {report.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ol>
        </Fold>
      )}

      {rewriteNotes.length > 0 && (
        <Fold title="What changed">
          <ul className="list-disc space-y-1 pl-4">
            {rewriteNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </Fold>
      )}
    </aside>
  );
}
