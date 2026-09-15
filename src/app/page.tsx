"use client";

import { useState } from "react";
import type {
  AnalyzeError,
  AnalyzeSuccess,
  RenderFidelity,
  RenderMode,
} from "@/lib/api-types";

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

const PRESERVE_LABEL: Record<string, string> = {
  exact: "Your exact file — text swapped in place, formatting untouched",
  visual: "A rebuild that matches your design. Close, but not your original file",
  none: "Plain text carries no formatting, so only the ATS layout is available",
};

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AnalyzeError | null>(null);
  const [result, setResult] = useState<AnalyzeSuccess | null>(null);
  const [showJdPaste, setShowJdPaste] = useState(false);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [fidelity, setFidelity] = useState<RenderFidelity | null>(null);
  const [downloading, setDownloading] = useState<RenderMode | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    setFidelity(null);

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

  async function download(mode: RenderMode) {
    if (!result) return;
    setDownloading(mode);
    setError(null);
    try {
      const body = new FormData();
      body.set(
        "payload",
        JSON.stringify({
          tailored: result.tailored,
          facts: result.facts,
          company: result.job.company,
          mode,
        }),
      );
      // Preservation needs the original bytes; the server keeps no copy.
      if (mode === "preserve" && resumeFile) body.set("resume", resumeFile);

      const res = await fetch("/api/pdf", { method: "POST", body });
      if (!res.ok) {
        setError(await res.json());
        return;
      }
      const header = (k: string) => res.headers.get(k);
      const num = (k: string) => (header(k) ? Number(header(k)) : null);
      const filename =
        header("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "resume.pdf";

      setFidelity({
        mode: header("X-Render-Mode") ?? mode,
        mapped: num("X-Paragraphs-Mapped"),
        rewritten: num("X-Paragraphs-Rewritten"),
        skipped: num("X-Paragraphs-Skipped"),
        unplaced: num("X-Lines-Unplaced"),
        columns: num("X-Columns"),
        convertWarning: header("X-Convert-Warning"),
        filename,
      });

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError({ error: (err as Error).message });
    } finally {
      setDownloading(null);
    }
  }

  const src = result?.source;
  const canPreserve = src ? src.preservable !== "none" : false;

  return (
    <main className="mx-auto max-w-5xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">ATS Resume Builder</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-neutral-600">
          Upload your resume and a job description. Your resume is the only source of material —
          every rewritten line is traced back to something it already said, and anything that
          cannot be traced is reported rather than shipped.
        </p>
      </header>

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5"
      >
        <div>
          <label className="block text-sm font-medium">Your resume</label>
          <input
            type="file"
            name="resume"
            accept=".pdf,.docx,.txt,.md"
            onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
            className="mt-1.5 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-900 file:px-3 file:py-1.5 file:text-sm file:text-white"
          />
          <p className="mt-1 text-xs text-neutral-500">
            <span className="font-medium text-neutral-700">Upload the .docx if you have it</span> —
            we can then keep your exact formatting. From a PDF we can only match the style, because
            a PDF stores positioned text rather than editable paragraphs.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium">Job description URL</label>
          <input
            type="url"
            name="jdUrl"
            placeholder="https://..."
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

      {result && src && (
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
          </Section>

          <Section title="How your file was read">
            <p className="text-sm">
              <span className="font-medium uppercase">{src.kind}</span>
              {src.style ? (
                <span className="text-neutral-600">
                  {" "}
                  · {src.style.columnCount === 1 ? "single column" : `${src.style.columnCount} columns`} ·{" "}
                  {src.style.serif ? "serif" : "sans-serif"} · body {src.style.fontSizes.body}pt
                  {src.style.accentColor ? ` · accent ${src.style.accentColor}` : ""}
                </span>
              ) : null}
            </p>
            <p className="mt-1.5 text-sm text-neutral-700">{PRESERVE_LABEL[src.preservable]}</p>
            {src.notes.map((n, i) => (
              <p key={i} className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                {n}
              </p>
            ))}
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

          <Section title="Download">
            <p className="mb-3 text-sm text-neutral-600">
              Two audiences, two files. Send your own format to a human; upload the ATS layout to a
              portal that parses it mechanically.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => download("preserve")}
                disabled={!canPreserve || downloading !== null || !resumeFile}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                {downloading === "preserve" ? "Rendering…" : "Download in your format"}
              </button>
              <button
                onClick={() => download("optimize")}
                disabled={downloading !== null}
                className="rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
              >
                {downloading === "optimize" ? "Rendering…" : "Download ATS layout"}
              </button>
            </div>
            {!resumeFile && canPreserve && (
              <p className="mt-2 text-xs text-neutral-500">
                Format preservation needs the original file. Re-select it above — the server keeps
                no copy of your resume.
              </p>
            )}
            {!result.truth.passed && (
              <p className="mt-2 text-xs text-red-700">
                Fix the flagged lines before you send this anywhere.
              </p>
            )}

            {fidelity && (
              <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
                <p className="font-medium">Rendered {fidelity.filename}</p>
                {fidelity.mode === "preserve-exact" && (
                  <p className="mt-1">
                    {fidelity.rewritten} of {fidelity.mapped} matched paragraphs rewritten in place.
                    {fidelity.skipped ? ` ${fidelity.skipped} skipped (tables are left alone).` : ""}
                    {fidelity.unplaced
                      ? ` ${fidelity.unplaced} rewritten line(s) had no home paragraph and were left out — usually one original bullet split into two.`
                      : ""}
                  </p>
                )}
                {fidelity.mode === "preserve-visual" && (
                  <p className="mt-1">
                    Rebuilt from your measured style
                    {fidelity.columns ? ` in ${fidelity.columns} column(s)` : ""}. This matches your
                    design; it is not your original file.
                  </p>
                )}
                {fidelity.convertWarning && (
                  <p className="mt-1.5 text-amber-800">{fidelity.convertWarning}</p>
                )}
              </div>
            )}
          </Section>
        </div>
      )}
    </main>
  );
}
