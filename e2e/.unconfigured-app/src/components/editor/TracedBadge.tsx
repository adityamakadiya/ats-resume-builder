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
  onShowRefused?: () => void;
};

export function TracedBadge({
  traced,
  total,
  editedCount,
  refusedCount,
  onShowRefused,
}: TracedBadgeProps) {
  const lines = (n: number) => (n === 1 ? "line" : "lines");

  return (
    <section aria-labelledby="traced-heading" className="border-t border-rule pt-3">
      <h2 id="traced-heading" className="label">
        Provenance
      </h2>

      <p className="mt-1.5 text-[0.8125rem] leading-snug">
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

      {refusedCount > 0 && (
        <button
          type="button"
          onClick={onShowRefused}
          className="mt-2 inline-flex items-center gap-1.5 text-[0.8125rem] text-stamp underline underline-offset-4 hover:text-ink"
        >
          {refusedCount} {lines(refusedCount)} refused. See why
        </button>
      )}
    </section>
  );
}
