"use client";

import { useRef, useState } from "react";
import type { AnalyzeError, AnalyzeSuccess } from "@/lib/api-types";

const scoreTone = (n: number) =>
  n >= 80 ? "text-emerald-700" : n >= 60 ? "text-amber-700" : "text-red-700";

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2.5">
      <div className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${scoreTone(value)}`}>
        {Math.round(value)}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-700">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AnalyzeError | null>(null);
  const [result, setResult] = useState<AnalyzeSuccess | null>(null);
  const [showJdPaste, setShowJdPaste] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        body: new FormData(e.currentTarget),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data as AnalyzeError);
        if ((data as AnalyzeError).needsJdPaste) setShowJdPaste(true);
      } else {
        setResult(data as AnalyzeSuccess);
      }
    } catch (err) {
      setError({ error: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    if (!result) return;
    const res = await fetch("/api/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tailored: result.tailored,
        facts: result.facts,
        company: result.job.company,
      }),
    });
    if (!res.ok) {
      setError(await res.json());
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "resume.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">ATS Resume Builder</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-neutral-600">
          Upload your resume and a job description. Every rewritten line is traced back to
          something your resume already said, and lines that cannot be traced are reported rather
          than shipped.
        </p>
      </header>

      <form ref={formRef} onSubmit={onSubmit} className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5">
        <div>
          <label className="block text-sm font-medium">Your resume</label>
          <input
            type="file"
            name="resume"
            accept=".pdf,.docx,.txt,.md"
            className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:text-white"
          />
          <p className="mt-1 text-xs text-neutral-500">
            PDF, DOCX, TXT or Markdown. Text-based files only — a scanned PDF has no text to read.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium">Job description URL</label>
          <input
            type="url"
            name="jdUrl"
            placeholder="https://www.naukri.com/job-listings-..."
            className="mt-1.5 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => setShowJdPaste((v) => !v)}
            className="mt-1.5 text-xs text-neutral-600 underline underline-offset-2"
          >
            {showJdPaste ? "Hide" : "Or paste the job description instead"}
          </button>
        </div>

        {showJdPaste && (
          <div>
            <label className="block text-sm font-medium">Job description text</label>
            <textarea
              name="jdText"
              rows={8}
              placeholder="Paste the full posting — requirements, responsibilities, everything."
              className="mt-1.5 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Analysing — this takes a minute or two…" : "Analyse and tailor"}
        </button>
      </form>

      {error && (
        <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-medium">{error.error}</p>
          {error.hint && <p className="mt-1.5 text-red-800">{error.hint}</p>}
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-5">
          <Section title={`Match — ${result.job.title} at ${result.job.company}`}>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
              <Metric label="ATS score" value={result.report.atsScore} />
              <Metric label="Keywords" value={result.report.keywordMatchPct} />
              <Metric label="Tech skills" value={result.report.technicalSkillMatch} />
              <Metric label="Experience" value={result.report.experienceMatch} />
              <Metric label="Responsibilities" value={result.report.responsibilityMatch} />
              <Metric label="Recruiter appeal" value={result.report.recruiterAppeal} />
            </div>
            <p className="mt-3 text-xs text-neutral-500">
              An expert estimate of how this resume performs through a keyword screen and a
              recruiter&apos;s first pass. It is not a reading from any commercial ATS product.
            </p>
            {result.job.extractionConfidence !== "high" && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Job description read with {result.job.extractionConfidence} confidence.
                {result.job.extractionNotes ? ` ${result.job.extractionNotes}` : ""}
              </p>
            )}
          </Section>

          <Section title="Truthfulness check">
            {result.truth.passed ? (
              <p className="text-sm text-emerald-800">
                Every line traces back to your uploaded resume. No invented metrics, technologies,
                or employment details.
                {result.repairAttempted && " (One draft was rejected and rewritten to get here.)"}
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm text-red-800">
                  {result.truth.errorCount} line(s) could not be traced to your resume. They are
                  listed below so you can correct or remove them — do not send this out as is.
                </p>
                <ul className="space-y-1.5 text-xs">
                  {result.truth.violations.map((v, i) => (
                    <li key={i} className="rounded-md bg-red-50 px-3 py-2 text-red-900">
                      <span className="font-mono text-[10px] font-semibold">{v.code}</span>{" "}
                      <span className="text-red-700">{v.location}</span>
                      <div className="mt-0.5">{v.detail}</div>
                      <div className="mt-0.5 italic opacity-80">&ldquo;{v.offending}&rdquo;</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section title="Gaps">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-500">
                  Missing — cannot be claimed truthfully
                </h3>
                <ul className="mt-1.5 space-y-1 text-sm">
                  {result.gaps.missing.map((m, i) => (
                    <li key={i}>
                      <span className="font-medium">{m.jdTerm}</span>{" "}
                      <span className="text-xs text-neutral-500">({m.severity})</span>
                      <div className="text-xs text-neutral-600">{m.note}</div>
                    </li>
                  ))}
                  {result.gaps.missing.length === 0 && (
                    <li className="text-sm text-neutral-500">Nothing material missing.</li>
                  )}
                </ul>
              </div>
              <div>
                <h3 className="text-xs font-semibold uppercase text-neutral-500">
                  Recruiter concerns
                </h3>
                <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-neutral-700">
                  {result.gaps.recruiterConcerns.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            </div>
          </Section>

          <Section title="What moved the match">
            <ol className="list-decimal space-y-1.5 pl-4 text-sm text-neutral-700">
              {result.report.topImprovements.map((t, i) => (
                <li key={i}>
                  <span className="font-medium">{t.change}</span> — {t.impact}
                </li>
              ))}
            </ol>
          </Section>

          <Section title="Should you apply">
            <p className="text-sm">
              <span className="font-semibold">
                {result.strategy.shouldApply.replace(/_/g, " ")}
              </span>{" "}
              — {result.strategy.fitEstimate}
            </p>
            <dl className="mt-3 space-y-2 text-sm">
              <div>
                <dt className="text-xs font-semibold uppercase text-neutral-500">Biggest strength</dt>
                <dd>{result.strategy.biggestStrength}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-neutral-500">Biggest gap</dt>
                <dd>{result.strategy.biggestGap}</dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-neutral-500">
                  Emphasise in interviews
                </dt>
                <dd>
                  <ul className="list-disc pl-4">
                    {result.strategy.interviewEmphasis.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-neutral-500">Cover letter</dt>
                <dd>
                  {result.strategy.coverLetterWorthwhile ? "Worth writing" : "Skip it"} —{" "}
                  {result.strategy.coverLetterRationale}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-semibold uppercase text-neutral-500">Outreach angle</dt>
                <dd>{result.strategy.outreachAngle}</dd>
              </div>
            </dl>
          </Section>

          <div className="flex items-center gap-3">
            <button
              onClick={downloadPdf}
              className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            >
              Download ATS PDF
            </button>
            {!result.truth.passed && (
              <span className="text-xs text-red-700">
                Fix the flagged lines before you send this anywhere.
              </span>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
