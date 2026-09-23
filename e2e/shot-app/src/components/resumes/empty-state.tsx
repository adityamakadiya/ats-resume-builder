/**
 * The empty list.
 *
 * An empty state earns its space by teaching. This one says what the product
 * will do, in the order it will do it, and ends on the sentence that is the
 * whole reason to use it rather than a competitor: nothing gets written that
 * cannot be traced back to a line the candidate already wrote.
 *
 * A white card on the cool page, with the three steps numbered in the one
 * action colour. The ruled-paper texture belonged to the editorial theme and
 * read as noise behind body copy at this size.
 */

import Link from "next/link";
import { ArrowRight, Upload } from "lucide-react";
import { LinkButton } from "@/components/link-button";

const STEPS = [
  {
    title: "Upload the resume you already have",
    body: "PDF or DOCX. We read it into facts, each one addressed to the line it came from.",
  },
  {
    title: "Paste the job description",
    body: "One posting at a time. We pull out what it actually asks for, separately from how it asks for it.",
  },
  {
    title: "Read the rewrite, line by line",
    body: "Every rewritten bullet shows the fact it is traced to. Anything we cannot trace is shown to you rather than shipped.",
  },
];

export function ResumesEmptyState() {
  return (
    <section
      aria-labelledby="empty-heading"
      className="rounded-xl border border-rule bg-paper-raised px-5 py-8 shadow-xs sm:px-10 sm:py-12"
    >
      <p className="inline-flex items-center rounded-full bg-paper-sunk px-2.5 py-1 text-[0.75rem] font-medium text-ink-muted">
        No resumes yet
      </p>
      <h2
        id="empty-heading"
        className="mt-3.5 max-w-[22ch] text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-[2rem]"
      >
        Your first one takes about four minutes.
      </h2>
      <p className="mt-3 max-w-[52ch] text-[0.9375rem] leading-relaxed text-ink-muted">
        Bring the resume you have been sending out. You do not need to tidy it
        first, and you do not need to write anything new.
      </p>

      <ol className="mt-8 grid max-w-3xl gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="rounded-lg border border-rule bg-paper-sunk/50 p-4"
          >
            <span
              aria-hidden="true"
              className="grid size-6 place-items-center rounded-full bg-stamp-soft text-[0.75rem] font-semibold text-[var(--stamp-strong)]"
            >
              {index + 1}
            </span>
            <span className="mt-3 block text-[0.9375rem] leading-snug font-medium text-ink">
              {step.title}
            </span>
            <span className="mt-1.5 block text-[0.8125rem] leading-relaxed text-ink-muted">
              {step.body}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <LinkButton size="lg" className="gap-2" href="/start">
          <Upload aria-hidden="true" />
          Upload your resume
        </LinkButton>
        <Link
          href="/start/template"
          className="inline-flex items-center gap-1.5 rounded-md px-1 py-2 text-[0.875rem] font-medium text-[var(--stamp-strong)] underline-offset-4 hover:underline"
        >
          Or start from a blank template
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      <p className="mt-9 max-w-[56ch] border-t border-rule pt-5 text-[0.8125rem] leading-relaxed text-ink-muted">
        The score you will see is computed by formula from the posting and the
        document, not estimated by a model. Change a line and it re-scores
        immediately, with the same arithmetic every time.
      </p>
    </section>
  );
}
