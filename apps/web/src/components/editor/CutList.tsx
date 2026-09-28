"use client";

/**
 * What to cut, and what each cut costs.
 *
 * The overflow banner used to end at "cut a bullet". This is the rest of
 * that sentence. Every row is a real line off the page with a real number
 * beside it, computed by applying the deletion and rescoring, so the person
 * deciding is reading arithmetic rather than a hunch about which of their
 * achievements matters least.
 *
 * ONE PRESS, NO CONFIRMATION, AND WHY THAT IS SAFE HERE. Unlike the rewrite
 * card there is nothing to read first: the row already shows the exact text
 * that goes and the exact points it takes with it, and the store records the
 * removal as an ordinary patch, so undo puts it back with the inverse ops.
 * A confirmation step would be asking the same question twice.
 *
 * The zero rows are the product. A line that costs 0.0 is one the scorer
 * cannot tell the page had, and a negative one is a line the document is
 * better off without, so those are labelled in words rather than left as a
 * number people have to interpret in the middle of a stressful edit.
 */

import type { Op } from "@ats/core";
import type { Cut } from "@/lib/editor/trim";

export function CutList({
  cuts,
  onApply,
}: {
  cuts: readonly Cut[];
  onApply: (ops: Op[], label: string, path: string) => void;
}) {
  if (cuts.length === 0) return null;

  return (
    <section aria-label="What to cut" className="mt-4 border-t border-rule pt-3">
      <h3 className="label">What to cut</h3>
      <p className="mt-1 mb-2 text-[0.75rem] leading-snug text-ink-faint">
        Ordered by what each one costs, cheapest first, measured by removing it and
        scoring the document again. The top of this list is what you lose least by
        dropping.
      </p>

      <ul className="space-y-1.5">
        {cuts.map((cut) => (
          <li key={cut.path}>
            <CutRow cut={cut} onApply={onApply} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function CutRow({
  cut,
  onApply,
}: {
  cut: Cut;
  onApply: (ops: Op[], label: string, path: string) => void;
}) {
  return (
    <article
      data-cut={cut.kind}
      data-cost={cut.cost.toFixed(1)}
      className="rounded-lg border border-rule bg-paper px-3 py-2"
    >
      <header className="flex items-baseline gap-2">
        <h4 className="text-[0.75rem] font-medium tracking-wide text-ink-muted uppercase">
          {cut.where}
        </h4>
        <span className="ml-auto font-mono text-[0.6875rem] whitespace-nowrap text-ink-faint">
          about {cut.lines} {cut.lines === 1 ? "line" : "lines"}
        </span>
      </header>

      <p className="mt-1.5 border-l-2 border-rule-strong pl-2.5 text-[0.75rem] leading-snug text-ink-faint">
        {cut.text}
      </p>

      <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-muted">{cut.why}</p>

      {/*
        Offered above the delete button, not beside it. A bullet flagged as
        too long is over budget because of its last line, not because of
        what it says, and deleting the claim to save that line is the worse
        trade of the two.
      */}
      {cut.shorten && (
        <p className="mt-1.5 text-[0.75rem] leading-snug text-caution">
          {cut.shorten.why} Shortening it frees about {cut.shorten.lines}{" "}
          {cut.shorten.lines === 1 ? "line" : "lines"} of the {cut.lines}, and the
          Writing tab will draft the shorter version.
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onApply(cut.ops, `Cut ${cut.where}`, cut.path)}
          className="rounded-md border border-rule-strong px-3 py-1 text-[0.8125rem] font-medium text-ink"
        >
          Cut it
        </button>
        <CostLabel cost={cut.cost} />
      </div>
    </article>
  );
}

/**
 * The price, in the three readings it can have.
 *
 * Rounded to a tenth like every other number in the editor, and never
 * dressed up: a cut that costs four points says four points, because the
 * user deciding between this page fitting and a line they are proud of is
 * entitled to the same number the header is showing them.
 */
function CostLabel({ cost }: { cost: number }) {
  if (cost <= -0.05) {
    return (
      <span className="font-mono text-[0.75rem] tabular-nums text-traced">
        +{Math.abs(cost).toFixed(1)}, the score goes up
      </span>
    );
  }
  if (cost < 0.05) {
    return <span className="text-[0.75rem] text-traced">Free, the score does not move</span>;
  }
  return (
    <span className="font-mono text-[0.75rem] tabular-nums text-caution">
      -{cost.toFixed(1)}
    </span>
  );
}
