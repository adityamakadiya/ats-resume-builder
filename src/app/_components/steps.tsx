"use client";

import { useEffect, useState } from "react";

export type StepState = "waiting" | "active" | "done" | "failed";

export type Step = {
  key: string;
  label: string;
  /** What the step is actually doing, so the wait is legible rather than blank. */
  detail: string;
};

export const STEPS: Step[] = [
  { key: "parse", label: "Read the resume", detail: "Finding columns, then extracting facts with ids. Cached after the first run" },
  { key: "jd", label: "Read the posting", detail: "Direct, then a reader service, then a browser" },
  { key: "tailor", label: "Rewrite and verify", detail: "Rewriting, then checking every line against the original" },
  { key: "render", label: "Open the editor", detail: "Edit any line, then export whenever you are ready" },
];

/** Seconds since `since`, or null when nothing is running. */
export function useElapsed(since: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);

  return since === null ? null : Math.floor((now - since) / 1000);
}

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function Stepper({
  states,
  activeElapsed,
}: {
  states: Record<string, StepState>;
  activeElapsed: number | null;
}) {
  return (
    <ol className="mt-8">
      {STEPS.map((step, i) => {
        const state = states[step.key] ?? "waiting";
        const isActive = state === "active";

        return (
          <li key={step.key} className="grid grid-cols-[2.5rem_1fr] gap-x-4">
            <div className="flex flex-col items-center">
              <span
                className={[
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
                  state === "done"
                    ? "border-verified bg-verified text-paper-raised"
                    : state === "failed"
                      ? "border-stamp bg-stamp text-paper-raised"
                      : isActive
                        ? "border-stamp text-stamp"
                        : "border-rule-strong text-ink-faint",
                ].join(" ")}
              >
                {state === "done" ? "✓" : state === "failed" ? "✕" : i + 1}
              </span>
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={[
                    "my-1 w-px flex-1",
                    state === "done" ? "bg-verified" : "bg-rule",
                  ].join(" ")}
                />
              )}
            </div>

            <div className={i < STEPS.length - 1 ? "pb-6" : ""}>
              <div className="flex items-baseline justify-between gap-4">
                <span
                  className={[
                    "text-[0.9375rem]",
                    state === "waiting" ? "text-ink-faint" : "text-ink",
                    isActive ? "font-medium" : "",
                  ].join(" ")}
                >
                  {step.label}
                </span>
                {isActive && activeElapsed !== null && (
                  <span className="font-mono text-xs tabular-nums text-stamp">
                    {clock(activeElapsed)}
                  </span>
                )}
              </div>

              <p className="mt-0.5 text-[0.8125rem] leading-snug text-ink-faint">{step.detail}</p>

              <div className="mt-2 h-px w-full bg-rule">
                {isActive && <div className="sweeping h-px w-full" />}
                {state === "done" && <div className="draw h-px w-full bg-verified" />}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
