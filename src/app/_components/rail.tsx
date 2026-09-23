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
  children,
}: {
  report: AtsReport;
  truth: TruthReport;
  gaps: GapAnalysis;
  strategy: Strategy;
  editedCount: number;
  rewriteNotes: string[];
  /** Slotted between the verdict and the folds: see the note below. */
  children?: React.ReactNode;
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

      {/* The recoverable and missing lists used to sit here as text. They are
          now the Suggestions panel above, where they can be clicked, and
          repeating them read-only was two lines saying the same thing. */}

      <div className="border-t border-rule pt-3">
        {truth.passed ? (
          <p className="text-[0.8125rem] text-verified">
            <span className="font-mono text-[0.625rem] uppercase tracking-wider">Verified</span>
            <span className="block text-ink-muted">Every line traces to your resume.</span>
          </p>
        ) : (
          <p className="text-[0.8125rem] text-stamp">
            <span className="font-mono text-[0.625rem] uppercase tracking-wider">Unverified</span>
            <span className="block">
              {truth.error_count} line{truth.error_count === 1 ? "" : "s"} could not be traced.
            </span>
          </p>
        )}
        {editedCount > 0 && (
          <p className="mt-1.5 text-[0.8125rem] text-caution">
            {editedCount} edited by you, not checked.
          </p>
        )}
      </div>

      {/* The score and the verification stamp are what you glance at, so they
          stay at the top of the column. Everything that is acted on rather
          than read — the suggested terms, the template — sits directly under
          them, and the long-form judgement stays folded below. Stacking those
          controls above the score instead buried the one number the page is
          for under nine thumbnails. */}
      {children}

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
