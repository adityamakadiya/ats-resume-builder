/**
 * One row of the list.
 *
 * A white card with a hairline, not a ruled docket entry: the chrome around
 * the document should read as product, and a card is what a list of things
 * you own looks like. The score sits large on the right where the eye lands
 * after the title. Scores are never coloured green for "good" alone; the
 * band is stated in words next to the numeral, because a colour is not
 * readable to everyone and 68 means nothing without a scale.
 */

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ResumeListItem } from "@/lib/supabase/types";

const STATUS_TONE: Record<string, string> = {
  draft: "bg-paper-sunk text-ink-muted",
  applied: "bg-stamp-soft text-[var(--stamp-strong)]",
  screening: "bg-[var(--caution-soft)] text-[var(--caution)]",
  interviewing: "bg-[var(--caution-soft)] text-[var(--caution)]",
  offer: "bg-traced-soft text-traced",
  rejected: "bg-[var(--refused-soft)] text-[var(--refused)]",
  abandoned: "bg-paper-sunk text-ink-muted",
};

function scoreBand(score: number): string {
  if (score >= 80) return "strong match";
  if (score >= 65) return "workable";
  if (score >= 50) return "thin";
  return "weak match";
}

function relativeDate(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ResumeCard({ resume }: { resume: ResumeListItem }) {
  const tone = STATUS_TONE[resume.status] ?? "bg-paper-sunk text-ink-muted";

  return (
    <li className="group">
      <Link
        href={`/resume/${resume.id}`}
        className="flex items-start gap-4 rounded-xl border border-rule bg-paper-raised px-4 py-4 shadow-xs transition-colors hover:border-rule-strong hover:bg-paper-sunk/40 sm:px-5 sm:py-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h3 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">
              {resume.title || "Untitled resume"}
            </h3>
            <span
              className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium capitalize ${tone}`}
            >
              {resume.status}
            </span>
          </div>

          <p className="mt-1.5 text-[0.875rem] leading-snug text-ink-muted">
            {resume.targetRole ? (
              <>
                <span className="text-ink">{resume.targetRole}</span>
                {resume.company ? (
                  <span className="text-ink-muted"> at {resume.company}</span>
                ) : null}
              </>
            ) : (
              <span className="text-ink-muted">
                No job attached yet. Open it to paste a posting.
              </span>
            )}
          </p>

          <p className="mt-2 text-[0.75rem] text-ink-muted">
            {resume.template_id} &middot; edited {relativeDate(resume.updated_at)}
          </p>
        </div>

        <div className="shrink-0 pt-0.5 text-right">
          {resume.score === null ? (
            <>
              {/* A drawn rule, not a dash character: the copy rules here
                  forbid em dashes, and a glyph would be one. */}
              <span
                aria-hidden="true"
                className="mx-auto block h-0.5 w-6 bg-rule-strong"
              />
              <p className="mt-2.5 max-w-[9rem] text-[0.6875rem] leading-snug text-ink-muted">
                Not scored yet
              </p>
            </>
          ) : (
            <>
              <p className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em] text-ink tabular-nums">
                {Math.round(resume.score)}
                <span className="text-sm font-normal text-ink-muted">/100</span>
              </p>
              <p className="mt-1.5 text-[0.6875rem] text-ink-muted">
                {scoreBand(resume.score)}
              </p>
            </>
          )}
        </div>

        <ArrowUpRight
          aria-hidden="true"
          className="mt-1.5 size-4 shrink-0 text-rule-strong transition-colors group-hover:text-stamp"
        />
      </Link>
    </li>
  );
}
