"use client";

/**
 * A change that has not happened yet.
 *
 * The difference between this product and a chat window that rewrites your
 * resume is that here a proposal is a separate object with a decision attached
 * to it. It shows what the line says now, what it would say, what it is worth
 * in points, and the reason it was proposed. Nothing is applied until Accept.
 *
 * The score delta is labelled as a projection, and it is computed rather than
 * asserted: the store applies the ops to a copy, scores the copy with the same
 * pure function the header uses, and subtracts. When the model's rationale and
 * the arithmetic disagree, the arithmetic is what is shown.
 *
 * Decline is not destructive and does not need a confirmation. It removes the
 * proposal and touches neither the document nor the score.
 */

import type { Op } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import { readString } from "@/lib/editor/doc";
import { describePath, diffWords } from "@/lib/editor/words";
import type { PendingPatch } from "@/lib/store/editor";

function InlineDiff({ before, after }: { before: string; after: string }) {
  const chunks = diffWords(before, after);
  return (
    <p className="text-[0.8125rem] leading-relaxed">
      {chunks.map((chunk, i) =>
        chunk.kind === "same" ? (
          <span key={i} className="text-ink-muted">
            {chunk.text}
          </span>
        ) : chunk.kind === "removed" ? (
          <del key={i} className="bg-[color:var(--refused-soft)] text-[color:var(--refused)] no-underline line-through">
            {chunk.text}
          </del>
        ) : (
          <ins key={i} className="bg-traced-soft text-traced no-underline">
            {chunk.text}
          </ins>
        ),
      )}
    </p>
  );
}

function OpRow({ doc, op, showChanges }: { doc: ResumeDoc; op: Op; showChanges: boolean }) {
  const before = readString(doc, op.path);
  const after = typeof op.value === "string" ? op.value : JSON.stringify(op.value ?? "");

  return (
    <li className="border-t border-rule px-3 py-2.5 first:border-t-0">
      <p className="label">{describePath(op.path)}</p>

      {op.op === "remove" ? (
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-[color:var(--refused)] line-through">{before}</p>
      ) : showChanges && op.op === "replace" ? (
        <div className="mt-1">
          <InlineDiff before={before} after={after} />
        </div>
      ) : (
        <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink">{after}</p>
      )}
    </li>
  );
}

export type PatchCardProps = {
  patch: PendingPatch;
  doc: ResumeDoc;
  showChanges: boolean;
  onToggleChanges: () => void;
  onAccept: (id: string) => void;
  onDecline: (id: string) => void;
};

export function PatchCard({
  patch,
  doc,
  showChanges,
  onToggleChanges,
  onAccept,
  onDecline,
}: PatchCardProps) {
  const delta = patch.delta;
  const sign = delta > 0 ? "+" : "";

  return (
    <article
      aria-label="Proposed change"
      className="rise overflow-hidden rounded-lg border border-rule border-l-2 border-l-stamp bg-paper-raised"
    >
      <header className="flex items-start justify-between gap-3 px-3 py-2.5">
        <p className="text-[0.8125rem] leading-snug text-ink">{patch.rationale}</p>
        <span
          aria-label={`Projected score change ${sign}${delta.toFixed(1)} points`}
          className={`shrink-0 rounded-md border px-1.5 py-0.5 font-mono text-[0.6875rem] tabular-nums ${
            delta > 0
              ? "border-traced/40 bg-traced-soft text-traced"
              : delta < 0
                ? "border-caution/40 bg-caution-soft text-caution"
                : "border-rule text-ink-faint"
          }`}
        >
          {sign}
          {delta.toFixed(1)} pts
        </span>
      </header>

      <ul className="border-t border-rule bg-paper-sunk/40">
        {patch.ops.map((op, i) => (
          <OpRow key={i} doc={doc} op={op} showChanges={showChanges} />
        ))}
      </ul>

      <footer className="flex flex-wrap items-center gap-2 border-t border-rule px-3 py-2.5">
        <button
          type="button"
          onClick={() => onAccept(patch.id)}
          className="rounded-md bg-stamp px-3.5 py-1.5 text-[0.8125rem] font-medium text-paper-raised transition-colors hover:bg-[color:var(--stamp-strong)]"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={() => onDecline(patch.id)}
          className="rounded-md border border-rule-strong px-3 py-1 text-[0.8125rem] text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={onToggleChanges}
          aria-pressed={showChanges}
          className="ml-auto font-mono text-[0.625rem] tracking-wider text-ink-faint uppercase underline underline-offset-4 hover:text-ink"
        >
          {showChanges ? "Show result" : "Show changes"}
        </button>
      </footer>

      <p className="px-3 pb-2.5 text-[0.75rem] leading-snug text-ink-faint">
        Projected against the document as it stands. Declining changes nothing.
      </p>
    </article>
  );
}
