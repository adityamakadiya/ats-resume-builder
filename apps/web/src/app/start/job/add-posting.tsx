"use client";

/**
 * Step three: the posting, and the run it starts.
 *
 * WHY THE TAILOR RUNS HERE rather than being handed to the editor.
 *
 * The alternative was to create the resume, carry the posting into
 * `/resume/<id>` and let the editor's own drawer run it. That lands the user
 * on a screen with a modal already open over a document they have not seen,
 * and it gets them to a *useful* screen no sooner: the run takes the same
 * forty seconds either way. Worse, two of the outcomes have to be dealt with
 * before the editor is the right place to be. A posting behind a login wall
 * needs the paste box and the URL the user typed, and this is the screen that
 * still has both. A run the database refused has to be said out loud before a
 * navigation throws it away. So the run happens here, and the editor opens on
 * a finished document with a real score in the corner.
 *
 * The progress is real. Every row below lights up on the step's own
 * `{state:"start"}` and settles on its `{state:"done"}`, and the clock beside
 * it is wall time between those two events. Nothing is on a timer.
 *
 * The behaviour of the two inputs is `TailorPanel`'s, deliberately: the same
 * pair, the same labels, the same blocked-link path. Somebody who adds a
 * second posting later from the editor should find the control they already
 * used.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STEP_LABEL, TAILOR_STEPS, streamTailor, type TailorStep } from "@/lib/editor/api";

/* ----------------------------------------------------------------- state -- */

type StepRecord = {
  state: "waiting" | "running" | "done" | "stopped";
  startedAt?: number;
  endedAt?: number;
};

/** `creating` is the resume row; `running` is the tailor stream. */
type Phase = "editing" | "creating" | "running" | "landing";

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
  const stopped = record.state === "stopped";
  const elapsed =
    record.startedAt === undefined
      ? null
      : Math.max(0, (record.endedAt ?? now) - record.startedAt);

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
              : stopped
                ? "border-caution text-caution"
                : "border-rule-strong text-transparent",
        ].join(" ")}
      >
        {done ? "✓" : running ? "●" : stopped ? "·" : ""}
      </span>

      <span className="min-w-0 flex-1">
        <span
          className={[
            "block text-[0.8125rem] leading-snug",
            running ? "text-ink" : done || stopped ? "text-ink-muted" : "text-ink-faint",
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

export function AddPosting({
  documentId,
  templateId,
}: {
  documentId?: string;
  templateId?: string;
}) {
  const router = useRouter();

  const [mode, setMode] = useState<"paste" | "link">("paste");
  const [jdText, setJdText] = useState("");
  const [jdUrl, setJdUrl] = useState("");

  const [phase, setPhase] = useState<Phase>("editing");
  const [steps, setSteps] = useState<Record<TailorStep, StepRecord>>(blankSteps);
  const [repairing, setRepairing] = useState(false);
  const [problem, setProblem] = useState<{ message: string; hint?: string } | null>(null);
  /** The posting's site refused the fetch. Not a failure, a redirect. */
  const [blocked, setBlocked] = useState<{ message: string; hint?: string } | null>(null);
  /**
   * The run finished and the database would not take it.
   *
   * Navigating away here would throw away four model calls the user waited
   * for, because the editor reads the version back from the row that was
   * never written. So the run stops on this screen and says so.
   */
  const [unsaved, setUnsaved] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  /** The resume row, once created. Reused if a first attempt was refused. */
  const resumeRef = useRef<string | null>(null);

  useEffect(() => {
    if (phase !== "running") return;
    setNow(performance.now());
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  /* An abandoned run keeps spending money. Abort on unmount, always. */
  useEffect(() => () => abortRef.current?.abort(), []);

  const busy = phase !== "editing";
  const ready = mode === "paste" ? jdText.trim().length > 0 : jdUrl.trim().length > 0;
  const started = TAILOR_STEPS.some((step) => steps[step].state !== "waiting");

  const totalElapsed = useMemo(() => {
    const touched = Object.values(steps).filter((record) => record.startedAt !== undefined);
    if (touched.length === 0) return null;
    const first = Math.min(...touched.map((record) => record.startedAt as number));
    const last = Math.max(...touched.map((record) => record.endedAt ?? now));
    return Math.max(0, last - first);
  }, [steps, now]);

  const stopSteps = useCallback(() => {
    setSteps((previous) => {
      const at = performance.now();
      const next = { ...previous };
      for (const step of TAILOR_STEPS) {
        const record = next[step];
        if (record.state !== "running") continue;
        next[step] = { state: "stopped", startedAt: record.startedAt, endedAt: at };
      }
      return next;
    });
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    stopSteps();
    setRepairing(false);
    setPhase("editing");
  }, [stopSteps]);

  function markStep(step: TailorStep, state: "start" | "done") {
    setSteps((previous) => {
      const at = performance.now();
      const record = previous[step];
      if (state === "start") {
        // A repair restarts the tailor step. Keep the original start so the
        // clock reports the whole of what the user waited for.
        return { ...previous, [step]: { state: "running", startedAt: record.startedAt ?? at } };
      }
      return {
        ...previous,
        [step]: { state: "done", startedAt: record.startedAt ?? at, endedAt: at },
      };
    });
  }

  const editorUrl = useCallback(
    (id: string) => `/resume/${id}${documentId ? `?document=${encodeURIComponent(documentId)}` : ""}`,
    [documentId],
  );

  /**
   * Create the resume row, exactly as the template step used to.
   *
   * `documentId` travels in the body rather than only in the URL: the truth
   * guard checks every rewritten line against `documents.raw_text`, so a
   * resume that cannot name its source has no corpus to be checked against.
   */
  const createResume = useCallback(async (): Promise<string | null> => {
    if (resumeRef.current) return resumeRef.current;

    let response: Response;
    try {
      response = await fetch("/api/resumes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId, documentId }),
      });
    } catch {
      setProblem({
        message: "The request did not reach the server.",
        hint: "Check your connection and try again.",
      });
      return null;
    }

    let payload: { ok?: boolean; id?: string; reason?: string; remedy?: string };
    try {
      payload = await response.json();
    } catch {
      setProblem({
        message: `The server answered with ${response.status} and no explanation.`,
        hint: "Try again. If it keeps happening, check the server logs.",
      });
      return null;
    }

    if (!response.ok || !payload.ok || !payload.id) {
      setProblem({
        message: payload.reason ?? "The resume could not be created.",
        hint: payload.remedy ?? "Try again in a moment.",
      });
      return null;
    }

    resumeRef.current = payload.id;
    return payload.id;
  }, [documentId, templateId]);

  /**
   * Skip, honestly.
   *
   * The resume is still created and the editor still opens, fully editable.
   * What is gone is every panel that needs something to compare against, and
   * the link above this handler says which ones before it is clicked.
   */
  async function skip() {
    if (busy) return;
    setProblem(null);
    setPhase("creating");

    const id = await createResume();
    if (!id) {
      setPhase("editing");
      return;
    }

    setPhase("landing");
    router.push(editorUrl(id));
  }

  async function run() {
    if (!ready || busy) return;

    setProblem(null);
    setBlocked(null);
    setUnsaved(null);
    setPhase("creating");

    const id = await createResume();
    if (!id) {
      setPhase("editing");
      return;
    }

    setPhase("running");
    setSteps(blankSteps());
    setRepairing(false);

    const controller = new AbortController();
    abortRef.current = controller;
    let finished = false;

    try {
      for await (const event of streamTailor(
        {
          resumeId: id,
          // No `resumeText`: the route reads the upload behind this resume,
          // which is the document the guard will check against. Sending a
          // second copy from here would be a second source of truth.
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
            setRepairing(event.repairing);
            break;

          case "done": {
            finished = true;
            setRepairing(false);
            if (!event.persisted) {
              stopSteps();
              setUnsaved(
                "The rewrite finished, and the database refused to store it.",
              );
              setPhase("editing");
              break;
            }
            setPhase("landing");
            router.push(editorUrl(event.resumeId || id));
            break;
          }

          case "error":
            if (event.needsJdPaste) {
              // Expected, not exceptional. Keep the URL, swap the input, put
              // the cursor where the text goes.
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
      if (!finished) {
        stopSteps();
        setPhase((current) => (current === "running" ? "editing" : current));
      }
    }
  }

  /** Every wait names the step it is waiting on. None of these is a spinner. */
  const waiting =
    phase === "creating"
      ? "Creating your resume"
      : phase === "landing"
        ? "Opening the editor"
        : null;

  return (
    <div>
      {/* ------------------------------------------------------- input -- */}
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
            disabled={busy}
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
          <span className="font-medium text-caution">{blocked.message}</span> {blocked.hint}
          <span className="mt-1.5 block text-ink-muted">
            Nothing you typed was lost. Paste the posting text below and run it again.
            {jdUrl.trim() && (
              <>
                {" "}
                Your link is kept:{" "}
                <span className="font-mono text-[0.75rem] break-all text-ink">
                  {jdUrl.trim()}
                </span>
              </>
            )}
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
              rows={10}
              value={jdText}
              disabled={busy}
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
              disabled={busy}
              onChange={(event) => setJdUrl(event.target.value)}
              placeholder="https://"
              className="mt-2 w-full rounded-lg border border-rule bg-paper-raised px-3 py-2.5 text-[0.875rem] text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-rule-strong focus:border-stamp disabled:opacity-60"
            />
            <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
              Some boards, LinkedIn and Naukri among them, serve a login wall to anything
              without a session. If that happens we will ask you to paste the text and keep
              this link.
            </p>
          </>
        )}
      </div>

      {/* ---------------------------------------------------- progress -- */}
      {(phase === "running" || started) && (
        <section
          aria-label="Progress"
          className="mt-5 rounded-xl border border-rule bg-paper-sunk/60 px-4 py-3"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="label">{phase === "running" ? "Working" : "Stopped here"}</p>
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
              At least one rewritten line could not be traced back to a fact in your resume,
              so it is being written again from what your resume actually says. This is the
              part that takes the longest and it is the part worth waiting for.
            </p>
          )}
        </section>
      )}

      {unsaved && (
        <section
          role="alert"
          className="mt-4 rounded-xl border border-caution/40 bg-caution-soft px-4 py-3.5 text-[0.8125rem] leading-relaxed text-ink"
        >
          <p>
            <span className="font-medium text-caution">{unsaved}</span> The editor reads the
            stored version back, so opening it now would show your resume without the
            rewrite. That usually means the migrations in <span className="font-mono">supabase/</span>{" "}
            are not applied yet.
          </p>
          <div className="mt-3 flex flex-wrap gap-2.5">
            <button
              type="button"
              onClick={() => void run()}
              className="rounded-md bg-stamp px-3.5 py-2 text-[0.8125rem] font-medium text-paper-raised transition-colors hover:bg-[color:var(--stamp-strong)]"
            >
              Run it again
            </button>
            <button
              type="button"
              onClick={() => {
                const id = resumeRef.current;
                if (!id) return;
                setPhase("landing");
                router.push(editorUrl(id));
              }}
              className="rounded-md border border-rule-strong px-3.5 py-2 text-[0.8125rem] text-ink transition-colors hover:bg-paper-sunk"
            >
              Open the editor without it
            </button>
          </div>
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

      {/* ------------------------------------------------------ actions -- */}
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-rule pt-5">
        {phase === "running" ? (
          <button
            type="button"
            onClick={cancel}
            className="h-11 rounded-lg border border-rule-strong px-4 text-[0.9375rem] text-ink transition-colors hover:border-[color:var(--refused)] hover:text-[color:var(--refused)]"
          >
            Stop the run
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void run()}
            disabled={!ready || busy}
            className="h-11 rounded-lg bg-stamp px-5 text-[0.9375rem] font-medium text-paper-raised transition-colors hover:bg-[color:var(--stamp-strong)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {waiting ?? "Tailor to this posting"}
          </button>
        )}

        <p className="min-w-0 flex-1 text-[0.75rem] leading-snug text-ink-faint">
          {phase === "running"
            ? "Stopping aborts the request. Nothing partial is kept."
            : waiting
              ? `${waiting}. Nothing is sent anywhere else.`
              : "Four model calls. Around forty seconds, and every step says what it is doing."}
        </p>
      </div>

      {/* --------------------------------------------------------- skip -- */}
      <div className="mt-5 rounded-xl border border-rule bg-paper-sunk/50 px-4 py-3.5">
        <button
          type="button"
          onClick={() => void skip()}
          disabled={busy}
          className="rounded-xs text-[0.875rem] font-medium text-[color:var(--stamp-strong)] underline underline-offset-4 transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          Skip for now, open the editor
        </button>
        <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-muted">
          Your resume opens fully editable, and the two panels that need a posting stay
          empty: no ATS score, and no keyword suggestions. The editor says so on the
          screen, and you can add a posting from there whenever you like.
        </p>
      </div>
    </div>
  );
}
