"use client";

/**
 * One weak line, what is wrong with it, and the way out.
 *
 * Three states, and the middle one is the reason this is a card rather than
 * a button: asking for a rewrite costs a model call and a few seconds, and
 * a control that silently rewrites the user's own sentence the instant they
 * click is a control people stop trusting. So it goes: here is the problem,
 * here is the proposal beside what you wrote, keep it or throw it away.
 *
 * The proposal is never applied by arriving. Accept is a separate press,
 * and the score movement is shown on it before it happens, because the
 * whole argument for making this edit is the number it moves.
 */

import { useState } from "react";
import type { JobSpec, Op, ResumeFacts } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import type { LineIssues } from "@/lib/editor/writing";
import { requestRewrite } from "@/lib/editor/suggest";
import { deltaOf } from "@/lib/editor/gaps";
import type { AtsReport } from "@ats/core";

type Proposal = { text: string; sourceIds: string[]; note: string; delta: number | null };

export function WritingCard({
  line,
  doc,
  facts,
  job,
  report,
  onApply,
}: {
  line: LineIssues;
  doc: ResumeDoc;
  facts: ResumeFacts;
  job: JobSpec | null;
  report: AtsReport | null;
  onApply: (ops: Op[], label: string, path: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function ask() {
    setBusy(true);
    setMessage(null);

    const result = await requestRewrite({
      text: line.text,
      path: line.path,
      problems: line.issues.map((i) => i.why),
      facts,
      job,
      doc,
    });
    setBusy(false);

    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (!result.changed) {
      setMessage(result.note);
      return;
    }

    /*
      Scored before it is offered, against this document as it stands. A
      suggestion that shows no number is asking the user to take it on
      faith, and one that shows an estimate is worse.
    */
    const ops: Op[] = [{ op: "replace", path: line.path, value: result.text }];
    setProposal({
      text: result.text,
      sourceIds: result.sourceIds,
      note: result.note,
      delta: deltaOf(job, facts, doc, report, ops),
    });
  }

  function accept() {
    if (!proposal) return;
    onApply(
      [{ op: "replace", path: line.path, value: proposal.text }],
      `Rewrote ${line.where}`,
      line.path,
    );
    setProposal(null);
  }

  return (
    <article className="rounded-lg border border-rule bg-paper px-3 py-2.5">
      <header className="flex items-baseline gap-2">
        <h4 className="text-[0.75rem] font-medium tracking-wide text-ink-muted uppercase">
          {line.where}
        </h4>
        <span className="ml-auto font-mono text-[0.6875rem] text-ink-faint">
          {line.issues.length} {line.issues.length === 1 ? "issue" : "issues"}
        </span>
      </header>

      <ul className="mt-1.5 space-y-1">
        {line.issues.map((issue, i) => (
          <li key={i} className="text-[0.75rem] leading-snug text-ink-muted">
            {issue.why}
          </li>
        ))}
      </ul>

      {!proposal && (
        <p className="mt-2 border-l-2 border-rule-strong pl-2.5 text-[0.75rem] leading-snug text-ink-faint">
          {line.text}
        </p>
      )}

      {proposal && (
        <div className="mt-2 space-y-1.5">
          <p className="border-l-2 border-rule-strong pl-2.5 text-[0.75rem] leading-snug text-ink-faint line-through">
            {line.text}
          </p>
          <p className="border-l-2 border-traced pl-2.5 text-[0.8125rem] leading-snug text-ink">
            {proposal.text}
          </p>
          {proposal.note && (
            <p className="text-[0.6875rem] leading-snug text-ink-faint">{proposal.note}</p>
          )}
          {/*
            Traced, or the user's own word. The rewriter cites the facts it
            drew on and the guard checked them, so this is the same promise
            the rest of the document makes.
          */}
          <p className="text-[0.6875rem] text-ink-faint">
            {proposal.sourceIds.length > 0
              ? `Traced to ${proposal.sourceIds.join(", ")}. Verified before being offered.`
              : "Verified against your resume before being offered."}
          </p>
        </div>
      )}

      {message && (
        <p role="status" className="mt-2 text-[0.75rem] leading-snug text-caution">
          {message}
        </p>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        {!proposal ? (
          <button
            type="button"
            onClick={ask}
            disabled={busy}
            className="rounded-md bg-stamp px-3 py-1 text-[0.8125rem] font-medium text-paper-raised disabled:opacity-60"
          >
            {busy ? "Writing" : "Suggest a rewrite"}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={accept}
              className="rounded-md bg-traced px-3 py-1 text-[0.8125rem] font-medium text-paper-raised"
            >
              Use this
              {proposal.delta !== null && (
                <span className="ml-1.5 font-mono tabular-nums">
                  {proposal.delta > 0 ? "+" : ""}
                  {proposal.delta.toFixed(1)}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setProposal(null)}
              className="text-[0.8125rem] text-ink-muted underline underline-offset-2"
            >
              Discard
            </button>
          </>
        )}
      </div>
    </article>
  );
}
