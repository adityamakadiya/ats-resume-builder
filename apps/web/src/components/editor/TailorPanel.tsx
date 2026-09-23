"use client";

/**
 * Tailor to a job.
 *
 * The product's central action, and until now the one thing the interface did
 * not have a door to. `/api/tailor` streams six named steps and this panel is
 * those six steps, drawn as they arrive.
 *
 * THE PROGRESS IS REAL. Nothing here is on a timer and nothing advances on a
 * guess. A step lights up when its `{state:"start"}` lands and settles when
 * its `{state:"done"}` lands, and the clock beside it is wall time measured
 * between those two events. The product we are replacing animates a bar in
 * front of one synchronous request, which means the bar is always lying in
 * one direction or the other. We have the events, so we show the events.
 *
 * Two behaviours are worth stating because they are easy to get wrong.
 *
 * A link to a posting can come back refused with `needsJdPaste`. LinkedIn,
 * Naukri and most of the large boards serve a login wall to anything without
 * a session, and that is an expected answer rather than a failure. The panel
 * swaps to the paste box, keeps the URL the user typed, says which site
 * refused and why, and puts the cursor where the text goes. Nothing typed is
 * ever thrown away by a mode change.
 *
 * Cancelling aborts the request. The route honours `request.signal`, so an
 * abandoned run stops costing money at the next await rather than running to
 * completion into a browser that has gone away.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STEP_LABEL, TAILOR_STEPS, streamTailor, type TailorStep } from "@/lib/editor/api";
import { docToPlainText } from "@/lib/editor/plaintext";
import { useEditorStore } from "@/lib/store/editor";

/* ----------------------------------------------------------------- state -- */

type StepRecord = {
  state: "waiting" | "running" | "done";
  startedAt?: number;
  endedAt?: number;
};

type Phase = "editing" | "running" | "done";

type Outcome = {
  before: number;
  after: number;
  violations: number;
  persisted: boolean;
};

function blankSteps(): Record<TailorStep, StepRecord> {
  return TAILOR_STEPS.reduce(
    (acc, step) => {
      acc[step] = { state: "waiting" };
      return acc;
    },
    {} as Record<TailorStep, StepRecord>,
  );
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/* ------------------------------------------------------------- the steps -- */

function StepRow({
  step,
  record,
  now,
}: {
  step: TailorStep;
  record: StepRecord;
  now: number;
}) {
  const running = record.state === "running";
  const done = record.state === "done";
  const elapsed =
    record.startedAt === undefined
      ? null
      : (record.endedAt ?? now) - record.startedAt;

  return (
    <li className="flex items-start gap-3 py-2">
      <span
        aria-hidden="true"
        className={[
          "mt-[0.3rem] grid size-4 shrink-0 place-items-center rounded-full border text-[0.5rem]",
          done
            ? "border-traced bg-traced text-paper-raised"
            : running
              ? "border-stamp bg-stamp-soft text-stamp"
              : "border-rule-strong text-transparent",
        ].join(" ")}
      >
        {done ? "✓" : running ? "●" : ""}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={[
            "block text-[0.8125rem] leading-snug",
            running ? "text-ink" : done ? "text-ink-muted" : "text-ink-faint",
          ].join(" ")}
        >
          {STEP_LABEL[step]}
        </span>
        {running && (
          <span aria-hidden="true" className="sweeping mt-1.5 block h-[2px] w-full rounded-full" />
        )}
      </span>

      <span
        className={[
          "shrink-0 pt-[0.1rem] font-mono text-[0.6875rem] tabular-nums",
          running ? "text-stamp" : "text-ink-faint",
        ].join(" ")}
      >
        {elapsed === null ? "" : seconds(elapsed)}
      </span>
    </li>
  );
}

/* ----------------------------------------------------------------- panel -- */

export function TailorPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const doc = useEditorStore((s) => s.doc);
  const resumeId = useEditorStore((s) => s.resumeId);
  const templateId = useEditorStore((s) => s.templateId);

  const [mode, setMode] = useState<"paste" | "link">("paste");
  const [jdText, setJdText] = useState("");
  const [jdUrl, setJdUrl] = useState("");

  const [phase, setPhase] = useState<Phase>("editing");
  const [steps, setSteps] = useState<Record<TailorStep, StepRecord>>(blankSteps);
  const [repairing, setRepairing] = useState(false);
  const [problem, setProblem] = useState<{ message: string; hint?: string } | null>(null);
  /** Set when the posting's site refused the fetch. Not an error, a redirect. */
  const [blocked, setBlocked] = useState<{ message: string; hint?: string } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [now, setNow] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  /* The clock. One interval for the whole panel, only while something runs. */
  useEffect(() => {
    if (phase !== "running") return;
    setNow(performance.now());
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  /* An abandoned run keeps spending money. Abort on unmount, always. */
  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setPhase("editing");
    setRepairing(false);
  }, []);

  const close = useCallback(() => {
    if (phase === "running") cancel();
    onClose();
  }, [cancel, onClose, phase]);

  const ready = mode === "paste" ? jdText.trim().length > 0 : jdUrl.trim().length > 0;

  const totalElapsed = useMemo(() => {
    const started = Object.values(steps)
      .map((record) => record.startedAt)
      .filter((value): value is number => value !== undefined);
    if (started.length === 0) return null;
    const first = Math.min(...started);
    const ends = Object.values(steps).map((record) => record.endedAt ?? now);
    return Math.max(...ends) - first;
  }, [steps, now]);

  function markStep(step: TailorStep, state: "start" | "done") {
    setSteps((previous) => {
      const at = performance.now();
      const record = previous[step];
      if (state === "start") {
        return {
          ...previous,
          // A repair restarts the tailor step. Keep the original start so the
          // clock reports the whole of what the user waited for.
          [step]: { state: "running", startedAt: record.startedAt ?? at },
        };
      }
      return {
        ...previous,
        [step]: { state: "done", startedAt: record.startedAt ?? at, endedAt: at },
      };
    });
  }

  async function run() {
    if (!ready || phase === "running") return;

    setPhase("running");
    setSteps(blankSteps());
    setRepairing(false);
    setProblem(null);
    setBlocked(null);
    setOutcome(null);

    const controller = new AbortController();
    abortRef.current = controller;

    const before = useEditorStore.getState().report.overall;
    let finished = false;

    try {
      for await (const event of streamTailor(
        {
          resumeId: resumeId || undefined,
          // The document as it stands on screen, including anything typed
          // since it loaded. Tailoring a stale copy would be a quiet lie.
          resumeText: docToPlainText(doc),
          jdText: mode === "paste" ? jdText.trim() : undefined,
          jdUrl: mode === "link" ? jdUrl.trim() : undefined,
          templateId,
        },
        controller.signal,
      )) {
        switch (event.t) {
          case "step":
            markStep(event.step, event.state);
            break;

          case "guard":
            // `repairing` is the honest one: the first draft did not trace,
            // and a second attempt is being written right now.
            setRepairing(event.repairing);
            break;

          case "score":
            // The header score is recomputed locally from the same formula.
            break;

          case "done": {
            finished = true;
            const moved = useEditorStore.getState().loadTailored({
              resumeId: event.resumeId,
              versionId: event.versionId,
              tailored: event.tailored,
              truth: event.truth,
              gaps: event.gaps,
              persisted: event.persisted,
            });
            setOutcome({
              before,
              after: moved.after,
              violations: event.truth.violations.length,
              persisted: event.persisted,
            });
            setRepairing(false);
            setPhase("done");
            break;
          }

          case "error":
            if (event.needsJdPaste) {
              setMode("paste");
              setBlocked({ message: event.message, hint: event.hint });
              window.setTimeout(() => pasteRef.current?.focus(), 0);
            } else {
              setProblem({ message: event.message, hint: event.hint });
            }
            break;

          default:
            break;
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setProblem({
          message: "The stream stopped before the run finished.",
          hint: (error as Error).message,
        });
      }
    } finally {
      abortRef.current = null;
      setRepairing(false);
      if (!finished) setPhase((current) => (current === "running" ? "editing" : current));
    }
  }

  if (!open) return null;

  const delta = outcome ? Math.round((outcome.after - outcome.before) * 10) / 10 : 0;

  return (
    <div
      className="fixed inset-0 z-40 flex justify-end bg-ink/20 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="tailor-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
        }}
        className="flex h-full w-full max-w-[34rem] flex-col border-l border-rule bg-paper-raised shadow-[0_0_60px_-20px_rgba(15,23,42,0.35)]"
      >
        {/* ------------------------------------------------------ header -- */}
        <header className="flex items-start gap-4 border-b border-rule px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="label text-stamp">The main event</p>
            <h2
              id="tailor-title"
              ref={headingRef}
              tabIndex={-1}
              className="mt-1.5 font-display text-[1.375rem] leading-tight font-semibold text-ink outline-none"
            >
              Tailor to a job
            </h2>
            <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-muted">
              Paste the posting, or give us the link. Every rewritten line is checked
              against your own resume before you see it.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="shrink-0 rounded-md border border-rule-strong px-2.5 py-1 text-[0.8125rem] text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
          >
            {phase === "running" ? "Cancel" : "Close"}
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {/* ---------------------------------------------------- input -- */}
          <div
            role="group"
            aria-label="Where the posting comes from"
            className="inline-flex rounded-lg border border-rule bg-paper-sunk p-0.5"
          >
            {(
              [
                ["paste", "Paste the text"],
                ["link", "Use a link"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={mode === value}
                disabled={phase === "running"}
                onClick={() => setMode(value)}
                className={[
                  "rounded-md px-3 py-1.5 text-[0.8125rem] transition-colors disabled:opacity-50",
                  mode === value
                    ? "bg-paper-raised text-ink shadow-[0_1px_2px_rgba(15,23,42,0.08)]"
                    : "text-ink-muted hover:text-ink",
                ].join(" ")}
              >
                {label}
              </button>
            ))}
          </div>

          {blocked && (
            <p
              role="status"
              className="mt-4 rounded-lg border border-caution/40 bg-caution-soft px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink"
            >
              <span className="font-medium text-caution">{blocked.message}</span>{" "}
              {blocked.hint}
              <span className="mt-1.5 block text-ink-muted">
                Your link is still in the box above. Paste the posting text here instead
                and the run will pick up from there.
              </span>
            </p>
          )}

          <div className="mt-4">
            {mode === "paste" ? (
              <>
                <label htmlFor="jd-text" className="label">
                  The job description
                </label>
                <textarea
                  id="jd-text"
                  ref={pasteRef}
                  rows={9}
                  value={jdText}
                  disabled={phase === "running"}
                  onChange={(event) => setJdText(event.target.value)}
                  placeholder="Paste the whole posting. Responsibilities and requirements both, not just the title."
                  className="mt-2 w-full resize-y rounded-lg border border-rule bg-paper-raised px-3 py-2.5 text-[0.875rem] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-rule-strong focus:border-stamp disabled:opacity-60"
                />
                <p className="mt-1.5 font-mono text-[0.625rem] tracking-wider text-ink-faint uppercase">
                  {jdText.trim() ? `${jdText.trim().split(/\s+/).length} words` : "Empty"}
                </p>
              </>
            ) : (
              <>
                <label htmlFor="jd-url" className="label">
                  Link to the posting
                </label>
                <input
                  id="jd-url"
                  type="url"
                  value={jdUrl}
                  disabled={phase === "running"}
                  onChange={(event) => setJdUrl(event.target.value)}
                  placeholder="https://"
                  className="mt-2 w-full rounded-lg border border-rule bg-paper-raised px-3 py-2.5 text-[0.875rem] text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-rule-strong focus:border-stamp disabled:opacity-60"
                />
                <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
                  Some boards, LinkedIn and Naukri among them, serve a login wall to
                  anything without a session. If that happens we will ask you to paste
                  the text and keep this link.
                </p>
              </>
            )}
          </div>

          {/* ------------------------------------------------- progress -- */}
          {(phase === "running" || phase === "done") && (
            <section
              aria-label="Progress"
              className="mt-5 rounded-xl border border-rule bg-paper-sunk/60 px-4 py-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="label">{phase === "done" ? "What happened" : "Working"}</p>
                <span className="font-mono text-[0.6875rem] tabular-nums text-ink-faint">
                  {totalElapsed === null ? "" : seconds(totalElapsed)}
                </span>
              </div>

              <ol aria-live="polite" className="mt-1 divide-y divide-rule">
                {TAILOR_STEPS.map((step) => (
                  <StepRow key={step} step={step} record={steps[step]} now={now} />
                ))}
              </ol>

              {repairing && (
                <p className="mt-2 rounded-lg border border-caution/40 bg-caution-soft px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink">
                  <span className="font-medium text-caution">
                    The first draft did not check out.
                  </span>{" "}
                  At least one rewritten line could not be traced back to a fact in your
                  resume, so it is being written again from what your resume actually
                  says. This is the part that takes the longest and it is the part worth
                  waiting for.
                </p>
              )}
            </section>
          )}

          {/* --------------------------------------------------- result -- */}
          {phase === "done" && outcome && (
            <section
              aria-label="Result"
              className="rise mt-4 rounded-xl border border-rule bg-paper-raised px-4 py-4"
            >
              <p className="label">New score</p>
              <div className="mt-1 flex items-baseline gap-2.5">
                <span className="font-display text-[2.75rem] leading-[0.85] font-semibold tabular-nums text-ink">
                  {outcome.after.toFixed(0)}
                </span>
                <span className="font-mono text-[0.625rem] text-ink-faint">/100</span>
                <span
                  className={[
                    "ml-auto rounded-md border px-2 py-0.5 font-mono text-[0.75rem] tabular-nums",
                    delta > 0
                      ? "border-traced/40 bg-traced-soft text-traced"
                      : delta < 0
                        ? "border-caution/40 bg-caution-soft text-caution"
                        : "border-rule text-ink-faint",
                  ].join(" ")}
                >
                  {delta > 0 ? "+" : ""}
                  {delta.toFixed(1)} from {outcome.before.toFixed(0)}
                </span>
              </div>

              {outcome.violations > 0 && (
                <button
                  type="button"
                  onClick={() => useEditorStore.getState().openUnverifiable()}
                  className="mt-3 text-[0.8125rem] text-stamp underline underline-offset-4 hover:text-ink"
                >
                  {outcome.violations} {outcome.violations === 1 ? "line was" : "lines were"}{" "}
                  refused. See why
                </button>
              )}

              {!outcome.persisted && (
                <p className="mt-3 text-[0.75rem] leading-relaxed text-caution">
                  This run was not written to the database, so it lives in this tab only.
                  Download the PDF before you close it.
                </p>
              )}

              <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-faint">
                The document behind you has been replaced with the tailored one. Close
                this panel to read it.
              </p>
            </section>
          )}

          {problem && (
            <p
              role="alert"
              className="mt-4 rounded-lg border border-[color:var(--refused)] bg-[color:var(--refused-soft)] px-3.5 py-3 text-[0.8125rem] leading-relaxed text-ink"
            >
              <span className="font-medium text-[color:var(--refused)]">{problem.message}</span>{" "}
              {problem.hint}
            </p>
          )}
        </div>

        {/* ------------------------------------------------------ footer -- */}
        <footer className="flex flex-wrap items-center gap-3 border-t border-rule px-5 py-4">
          {phase === "running" ? (
            <button
              type="button"
              onClick={cancel}
              className="rounded-md border border-rule-strong px-3.5 py-2 text-[0.875rem] text-ink transition-colors hover:border-[color:var(--refused)] hover:text-[color:var(--refused)]"
            >
              Stop the run
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void run()}
              disabled={!ready}
              className="rounded-md bg-stamp px-4 py-2 text-[0.875rem] font-medium text-paper-raised transition-colors hover:bg-[color:var(--stamp-strong)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {phase === "done" ? "Tailor again" : "Tailor this resume"}
            </button>
          )}

          <p className="min-w-0 flex-1 text-[0.75rem] leading-snug text-ink-faint">
            {phase === "running"
              ? "Stopping aborts the request. Nothing partial is kept."
              : "Four model calls. Around forty seconds, and every step says what it is doing."}
          </p>
        </footer>
      </aside>
    </div>
  );
}
