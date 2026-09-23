/**
 * /resumes
 *
 * The list. Four states, each with its own copy:
 *   unconfigured  the setup checklist
 *   failed        what broke and what to run
 *   empty         the teaching state, in components/resumes/empty-state
 *   ok            the docket
 */

import type { Metadata } from "next";
import Link from "next/link";
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
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Library</p>
          <h1 className="mt-2 font-display text-4xl leading-none text-ink sm:text-5xl">
            My resumes
          </h1>
        </div>

        {result.state === "ok" && result.resumes.length > 0 ? (
          <LinkButton
            size="lg"
            className="gap-2 rounded-xs bg-stamp px-4 py-5 text-paper-raised hover:bg-stamp/90"
            href="/start"
          >
            <Plus aria-hidden="true" />
            New resume
          </LinkButton>
        ) : null}
      </header>

      <div className="mt-8">
        {result.state === "unconfigured" ? (
          <SetupNotice context="Your resume library" />
        ) : result.state === "signed-out" ? (
          <SignedOut />
        ) : result.state === "failed" ? (
          <LoadFailed reason={result.reason} remedy={result.remedy} />
        ) : result.resumes.length === 0 ? (
          <ResumesEmptyState />
        ) : (
          <>
            <p className="label border-b border-rule pb-2">
              {result.resumes.length}{" "}
              {result.resumes.length === 1 ? "resume" : "resumes"}, newest edit
              first
            </p>
            <ul className="sheet rounded-xs border-t-0">
              {result.resumes.map((resume) => (
                <ResumeCard key={resume.id} resume={resume} />
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function SignedOut() {
  return (
    <section className="sheet rounded-xs px-6 py-10 text-center">
      <p className="label">Session ended</p>
      <h2 className="mt-3 font-display text-3xl text-ink">You have been signed out</h2>
      <p className="mx-auto mt-3 max-w-[44ch] text-[0.9375rem] leading-relaxed text-ink-muted">
        Nothing was lost. Your resumes are on the server and will be here when
        you come back.
      </p>
      <LinkButton
        size="lg"
        className="mt-6 rounded-xs bg-stamp px-5 py-5 text-paper-raised hover:bg-stamp/90"
        href="/login?next=/resumes"
      >
        Sign in again
      </LinkButton>
    </section>
  );
}

function LoadFailed({ reason, remedy }: { reason: string; remedy: string }) {
  return (
    <section role="alert" className="sheet rounded-xs px-6 py-10">
      <p className="label text-stamp">Could not load</p>
      <h2 className="mt-3 font-display text-3xl leading-tight text-ink">{reason}</h2>
      <p className="mt-3 max-w-[56ch] text-[0.9375rem] leading-relaxed text-ink-muted">
        {remedy}
      </p>
      <p className="mt-6 border-t border-rule pt-4 text-[0.8125rem] leading-relaxed text-ink-faint">
        Your data is untouched. This screen only reads.
      </p>
    </section>
  );
}
