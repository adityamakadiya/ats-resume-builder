/**
 * The empty list.
 *
 * An empty state earns its space by teaching. This one says what the product
 * will do, in the order it will do it, and ends on the sentence that is the
 * whole reason to use it rather than a competitor: nothing gets written that
 * cannot be traced back to a line the candidate already wrote.
 *
 * Set on ruled paper, because an empty form is a more honest picture of
 * "nothing here yet" than an illustration of a cardboard box.
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
      className="sheet relative overflow-hidden rounded-xs"
    >
      <div
        aria-hidden="true"
        className="ruled pointer-events-none absolute inset-0 opacity-40"
      />

      <div className="relative px-5 py-10 sm:px-10 sm:py-14">
        <p className="label">No resumes yet</p>
        <h2
          id="empty-heading"
          className="mt-3 max-w-[18ch] font-display text-4xl leading-[1.05] text-ink sm:text-5xl"
        >
          Your first one takes about four minutes.
        </h2>
        <p className="mt-4 max-w-[52ch] text-[0.9375rem] leading-relaxed text-ink-muted">
          Bring the resume you have been sending out. You do not need to tidy
          it first, and you do not need to write anything new.
        </p>

        <ol className="mt-9 max-w-2xl space-y-0 border-t border-rule">
          {STEPS.map((step, index) => (
            <li
              key={step.title}
              className="flex gap-4 border-b border-rule py-4 sm:gap-6"
            >
              <span
                aria-hidden="true"
                className="mt-0.5 font-mono text-[0.75rem] tracking-wider text-stamp"
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span>
                <span className="block text-[0.9375rem] leading-snug text-ink">
                  {step.title}
                </span>
                <span className="mt-1 block text-[0.8125rem] leading-relaxed text-ink-muted">
                  {step.body}
                </span>
              </span>
            </li>
          ))}
        </ol>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <LinkButton
            size="lg"
            className="gap-2 rounded-xs bg-stamp px-5 py-5 text-[0.9375rem] text-paper-raised hover:bg-stamp/90"
            href="/start"
          >
            <Upload aria-hidden="true" />
            Upload your resume
          </LinkButton>
          <Link
            href="/start/template"
            className="inline-flex items-center gap-1.5 rounded-xs px-1 py-2 text-[0.875rem] text-ink-muted underline decoration-rule-strong underline-offset-4 hover:text-ink"
          >
            Or start from a blank template
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </div>

        <p className="mt-10 max-w-[56ch] border-t border-rule pt-5 text-[0.8125rem] leading-relaxed text-ink-faint">
          The score you will see is computed by formula from the posting and
          the document, not estimated by a model. Change a line and it
          re-scores immediately, with the same arithmetic every time.
        </p>
      </div>
    </section>
  );
}
