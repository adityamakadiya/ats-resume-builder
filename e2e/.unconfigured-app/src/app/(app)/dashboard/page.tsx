/**
 * /dashboard
 *
 * Deliberately thin. Every number on it is counted from rows that exist;
 * none of it is a projection, a trend or a "productivity score". A dashboard
 * that invents figures would be the same failure the product exists to
 * prevent, one screen earlier.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { LinkButton } from "@/components/link-button";
import { SetupNotice } from "@/components/setup-notice";
import { ResumeCard } from "@/components/resumes/resume-card";
import { listResumes } from "@/lib/supabase/resumes";

export const metadata: Metadata = {
  title: "Dashboard | Tailor",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const result = await listResumes();

  if (result.state === "unconfigured") {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:px-6">
        <SetupNotice context="Your dashboard" />
      </div>
    );
  }

  const resumes = result.state === "ok" ? result.resumes : [];
  const scored = resumes.filter((resume) => resume.score !== null);
  const best = scored.length
    ? Math.max(...scored.map((resume) => resume.score as number))
    : null;
  const live = resumes.filter((resume) =>
    ["applied", "screening", "interviewing"].includes(resume.status)
  ).length;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <p className="label">Overview</p>
        <h1 className="mt-2 font-display text-4xl leading-none text-ink sm:text-5xl">
          Dashboard
        </h1>
      </header>

      {result.state === "failed" ? (
        <p
          role="alert"
          className="mt-8 rounded-xs border-l-2 border-stamp bg-stamp-soft/60 px-4 py-3 text-[0.875rem] leading-relaxed text-ink"
        >
          <span className="font-medium text-stamp">{result.reason}</span>{" "}
          {result.remedy}
        </p>
      ) : null}

      <dl className="mt-8 grid grid-cols-1 gap-px border border-rule bg-rule sm:grid-cols-3">
        <Figure label="Resumes" value={String(resumes.length)} note="in your library" />
        <Figure
          label="Best score"
          value={best === null ? "none" : String(Math.round(best))}
          note={best === null ? "nothing scored yet" : "computed, out of 100"}
        />
        <Figure
          label="Out with employers"
          value={String(live)}
          note="applied, screening or interviewing"
        />
      </dl>

      <section className="mt-10">
        <div className="flex items-end justify-between gap-4 border-b border-rule pb-2">
          <p className="label">Recently edited</p>
          {resumes.length > 0 ? (
            <Link
              href="/resumes"
              className="inline-flex items-center gap-1 rounded-xs text-[0.8125rem] text-ink-muted hover:text-ink"
            >
              See all
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          ) : null}
        </div>

        {resumes.length === 0 ? (
          <div className="sheet mt-0 rounded-xs border-t-0 px-5 py-10 text-center">
            <p className="max-w-[46ch] mx-auto text-[0.9375rem] leading-relaxed text-ink-muted">
              Nothing here yet. Upload the resume you have been sending out and
              Tailor will rewrite it against one posting, showing the source
              line behind every change.
            </p>
            <LinkButton
              size="lg"
              className="mt-6 gap-2 rounded-xs bg-stamp px-5 py-5 text-paper-raised hover:bg-stamp/90"
              href="/start"
            >
              <Plus aria-hidden="true" />
              Start your first one
            </LinkButton>
          </div>
        ) : (
          <ul className="sheet rounded-xs border-t-0">
            {resumes.slice(0, 5).map((resume) => (
              <ResumeCard key={resume.id} resume={resume} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Figure({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="bg-paper-raised px-5 py-5">
      <dt className="label">{label}</dt>
      <dd className="mt-2 font-mono text-3xl leading-none text-ink tabular-nums">
        {value}
      </dd>
      <p className="mt-2 text-[0.75rem] leading-snug text-ink-faint">{note}</p>
    </div>
  );
}
