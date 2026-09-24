/**
 * /resumes
 *
 * The list. Four states, each with its own copy:
 *   unconfigured  the setup checklist
 *   failed        what broke and what to run
 *   empty         the teaching state, in components/resumes/empty-state
 *   ok            the list of cards
 */

import type { Metadata } from "next";
import { Plus } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { SetupNotice } from "@/components/setup-notice";
import { ResumeCard } from "@/components/resumes/resume-card";
import { ResumesEmptyState } from "@/components/resumes/empty-state";
import { listResumes } from "@/lib/supabase/resumes";

export const metadata: Metadata = {
  title: "My resumes | Tailor",
};

// The list must reflect a resume created seconds ago on /start.
export const dynamic = "force-dynamic";

export default async function ResumesPage() {
  const result = await listResumes();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-[1.75rem]">
            My resumes
          </h1>
          <p className="mt-1 text-[0.875rem] text-ink-muted">
            {result.state === "ok" && result.resumes.length > 0
              ? `${result.resumes.length} ${
                  result.resumes.length === 1 ? "resume" : "resumes"
                }, newest edit first`
              : "Everything you have tailored, in one place."}
          </p>
        </div>

        {result.state === "ok" && result.resumes.length > 0 ? (
          <LinkButton variant="outline" size="lg" className="gap-2" href="/start">
            <Plus aria-hidden="true" />
            New resume
          </LinkButton>
        ) : null}
      </header>

      <div className="mt-7">
        {result.state === "unconfigured" ? (
          <SetupNotice context="Your resume library" />
        ) : result.state === "failed" ? (
          <LoadFailed reason={result.reason} remedy={result.remedy} />
        ) : result.resumes.length === 0 ? (
          <ResumesEmptyState />
        ) : (
          <ul className="space-y-3">
            {result.resumes.map((resume) => (
              <ResumeCard key={resume.id} resume={resume} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LoadFailed({ reason, remedy }: { reason: string; remedy: string }) {
  return (
    <section
      role="alert"
      className="rounded-xl border border-rule bg-paper-raised px-6 py-10 shadow-xs"
    >
      <p className="inline-flex items-center rounded-full bg-[var(--refused-soft)] px-2.5 py-1 text-[0.75rem] font-medium text-[var(--refused)]">
        Could not load
      </p>
      <h2 className="mt-3.5 text-xl font-semibold tracking-[-0.015em] text-ink sm:text-2xl">
        {reason}
      </h2>
      <p className="mt-2.5 max-w-[56ch] text-[0.9375rem] leading-relaxed text-ink-muted">
        {remedy}
      </p>
      <p className="mt-6 border-t border-rule pt-4 text-[0.8125rem] leading-relaxed text-ink-muted">
        Your data is untouched. This screen only reads.
      </p>
    </section>
  );
}
