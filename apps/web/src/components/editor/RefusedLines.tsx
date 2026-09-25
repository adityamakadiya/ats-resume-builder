"use client";

/**
 * Lines the guard refused, in the rail rather than over the whole screen.
 *
 * This replaced a full-screen modal that opened by itself after every run.
 * The information was right and unreadable: each refusal was three labelled
 * blocks stacked - the rewrite's attempt struck through, the source quoted
 * in full, then the reason - so a single refused summary filled a screen,
 * and a six-line paragraph with a line through it is not something anyone
 * reads. Three of those and the user closed the dialog without learning
 * anything, which is the worst outcome for the one feature that is the
 * product's whole argument.
 *
 * So: one row each. What was dropped, why, and the only action there is.
 * Short enough to actually read, and it sits next to the document instead
 * of covering it, so the user can look at the line while deciding.
 *
 * The full text is one disclosure away rather than always on, because the
 * thing a person needs first is which claim was dropped, not the paragraph
 * it came from.
 */

import type { TruthViolation } from "@ats/core";
import { REFUSAL_REASON } from "@/lib/editor/sources";

/** Enough to recognise the line, short enough to read in a rail. */
const PREVIEW = 120;

function shorten(text: string): { head: string; rest: string } {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= PREVIEW) return { head: clean, rest: "" };
  const cut = clean.lastIndexOf(" ", PREVIEW);
  const at = cut > PREVIEW - 30 ? cut : PREVIEW;
  return { head: `${clean.slice(0, at)}…`, rest: clean.slice(at).trim() };
}

/** "Experience / Bacancy Technology / bullet 9" -> "Bacancy Technology, bullet 9" */
function place(location: string): string {
  const parts = location
    .split("/")
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join(", ") : location;
}

function label(code: string): string {
  return code.toLowerCase().replace(/_/g, " ");
}

export function RefusedLines({
  violations,
  onDrop,
}: {
  violations: Array<{ index: number; violation: TruthViolation }>;
  onDrop: (index: number) => void;
}) {
  if (violations.length === 0) return null;

  return (
    <ul className="space-y-3">
      {violations.map(({ index, violation }) => {
        const { head, rest } = shorten(violation.offending || violation.detail);
        const reason = REFUSAL_REASON[violation.code] ?? violation.detail;

        return (
          <li key={index} className="border-l-2 border-[color:var(--refused)] pl-3">
            <p className="text-[0.6875rem] tracking-wide text-ink-faint uppercase">
              {label(violation.code)}
              {violation.location ? ` · ${place(violation.location)}` : ""}
            </p>

            {/*
              Quoted, not struck through. A line through a long sentence is
              a texture rather than a signal, and these are already under a
              heading that says they were removed.
            */}
            <p className="mt-1 text-[0.8125rem] leading-snug text-ink">
              <span data-refused-head="">“{head}”</span>
              {rest && (
                <>
                  {" "}
                  <details className="inline">
                    <summary className="inline cursor-pointer text-[0.75rem] text-stamp underline underline-offset-2">
                      full text
                    </summary>
                    <span className="text-ink-muted">{rest}</span>
                  </details>
                </>
              )}
            </p>

            <p className="mt-1 text-[0.75rem] leading-snug text-ink-muted">{reason}</p>

            <button
              type="button"
              onClick={() => onDrop(index)}
              className="mt-1.5 text-[0.75rem] text-ink-faint underline underline-offset-2 hover:text-[color:var(--refused)]"
            >
              Dismiss
            </button>
          </li>
        );
      })}
    </ul>
  );
}
