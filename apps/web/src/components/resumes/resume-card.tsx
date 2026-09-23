/**
 * One row of the list.
 *
 * Laid out as a docket entry rather than a card: hairline rules, the title in
 * serif, the metadata in mono, and the score set large on the right where the
 * eye lands after the title. Scores are never coloured green for "good" alone;
 * the band is stated in words next to the numeral, because a colour is not
 * readable to everyone and 68 means nothing without a scale.
 */

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ResumeListItem } from "@/lib/supabase/types";

const STATUS_TONE: Record<string, string> = {
  draft: "border-rule-strong text-ink-muted",
  applied: "border-ink text-ink",
  screening: "border-caution text-caution",
  interviewing: "border-caution text-caution",
  offer: "border-traced text-traced",
  rejected: "border-stamp text-stamp",
  abandoned: "border-rule text-ink-faint",
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
  const tone = STATUS_TONE[resume.status] ?? "border-rule-strong text-ink-muted";

  return (
    <li className="group">
      <Link
        href={`/resume/${resume.id}`}
        className="flex items-start gap-4 border-b border-rule px-4 py-5 transition-colors hover:bg-paper-raised sm:px-5"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h3 className="font-display text-xl leading-tight text-ink">
              {resume.title || "Untitled resume"}
            </h3>
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[0.625rem] tracking-[0.1em] uppercase ${tone}`}
            >
              {resume.status}
            </span>
          </div>

          <p className="mt-1.5 text-[0.875rem] leading-snug text-ink-muted">
            {resume.targetRole ? (
              <>
                <span className="text-ink">{resume.targetRole}</span>
                {resume.company ? (
                  <span className="text-ink-faint"> at {resume.company}</span>
                ) : null}
              </>
            ) : (
              <span className="text-ink-faint">
                No job attached yet. Open it to paste a posting.
              </span>
            )}
          </p>

          <p className="mt-2 font-mono text-[0.6875rem] tracking-wide text-ink-faint">
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
              <p className="mt-2.5 max-w-[9rem] text-[0.6875rem] leading-snug text-ink-faint">
                Not scored yet
              </p>
            </>
          ) : (
            <>
              <p className="font-mono text-3xl leading-none text-ink tabular-nums">
                {Math.round(resume.score)}
                <span className="text-sm text-ink-faint">/100</span>
              </p>
              <p className="mt-1.5 text-[0.6875rem] tracking-wide text-ink-faint uppercase">
                {scoreBand(resume.score)}
              </p>
            </>
          )}
        </div>

        <ArrowUpRight
          aria-hidden="true"
          className="mt-1 size-4 shrink-0 text-rule-strong transition-colors group-hover:text-stamp"
        />
      </Link>
    </li>
  );
}
