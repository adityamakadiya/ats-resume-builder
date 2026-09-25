"use client";

/**
 * What the guard actually covers, and what it does not.
 *
 * The word "verified" is banned from this component on purpose. Verified would
 * mean somebody confirmed the claims are true, and nobody did. What happened
 * is narrower and more defensible: every line the model wrote was checked
 * against a fact extracted from the resume the user uploaded, and the ones
 * that did not trace were refused.
 *
 * A line the user typed afterwards has had none of that done to it. It might
 * be perfectly true; the guard has no opinion, and a badge that quietly
 * absorbs hand edits into a green count would be the exact dishonesty this
 * product exists to refuse. So hand edits get their own number, in the caution
 * colour, with a sentence saying they are not covered.
 */

export type TracedBadgeProps = {
  traced: number;
  total: number;
  editedCount: number;
  refusedCount: number;
};

export function TracedBadge({
  traced,
  total,
  editedCount,
  refusedCount,
}: TracedBadgeProps) {
  const lines = (n: number) => (n === 1 ? "line" : "lines");

  return (
    /*
      No heading and no rule of its own: this sits inside a fold that
      already provides both, and two "Provenance" headings one above the
      other is what you get when a component is moved without being looked
      at.
    */
    <section aria-label="Provenance detail">
      <p className="mt-0.5 text-[0.8125rem] leading-snug">
        <span className="font-mono tabular-nums text-traced">{traced}</span>
        <span className="text-ink-muted">
          {" "}
          of {total} {lines(total)} traced to your resume
        </span>
      </p>

      <p className="mt-1 text-[0.8125rem] leading-snug">
        <span
          className={`font-mono tabular-nums ${editedCount > 0 ? "text-caution" : "text-ink-faint"}`}
        >
          {editedCount}
        </span>
        <span className="text-ink-muted"> hand-edited by you</span>
      </p>

      {editedCount > 0 && (
        <p className="mt-1.5 max-w-[34ch] text-[0.75rem] leading-snug text-caution">
          The guard did not check {editedCount === 1 ? "that one" : "those"}. It only checks
          what the model wrote. Anything you type is your claim to defend.
        </p>
      )}

      {/*
        A statement rather than a link. It used to open the refusal dialog;
        the refusals now have their own section higher up this column, so
        pointing at one from down here would be sending the reader
        backwards past the thing they were already shown.
      */}
      {refusedCount > 0 && (
        <p className="mt-1.5 text-[0.8125rem] leading-snug text-ink-muted">
          <span className="font-mono tabular-nums text-[color:var(--refused)]">
            {refusedCount}
          </span>{" "}
          {lines(refusedCount)} refused, listed above.
        </p>
      )}
    </section>
  );
}
