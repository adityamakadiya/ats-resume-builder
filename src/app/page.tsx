"use client";

import { useCallback, useEffect, useState } from "react";
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
import { ResumeEditor, useResumeEditor } from "./_components/editor";
import { Rail } from "./_components/rail";
import { STEPS, Stepper, useElapsed, type StepState } from "./_components/steps";

type Phase = "intake" | "working" | "editing";

const initialStates = (): Record<string, StepState> =>
  Object.fromEntries(STEPS.map((s) => [s.key, "waiting" as StepState]));

const EMPTY_DOC = {
  headline: "",
  summary: { text: "", source_ids: [] },
  skills: [],
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  other_sections: [],
  section_order: [],
  rewrite_notes: [],
};

export default function Home() {
  const [phase, setPhase] = useState<Phase>("intake");
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
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [downloading, setDownloading] = useState(false);

  // The editor owns the document from the moment the rewrite lands, and the
  // renderer reads from it, so the PDF is always exactly what is on screen.
  const editor = useResumeEditor(EMPTY_DOC);
  const resetEditor = editor.reset;

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
    setStartedAt(Date.now());

    try {
      mark("parse", "active");
      const parseResult = await parseResume(file ?? resumeText);
      setParsed(parseResult);
      mark("parse", "done");

      mark("jd", "active");
      const jd = await fetchJd(jdText.trim() ? { text: jdText } : { url: jdUrl });
      if (jd.blocked) {
        mark("jd", "failed");
        setShowPaste(true);
        throw new ApiError(jd.block_reason, 422, true, "Paste the description below and run again.");
      }
      mark("jd", "done");

      mark("tailor", "active");
      const tailored = await tailor(parseResult.facts, jd.text, jd.source_note);
      setResult(tailored);
      resetEditor(tailored.tailored);
      mark("tailor", "done");
      // Rendering now happens on demand, against whatever you have edited.
      mark("render", "done");

      setPhase("editing");
    } catch (err) {
      setStates((prev) => {
        const next = { ...prev };
        for (const s of STEPS) if (next[s.key] === "active") next[s.key] = "failed";
        return next;
      });
      const apiError = err instanceof ApiError ? err : null;
      setError({ message: apiError?.message ?? (err as Error).message, hint: apiError?.hint });
      setPhase("intake");
    } finally {
      setStartedAt(null);
    }
  }

  /** Renders what is in the editor, not the draft the model produced. */
  async function download() {
    if (!result || !parsed) return;
    setDownloading(true);
    setError(null);
    try {
      const pdf = await renderPdf(editor.doc, parsed.facts, result.job.company);
      const url = URL.createObjectURL(pdf.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = pdf.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError({ message: (err as Error).message });
    } finally {
      setDownloading(false);
    }
  }

  const ready =
    (file !== null || resumeText.trim().length > 200) && Boolean(jdUrl.trim() || jdText.trim());

  /* ------------------------------------------------------------ editing -- */

  if (phase === "editing" && result && parsed) {
    const contact = parsed.facts.contact;
    const contactLine = [contact.location, contact.phone, contact.email]
      .filter(Boolean)
      .join("  |  ");

    return (
      <main className="min-h-full">
        <div className="sticky top-0 z-10 border-b border-rule bg-paper/95 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-2.5">
            <p className="truncate font-mono text-[0.6875rem] uppercase tracking-wider text-ink-muted">
              {result.job.title}
              {result.job.company ? ` · ${result.job.company}` : ""}
            </p>
            <div className="flex shrink-0 items-center gap-3">
              <button
                onClick={() => setPhase("intake")}
                className="font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint underline underline-offset-4 hover:text-ink"
              >
                New
              </button>
              <button
                onClick={download}
                disabled={downloading}
                className="border border-ink bg-ink px-3.5 py-1.5 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-paper-raised transition-colors hover:border-stamp hover:bg-stamp disabled:opacity-50"
              >
                {downloading ? "Rendering" : "Download PDF"}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <p className="mx-auto max-w-6xl px-5 pt-3 text-[0.8125rem] text-stamp">{error.message}</p>
        )}

        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-6 lg:grid-cols-[1fr_15rem]">
          <div className="rise min-w-0">
            <ResumeEditor
              doc={editor.doc}
              editedKeys={editor.editedKeys}
              patch={editor.patch}
              name={contact.name}
              contactLine={contactLine}
            />
          </div>
          <div className="rise lg:sticky lg:top-16 lg:self-start">
            <Rail
              report={result.report}
              truth={result.truth}
              gaps={result.gaps}
              strategy={result.strategy}
              editedCount={editor.editedKeys.size}
              rewriteNotes={editor.doc.rewrite_notes}
            />
          </div>
        </div>
      </main>
    );
  }

  /* ------------------------------------------------------------- intake -- */

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16 sm:px-8">
      <header className="rise">
        <h1 className="font-display text-[3rem] leading-[0.95] tracking-tight text-ink sm:text-[3.75rem]">
          Tailor without
          <br />
          <em className="pr-[0.12em] text-stamp">inventing</em> anything.
        </h1>
        <p className="mt-4 max-w-prose text-[0.9375rem] leading-relaxed text-ink-muted">
          Your resume is the only source of material. Edit the result in place, then export.
        </p>
      </header>

      {backendUp === false && (
        <p className="rise mt-6 border-l-2 border-stamp bg-stamp-soft px-3 py-2.5 text-[0.8125rem] text-stamp">
          Backend not reachable. Start it with{" "}
          <span className="font-mono">uvicorn atsresume.api:app --port 8000</span>.
        </p>
      )}

      <form onSubmit={run} className="rise mt-10 space-y-6" style={{ animationDelay: "80ms" }}>
        <fieldset disabled={phase === "working"} className="space-y-6 disabled:opacity-60">
          <div>
            <label htmlFor="resume" className="label">
              01 — Resume
            </label>
            <input
              id="resume"
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-2 block w-full border border-rule-strong bg-paper-raised px-3 py-2.5 text-[0.875rem] file:mr-4 file:border-0 file:bg-ink file:px-3 file:py-1.5 file:font-mono file:text-[0.6875rem] file:uppercase file:tracking-wider file:text-paper-raised hover:border-ink"
            />
            {!file && (
              <textarea
                value={resumeText}
                onChange={(e) => setResumeText(e.target.value)}
                rows={2}
                placeholder="…or paste it"
                className="mt-2 w-full resize-y border border-rule bg-paper-raised px-3 py-2 font-mono text-[0.8125rem] placeholder:text-ink-faint focus:border-ink focus:outline-none"
              />
            )}
          </div>

          <div>
            <label htmlFor="jd" className="label">
              02 — Posting
            </label>
            <input
              id="jd"
              type="url"
              value={jdUrl}
              onChange={(e) => setJdUrl(e.target.value)}
              placeholder="https://…"
              className="mt-2 w-full border border-rule-strong bg-paper-raised px-3 py-2.5 text-[0.875rem] placeholder:text-ink-faint focus:border-ink focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPaste((v) => !v)}
              className="mt-1.5 font-mono text-[0.625rem] uppercase tracking-wider text-ink-faint underline underline-offset-4 hover:text-stamp"
            >
              {showPaste ? "Hide" : "Or paste the posting instead"}
            </button>
            {showPaste && (
              <textarea
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                rows={7}
                placeholder="Paste the full posting."
                className="mt-2 w-full resize-y border border-rule bg-paper-raised px-3 py-2 font-mono text-[0.8125rem] placeholder:text-ink-faint focus:border-ink focus:outline-none"
              />
            )}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="submit"
            disabled={phase === "working" || !ready}
            className="border border-ink bg-ink px-5 py-2.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-paper-raised transition-colors hover:border-stamp hover:bg-stamp disabled:cursor-not-allowed disabled:border-rule-strong disabled:bg-transparent disabled:text-ink-faint"
          >
            {phase === "working" ? "Working…" : "Tailor"}
          </button>
          <span className="font-mono text-[0.625rem] text-ink-faint">2–3 min · ~$0.40</span>
        </div>
      </form>

      {(phase === "working" || error) && (
        <div className="mt-8 rule-top pt-5">
          <Stepper states={states} activeElapsed={elapsed} />
        </div>
      )}

      {error && (
        <div className="rise mt-5 border-l-2 border-stamp bg-stamp-soft px-3 py-2.5">
          <p className="text-[0.875rem] text-ink">{error.message}</p>
          {error.hint && <p className="mt-1 text-[0.8125rem] text-ink-muted">{error.hint}</p>}
        </div>
      )}
    </main>
  );
}
