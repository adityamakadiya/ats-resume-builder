"use client";

import type {
  AtsReport,
  GapAnalysis,
  JobSpec,
  SourceDocument,
  Strategy,
  TailoredResume,
  TruthReport,
} from "@/lib/backend";

/* ------------------------------------------------------------- primitives -- */

export function Panel({
  label,
  children,
  delay = 0,
}: {
  label: string;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <section
      className="rise rule-top pt-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      <h2 className="label mb-4">{label}</h2>
      {children}
    </section>
  );
}

function Bar({ value, tone = "ink" }: { value: number; tone?: "ink" | "stamp" | "verified" }) {
  const color =
    tone === "stamp" ? "bg-stamp" : tone === "verified" ? "bg-verified" : "bg-ink";
  return (
    <div className="h-1 w-full bg-paper-sunk">
      <div
        className={`draw h-1 ${color}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ score -- */

const SUB_LABELS: Record<string, string> = {
  keyword_match: "Keywords",
  skills_coverage: "Skills",
  section_completeness: "Sections",
  experience_match: "Experience",
};

export function ScoreBlock({ report, job }: { report: AtsReport; job: JobSpec }) {
  const tone = report.overall >= 75 ? "verified" : report.overall >= 55 ? "ink" : "stamp";

  return (
    <Panel label="Match">
      <div className="grid gap-8 sm:grid-cols-[auto_1fr] sm:items-start">
        <div>
          <div className="flex items-baseline gap-1.5">
            <span
              className={[
                "font-display text-[5.5rem] leading-[0.8] tabular-nums",
                tone === "verified" ? "text-verified" : tone === "stamp" ? "text-stamp" : "text-ink",
              ].join(" ")}
            >
              {Math.round(report.overall)}
            </span>
            <span className="font-mono text-xs text-ink-faint">/100</span>
          </div>
          <p className="mt-3 max-w-[15rem] text-[0.8125rem] leading-snug text-ink-faint">
            Computed in code, not asked of the model — so it is the same number every run.
          </p>
        </div>

        <dl className="space-y-3.5">
          {Object.entries(report.sub_scores).map(([key, value]) => (
            <div key={key}>
              <div className="mb-1.5 flex items-baseline justify-between">
                <dt className="text-[0.8125rem] text-ink-muted">{SUB_LABELS[key] ?? key}</dt>
                <dd className="font-mono text-xs tabular-nums text-ink">{Math.round(value)}</dd>
              </div>
              <Bar value={value} />
            </div>
          ))}
        </dl>
      </div>

      {job.extraction_confidence !== "high" && (
        <p className="mt-6 border-l-2 border-caution bg-caution-soft px-3 py-2 text-[0.8125rem] text-caution">
          The posting was read with {job.extraction_confidence} confidence.{" "}
          {job.extraction_notes}
        </p>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------ truth -- */

export function TruthBlock({
  truth,
  repairAttempted,
}: {
  truth: TruthReport;
  repairAttempted: boolean;
}) {
  return (
    <Panel label="Verification" delay={60}>
      {truth.passed ? (
        <div className="flex items-start gap-4">
          <span className="mt-0.5 shrink-0 -rotate-6 border-2 border-verified px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-verified">
            Verified
          </span>
          <p className="max-w-prose text-[0.9375rem] leading-relaxed text-ink-muted">
            Every line traces back to your uploaded resume. No invented metrics, technologies or
            employment details.
            {repairAttempted && (
              <span className="text-ink-faint">
                {" "}
                One draft was rejected and rewritten to get here.
              </span>
            )}
          </p>
        </div>
      ) : (
        <div>
          <div className="flex items-start gap-4">
            <span className="mt-0.5 shrink-0 -rotate-6 border-2 border-stamp px-2.5 py-1 font-mono text-[0.625rem] uppercase tracking-[0.18em] text-stamp">
              Unverified
            </span>
            <p className="max-w-prose text-[0.9375rem] leading-relaxed text-ink">
              {truth.error_count} line{truth.error_count === 1 ? "" : "s"} could not be traced to
              your resume. They are listed below — do not send this out as is.
            </p>
          </div>
          <ul className="mt-5 space-y-3">
            {truth.violations.map((v, i) => (
              <li key={i} className="border-l-2 border-stamp bg-stamp-soft px-3 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-mono text-[0.625rem] tracking-wider text-stamp">
                    {v.code}
                  </span>
                  <span className="text-xs text-ink-muted">{v.location}</span>
                </div>
                <p className="mt-1 text-[0.8125rem] text-ink">{v.detail}</p>
                <p className="mt-1 font-mono text-[0.75rem] leading-snug text-ink-muted">
                  &ldquo;{v.offending}&rdquo;
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------------------- gaps -- */

export function GapsBlock({ gaps, report }: { gaps: GapAnalysis; report: AtsReport }) {
  return (
    <Panel label="Gaps" delay={120}>
      {report.recoverable_keywords.length > 0 && (
        <div className="mb-6 border-l-2 border-caution bg-caution-soft px-3 py-2.5">
          <p className="text-[0.8125rem] text-caution">
            <span className="font-medium">Already true, currently missing.</span> Your original
            resume claims these but the rewrite dropped them — the cheapest points available:{" "}
            <span className="font-mono">{report.recoverable_keywords.join(", ")}</span>
          </p>
        </div>
      )}

      <div className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
        <div>
          <h3 className="label mb-2.5">Cannot be claimed truthfully</h3>
          {gaps.missing.length === 0 ? (
            <p className="text-[0.875rem] text-ink-faint">Nothing material missing.</p>
          ) : (
            <ul className="space-y-2.5">
              {gaps.missing.map((m, i) => (
                <li key={i}>
                  <div className="flex items-baseline gap-2">
                    <span className="text-[0.875rem] text-ink">{m.jd_term}</span>
                    <span
                      className={[
                        "font-mono text-[0.625rem] uppercase tracking-wider",
                        m.severity === "blocking" ? "text-stamp" : "text-ink-faint",
                      ].join(" ")}
                    >
                      {m.severity}
                    </span>
                  </div>
                  <p className="text-[0.8125rem] leading-snug text-ink-faint">{m.note}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="label mb-2.5">What a screener will hesitate on</h3>
          <ul className="space-y-2 text-[0.875rem] leading-snug text-ink-muted">
            {gaps.recruiter_concerns.map((c, i) => (
              <li key={i} className="border-l border-rule-strong pl-3">
                {c}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {report.recommendations.length > 0 && (
        <div className="mt-7">
          <h3 className="label mb-2.5">What to do</h3>
          <ol className="space-y-2">
            {report.recommendations.map((r, i) => (
              <li key={i} className="flex gap-3 text-[0.875rem] leading-snug text-ink-muted">
                <span className="font-mono text-xs text-ink-faint">{i + 1}</span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}

/* --------------------------------------------------------------- strategy -- */

const VERDICT: Record<string, { text: string; tone: string }> = {
  yes: { text: "Apply", tone: "text-verified border-verified" },
  yes_with_caveats: { text: "Apply, with caveats", tone: "text-caution border-caution" },
  probably_not: { text: "Probably not", tone: "text-stamp border-stamp" },
};

export function StrategyBlock({ strategy }: { strategy: Strategy }) {
  const verdict = VERDICT[strategy.should_apply] ?? VERDICT.yes_with_caveats;

  return (
    <Panel label="Should you apply" delay={180}>
      <span
        className={`inline-block border px-2.5 py-1 font-mono text-[0.6875rem] uppercase tracking-[0.14em] ${verdict.tone}`}
      >
        {verdict.text}
      </span>
      <p className="mt-4 max-w-prose text-[0.9375rem] leading-relaxed text-ink-muted">
        {strategy.fit_estimate}
      </p>

      <dl className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2">
        <div>
          <dt className="label mb-1.5">Strongest card</dt>
          <dd className="text-[0.875rem] leading-snug text-ink-muted">
            {strategy.biggest_strength}
          </dd>
        </div>
        <div>
          <dt className="label mb-1.5">Biggest gap</dt>
          <dd className="text-[0.875rem] leading-snug text-ink-muted">{strategy.biggest_gap}</dd>
        </div>
        <div>
          <dt className="label mb-1.5">Lead with this in interviews</dt>
          <dd>
            <ul className="space-y-1.5 text-[0.875rem] leading-snug text-ink-muted">
              {strategy.interview_emphasis.map((s, i) => (
                <li key={i} className="border-l border-rule-strong pl-3">
                  {s}
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div className="space-y-5">
          <div>
            <dt className="label mb-1.5">Cover letter</dt>
            <dd className="text-[0.875rem] leading-snug text-ink-muted">
              <span className="text-ink">
                {strategy.cover_letter_worthwhile ? "Worth writing." : "Skip it."}
              </span>{" "}
              {strategy.cover_letter_rationale}
            </dd>
          </div>
          <div>
            <dt className="label mb-1.5">Outreach angle</dt>
            <dd className="text-[0.875rem] leading-snug text-ink-muted">
              {strategy.outreach_angle}
            </dd>
          </div>
        </div>
      </dl>
    </Panel>
  );
}

/* ---------------------------------------------------------------- preview -- */

export function PreviewBlock({ tailored }: { tailored: TailoredResume }) {
  return (
    <Panel label="The rewrite" delay={240}>
      <p className="mb-5 max-w-prose text-[0.8125rem] text-ink-faint">
        Every line shows the facts it was derived from. That trace is what the verification step
        checks.
      </p>

      <div className="space-y-7">
        <div>
          <p className="font-display text-xl leading-tight text-ink">{tailored.headline}</p>
          <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink-muted">
            {tailored.summary.text}
          </p>
        </div>

        {tailored.experience.map((exp) => (
          <div key={exp.source_id}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-rule pb-1.5">
              <span className="text-[0.9375rem] font-medium text-ink">{exp.title}</span>
              <span className="font-mono text-xs text-ink-faint">
                {exp.start_date} — {exp.end_date}
              </span>
            </div>
            <p className="mt-1 text-[0.8125rem] text-ink-muted">
              {[exp.company, exp.location].filter(Boolean).join(" · ")}
            </p>
            <ul className="mt-3 space-y-3">
              {exp.bullets.map((b, i) => (
                <li key={i}>
                  <p className="text-[0.875rem] leading-relaxed text-ink">{b.text}</p>
                  <p className="mt-0.5 font-mono text-[0.625rem] tracking-wider text-ink-faint">
                    ← {b.source_ids.join(" · ") || "no source"}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {tailored.skills.length > 0 && (
          <div>
            <h3 className="label mb-2 border-b border-rule pb-1.5">Skills</h3>
            <dl className="space-y-1.5">
              {tailored.skills.map((g, i) => (
                <div key={i} className="text-[0.875rem] leading-snug">
                  <dt className="inline font-medium text-ink">{g.category}: </dt>
                  <dd className="inline text-ink-muted">{g.items.join(", ")}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      {tailored.rewrite_notes.length > 0 && (
        <details className="mt-7 border-t border-rule pt-4">
          <summary className="label cursor-pointer select-none">What changed and why</summary>
          <ul className="mt-3 space-y-1.5 text-[0.875rem] leading-snug text-ink-muted">
            {tailored.rewrite_notes.map((n, i) => (
              <li key={i} className="border-l border-rule-strong pl-3">
                {n}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

/* ----------------------------------------------------------------- source -- */

export function SourceNote({ source }: { source: SourceDocument }) {
  const s = source.style;
  return (
    <p className="mt-2 font-mono text-[0.6875rem] leading-relaxed text-ink-faint">
      {source.kind.toUpperCase()}
      {s && (
        <>
          {" · "}
          {s.column_count === 1 ? "single column" : `${s.column_count} columns`}
          {" · "}
          {source.page_count}p{s.accent_color && ` · ${s.accent_color}`}
        </>
      )}
    </p>
  );
}
