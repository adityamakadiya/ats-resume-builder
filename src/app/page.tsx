"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  checkHealth,
  fetchJd,
  parseResume,
  renderPdf,
  tailor,
  type ParseResponse,
  type TailorResponse,
} from "@/lib/backend";
import { STEPS, Stepper, useElapsed, type StepState } from "./_components/steps";
import {
  GapsBlock,
  PreviewBlock,
  ScoreBlock,
  SourceNote,
  StrategyBlock,
  TruthBlock,
} from "./_components/results";

type Phase = "idle" | "working" | "done";

const initialStates = (): Record<string, StepState> =>
  Object.fromEntries(STEPS.map((s) => [s.key, "waiting" as StepState]));

export default function Home() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [states, setStates] = useState(initialStates);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const elapsed = useElapsed(startedAt);

  const [file, setFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [jdUrl, setJdUrl] = useState("");
  const [jdText, setJdText] = useState("");
  const [showPaste, setShowPaste] = useState(false);

  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [result, setResult] = useState<TailorResponse | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [renderWarnings, setRenderWarnings] = useState<string[]>([]);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [totalSeconds, setTotalSeconds] = useState<number | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  // Rendered during step 4 so the download is instant, not another wait.
  const pdfRef = useRef<{ blob: Blob; filename: string } | null>(null);

  useEffect(() => {
    checkHealth()
      .then((h) => setBackendUp(h.api_key_configured))
      .catch(() => setBackendUp(false));
  }, []);

  const mark = useCallback((key: string, state: StepState) => {
    setStates((prev) => ({ ...prev, [key]: state }));
  }, []);

  async function run(event: React.FormEvent) {
    event.preventDefault();
    if (phase === "working") return;

    setPhase("working");
    setStates(initialStates());
    setError(null);
    setResult(null);
    setParsed(null);
    setRenderWarnings([]);
    setTotalSeconds(null);
    const began = Date.now();
    setStartedAt(began);

    try {
      /* 1 — the resume. Its own call so the wait is attributable. */
      mark("parse", "active");
      const parseResult = await parseResume(file ?? resumeText);
      setParsed(parseResult);
      mark("parse", "done");

      /* 2 — the posting. Fast, and the step most likely to fail recoverably. */
      mark("jd", "active");
      const jd = await fetchJd(jdText.trim() ? { text: jdText } : { url: jdUrl });
      if (jd.blocked) {
        mark("jd", "failed");
        setShowPaste(true);
        throw new ApiError(jd.block_reason, 422, true, "Paste the description below and run again.");
      }
      mark("jd", "done");

      /* 3 — the long one. */
      mark("tailor", "active");
      const tailored = await tailor(parseResult.facts, jd.text, jd.source_note);
      setResult(tailored);
      mark("tailor", "done");

      /* 4 — render, so the PDF is ready before the button is pressed. */
      mark("render", "active");
      const pdf = await renderPdf(tailored.tailored, parseResult.facts, tailored.job.company);
      setRenderWarnings(pdf.warnings);
      pdfRef.current = pdf;
      mark("render", "done");

      setTotalSeconds(Math.round((Date.now() - began) / 1000));
      setPhase("done");
      requestAnimationFrame(() =>
        resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    } catch (err) {
      setStates((prev) => {
        const next = { ...prev };
        for (const s of STEPS) if (next[s.key] === "active") next[s.key] = "failed";
        return next;
      });
      const apiError = err instanceof ApiError ? err : null;
      setError({
        message: apiError?.message ?? (err as Error).message,
        hint: apiError?.hint || undefined,
      });
      setPhase("idle");
    } finally {
      setStartedAt(null);
    }
  }

  function download() {
    const pdf = pdfRef.current;
    if (!pdf) return;
    const url = URL.createObjectURL(pdf.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = pdf.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ready = (file !== null || resumeText.trim().length > 200) && (jdUrl.trim() || jdText.trim());

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-14 sm:px-8">
      <header className="rise">
        <p className="label">Resume · one posting · verified</p>
        <h1 className="mt-3 font-display text-[3.25rem] leading-[0.95] tracking-tight text-ink sm:text-[4rem]">
          Tailor without
          <br />
          {/* The italic's overhang eats the following space; pad it back. */}
          <em className="pr-[0.12em] text-stamp">inventing</em> anything.
        </h1>
        <p className="mt-5 max-w-prose text-[0.9375rem] leading-relaxed text-ink-muted">
          Your resume is the only source of material. Every rewritten line is traced back to
          something it already said, and anything that cannot be traced is reported rather than
          shipped.
        </p>
      </header>

      {backendUp === false && (
        <p className="rise mt-8 border-l-2 border-stamp bg-stamp-soft px-3 py-2.5 text-[0.8125rem] text-stamp">
          The backend is not reachable, or has no API key configured. Start it with{" "}
          <span className="font-mono">uvicorn atsresume.api:app --port 8000</span> from{" "}
          <span className="font-mono">backend/</span>.
        </p>
      )}

      {/* ------------------------------------------------------------ form -- */}
      <form onSubmit={run} className="rise mt-12 space-y-8" style={{ animationDelay: "80ms" }}>
        <fieldset disabled={phase === "working"} className="space-y-8 disabled:opacity-60">
          <div>
            <label htmlFor="resume" className="label">
              01 — Your resume
            </label>
            <input
              id="resume"
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-3 block w-full border border-rule-strong bg-paper-raised px-3 py-2.5 text-[0.875rem] file:mr-4 file:border-0 file:bg-ink file:px-3 file:py-1.5 file:font-mono file:text-[0.6875rem] file:uppercase file:tracking-wider file:text-paper-raised hover:border-ink"
            />
            <p className="mt-2 text-[0.8125rem] leading-snug text-ink-faint">
              PDF, DOCX, TXT or Markdown. A two-column layout is read column by column, which most
              parsers do not do. A scanned PDF has no text to read.
            </p>
            {!file && (
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                rows={3}
                placeholder="…or paste the resume text"
                className="mt-3 w-full resize-y border border-rule bg-paper-raised px-3 py-2.5 font-mono text-[0.8125rem] leading-relaxed placeholder:text-ink-faint focus:border-ink focus:outline-none"
              />
            )}
          </div>

          <div>
            <label htmlFor="jd" className="label">
              02 — The posting
            </label>
            <input
              id="jd"
              type="url"
              value={jdUrl}
              onChange={(e) => setJdUrl(e.target.value)}
              placeholder="https://boards.greenhouse.io/…"
              className="mt-3 w-full border border-rule-strong bg-paper-raised px-3 py-2.5 text-[0.875rem] placeholder:text-ink-faint focus:border-ink focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPaste((v) => !v)}
              className="mt-2 font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint underline underline-offset-4 hover:text-stamp"
            >
              {showPaste ? "Hide paste" : "Or paste it instead"}
            </button>
            <p className="mt-2 text-[0.8125rem] leading-snug text-ink-faint">
              Careers pages and Greenhouse, Lever or Workday links work. LinkedIn and Naukri serve a
              sign-in wall to a server, so paste those.
            </p>

            {showPaste && (
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                rows={8}
                placeholder="Paste the full posting — requirements, responsibilities, everything."
                className="mt-3 w-full resize-y border border-rule bg-paper-raised px-3 py-2.5 font-mono text-[0.8125rem] leading-relaxed placeholder:text-ink-faint focus:border-ink focus:outline-none"
              />
            )}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <button
            type="submit"
            disabled={phase === "working" || !ready}
            className="border border-ink bg-ink px-5 py-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-paper-raised transition-colors hover:bg-stamp hover:border-stamp disabled:cursor-not-allowed disabled:border-rule-strong disabled:bg-transparent disabled:text-ink-faint"
          >
            {phase === "working" ? "Working…" : "Tailor and verify"}
          </button>
          <span className="font-mono text-[0.6875rem] text-ink-faint">
            ~5 minutes · roughly $2 of model time
          </span>
        </div>
      </form>

      {/* -------------------------------------------------------- progress -- */}
      {(phase === "working" || error) && (
        <div className="mt-10 rule-top pt-6">
          <Stepper states={states} activeElapsed={elapsed} />
          {parsed && <SourceNote source={parsed.source} />}
        </div>
      )}

      {phase === "done" && parsed && (
        <div className="rise mt-10 rule-top pt-4">
          <p className="font-mono text-[0.6875rem] uppercase tracking-wider text-ink-faint">
            <span className="text-verified">✓</span> {STEPS.length} steps
            {totalSeconds !== null && (
              <> · {Math.floor(totalSeconds / 60)}m {totalSeconds % 60}s</>
            )}
          </p>
          <SourceNote source={parsed.source} />
        </div>
      )}

      {error && (
        <div className="rise mt-6 border-l-2 border-stamp bg-stamp-soft px-3 py-3">
          <p className="text-[0.875rem] text-ink">{error.message}</p>
          {error.hint && <p className="mt-1 text-[0.8125rem] text-ink-muted">{error.hint}</p>}
        </div>
      )}

      {/* --------------------------------------------------------- results -- */}
      {phase === "done" && result && parsed && (
        <div ref={resultsRef} className="mt-16 space-y-12">
          <div className="rise">
            <p className="label">Result</p>
            <h2 className="mt-2 font-display text-3xl leading-tight text-ink">
              {result.job.title}
              {result.job.company && (
                <span className="text-ink-faint"> · {result.job.company}</span>
              )}
            </h2>
          </div>

          <ScoreBlock report={result.report} job={result.job} />
          <TruthBlock truth={result.truth} repairAttempted={result.repair_attempted} />
          <GapsBlock gaps={result.gaps} report={result.report} />
          <StrategyBlock strategy={result.strategy} />
          <PreviewBlock tailored={result.tailored} />

          <section className="rise rule-top pt-5" style={{ animationDelay: "300ms" }}>
            <h2 className="label mb-4">Download</h2>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <button
                onClick={download}
                className="border border-ink bg-ink px-5 py-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-paper-raised transition-colors hover:border-stamp hover:bg-stamp"
              >
                Download PDF
              </button>
              {!result.truth.passed && (
                <span className="text-[0.8125rem] text-stamp">
                  Fix the flagged lines before you send this anywhere.
                </span>
              )}
            </div>
            {renderWarnings.map((w, i) => (
              <p key={i} className="mt-3 text-[0.8125rem] text-caution">
                {w}
              </p>
            ))}
          </section>
        </div>
      )}

      <footer className="mt-20 rule-top pt-5">
        <p className="max-w-prose font-mono text-[0.6875rem] leading-relaxed text-ink-faint">
          The score is an expert estimate of how this resume performs through a keyword-and-parse
          screen plus a recruiter&apos;s first pass. It is not a reading from any commercial ATS,
          and nothing here claims to be one.
        </p>
      </footer>
    </main>
  );
}
