"use client";

/**
 * What the number is measured against.
 *
 * "43 out of 100" is unanchored: out of what population? There is no
 * population - the score is an internal measurement, not a percentile - so
 * the figure gets either ignored or over-read.
 *
 * The ceiling anchors it without needing a reference distribution. It is
 * what restoration alone would reach: every term already in the parsed
 * resume that the rewrite dropped, put back, one at a time, scored as it
 * goes. Two numbers a person can act on, and the second one is arithmetic
 * over the same scorer that produced the first.
 *
 * The verdict is the gap, not the score:
 *
 *   wide gap    a work list, and every item on it is already true
 *   narrow gap
 *   on a low
 *   score       this posting is not winnable from this resume, which is
 *               worth more to a candidate than another rewrite
 *
 * Nothing here counts a term that is merely absent. Adding one of those is
 * the user's own claim, and a ceiling built from claims is a promise the
 * product cannot keep. Those are named separately, because supplying the
 * evidence is the one thing that legitimately raises this number.
 */

import type { Ceiling } from "@/lib/editor/ceiling";

/** Below this, restoration is not going to rescue the application. */
const NOT_WINNABLE = 55;
/** Worth calling out as a real work list rather than a rounding error. */
const WORTH_DOING = 3;

export function CeilingLine({ ceiling }: { ceiling: Ceiling | null }) {
  if (!ceiling) return null;

  const { current, ceiling: top, headroom, steps, blockedByEvidence } = ceiling;
  const stuck = headroom < WORTH_DOING;
  const hopeless = stuck && top < NOT_WINNABLE;

  return (
    <section aria-label="Honest ceiling" className="mt-3 border-t border-rule pt-2.5">
      {headroom >= WORTH_DOING ? (
        <>
          <p className="text-[0.8125rem] leading-snug text-ink">
            Putting back what your resume already says reaches{" "}
            <span className="font-mono tabular-nums text-traced">{top.toFixed(0)}</span>
            <span className="text-ink-faint"> from </span>
            <span className="font-mono tabular-nums text-ink-muted">{current.toFixed(0)}</span>.
          </p>
          <p className="mt-0.5 text-[0.75rem] leading-snug text-ink-faint">
            Every step below is already true of you, so none of it is a new claim.
          </p>

          <details className="mt-1.5">
            <summary className="cursor-pointer list-none text-[0.75rem] text-stamp underline underline-offset-2 select-none">
              {steps.length} {steps.length === 1 ? "step" : "steps"} to get there
            </summary>
            <ol className="mt-1.5 space-y-1">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-2 text-[0.75rem] leading-snug">
                  <span className="font-mono tabular-nums text-traced">
                    +{step.gained.toFixed(1)}
                  </span>
                  <span className="text-ink-muted">
                    <span className="text-ink">{step.term}</span> — {step.label.toLowerCase()}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </>
      ) : (
        <p className="text-[0.8125rem] leading-snug text-ink">
          {hopeless
            ? "There is nothing honest left to add for this posting, and this is as far as this resume reaches. Worth weighing against a closer role."
            : "Everything your resume already supports is on the page. This is its honest ceiling here."}
        </p>
      )}

      {blockedByEvidence.length > 0 && (
        <p className="mt-2 text-[0.75rem] leading-snug text-caution">
          Higher than {top.toFixed(0)} needs evidence this resume does not carry:{" "}
          <span className="text-ink">{blockedByEvidence.slice(0, 5).join(", ")}</span>. If you have
          done these, say where and they stop being guesses.
        </p>
      )}
    </section>
  );
}
