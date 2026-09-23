"use client";

/**
 * The moment the product is for.
 *
 * The model tried to write something the original resume does not support, the
 * guard refused it, the repair round could not rescue it, and now somebody has
 * to be told. Almost every application does that with a red toast that says
 * "generation failed" and slides away after four seconds. That is a lie of
 * omission: nothing failed. A machine tried to embellish a stranger's work
 * history and was stopped, which is the single most valuable thing this
 * product does, and it should be the most legible screen in it.
 *
 * So it is a notice, not an error. Per refused line it shows three things in
 * the order a person actually asks them: what the rewrite tried to claim, what
 * the source fact really says, and the rule it was refused under. Then two
 * ways forward, both of which leave the user in charge: supply the real
 * number, or drop the line. There is no "accept anyway".
 *
 * Built on plain elements rather than a dialog primitive because the focus
 * behaviour here is worth owning: focus lands on the heading so the refusal is
 * read before the buttons are found, Tab is trapped, Escape closes, and focus
 * returns to whatever opened it.
 */

import { useCallback, useEffect, useRef } from "react";
import type { ResumeFacts, TruthViolation } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import { REFUSAL_REASON, repairQuestion, resolveSource } from "@/lib/editor/sources";

export type UnverifiableDialogProps = {
  open: boolean;
  violations: Array<{ index: number; violation: TruthViolation }>;
  doc: ResumeDoc;
  facts: ResumeFacts;
  onClose: () => void;
  /** Opens the chat with a question already written. */
  onAsk: (question: string, violation: TruthViolation) => void;
  onDrop: (index: number) => void;
};

/** Metric refusals have a literal right answer. The others need a story. */
function askLabel(code: string): string {
  return code === "UNSOURCED_METRIC" || code === "DUPLICATED_METRIC"
    ? "Tell me the real number"
    : "Tell me what actually happened";
}

function Quote({
  tone,
  label,
  children,
}: {
  tone: "refused" | "source" | "missing";
  label: string;
  children: React.ReactNode;
}) {
  const bar =
    tone === "refused"
      ? "before:bg-[color:var(--refused)]"
      : tone === "source"
        ? "before:bg-traced"
        : "before:bg-rule-strong";

  return (
    <div className="mt-3">
      <p className="label">{label}</p>
      <blockquote
        className={`relative mt-1 pl-3 before:absolute before:top-0 before:bottom-0 before:left-0 before:w-px before:content-[''] ${bar}`}
      >
        <p
          className={`text-[0.875rem] leading-relaxed ${
            tone === "refused"
              ? "text-ink-muted line-through decoration-[color:var(--refused)]"
              : tone === "missing"
                ? "text-ink-faint italic"
                : "text-ink"
          }`}
        >
          {children}
        </p>
      </blockquote>
    </div>
  );
}

export function UnverifiableDialog({
  open,
  violations,
  doc,
  facts,
  onClose,
  onAsk,
  onDrop,
}: UnverifiableDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    headingRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0] as HTMLElement;
      const last = focusable[focusable.length - 1] as HTMLElement;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!open || violations.length === 0) return null;

  const count = violations.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/25 p-4 backdrop-blur-[2px] sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="refusal-title"
        aria-describedby="refusal-intro"
        onKeyDown={onKeyDown}
        className="rise relative my-auto w-full max-w-[44rem] overflow-hidden rounded-xl border border-rule bg-paper-raised shadow-[0_24px_60px_-24px_rgba(15,23,42,0.35)]"
      >
        {/* The stamp. A document that has been checked gets a mark on it. */}
        <div aria-hidden="true" className="h-[3px] w-full bg-[color:var(--refused)]" />

        <div className="px-6 pt-6 pb-5 sm:px-8">
          <p className="label text-[color:var(--refused)]">Refused, not failed</p>
          <h2
            id="refusal-title"
            ref={headingRef}
            tabIndex={-1}
            className="mt-2 font-display text-[1.625rem] leading-tight font-semibold tracking-[-0.01em] text-ink outline-none"
          >
            {count === 1
              ? "One line would not have been true."
              : `${count} lines would not have been true.`}
          </h2>
          <p id="refusal-intro" className="mt-2 max-w-[46ch] text-[0.875rem] leading-relaxed text-ink-muted">
            We tried to rewrite {count === 1 ? "it" : "them"} twice and could not do it from
            what your resume actually says. Rather than guess a number or name a tool you
            never mentioned, we left {count === 1 ? "it" : "them"} out. Here is each one, and
            what you can do about it.
          </p>
        </div>

        <ol className="border-t border-rule">
          {violations.map(({ index, violation }, position) => {
            const source = resolveSource(doc, facts, violation);
            const reason = REFUSAL_REASON[violation.code] ?? violation.detail;

            return (
              <li key={index} className="border-b border-rule px-6 py-5 sm:px-8">
                <div className="flex items-baseline gap-3">
                  <span className="font-mono text-[0.6875rem] tabular-nums text-ink-faint">
                    {String(position + 1).padStart(2, "0")}
                  </span>
                  <div className="min-w-0">
                    <p className="font-mono text-[0.6875rem] tracking-wider text-[color:var(--refused)]">
                      {violation.code.replace(/_/g, " ")}
                    </p>
                    <p className="text-[0.8125rem] text-ink-muted">{violation.location}</p>
                  </div>
                </div>

                <div className="mt-1 pl-0 sm:pl-8">
                  <Quote tone="refused" label="What the rewrite tried to claim">
                    {violation.offending}
                  </Quote>

                  {source ? (
                    <Quote tone="source" label={`What your resume says, ${source.label}`}>
                      {source.text}
                    </Quote>
                  ) : (
                    <Quote tone="missing" label="What your resume says">
                      Nothing. There is no fact in your resume this line could have come from,
                      which is exactly why it was refused.
                    </Quote>
                  )}

                  <p className="mt-3 border-t border-rule pt-3 text-[0.8125rem] leading-relaxed text-ink-muted">
                    <span className="label mr-2">Why</span>
                    {reason}
                  </p>
                  {violation.detail && violation.detail !== reason && (
                    <p className="mt-1.5 text-[0.8125rem] leading-relaxed text-ink-faint">
                      {violation.detail}
                    </p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onAsk(repairQuestion(violation, source), violation)}
                      className="rounded-md bg-stamp px-3.5 py-1.5 text-[0.8125rem] font-medium text-paper-raised transition-colors hover:bg-[color:var(--stamp-strong)]"
                    >
                      {askLabel(violation.code)}
                    </button>
                    <button
                      type="button"
                      onClick={() => onDrop(index)}
                      className="rounded-md border border-rule-strong px-3 py-1.5 text-[0.8125rem] text-ink-muted transition-colors hover:border-[color:var(--refused)] hover:text-[color:var(--refused)]"
                    >
                      Drop it
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center justify-between gap-4 px-6 py-4 sm:px-8">
          <p className="text-[0.75rem] leading-snug text-ink-faint">
            The rest of the document traced cleanly. Nothing here was written into it.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md border border-rule-strong px-3 py-1.5 text-[0.8125rem] text-ink transition-colors hover:bg-paper-sunk"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
