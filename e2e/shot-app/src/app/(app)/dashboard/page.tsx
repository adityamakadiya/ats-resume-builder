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
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
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
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-[1.75rem]">
          Dashboard
        </h1>
        <p className="mt-1 text-[0.875rem] text-ink-muted">
          Counted from what is actually in your library. Nothing here is
          projected.
        </p>
      </header>

      {result.state === "failed" ? (
        <p
          role="alert"
          className="mt-7 rounded-lg border border-[var(--refused)]/25 bg-[var(--refused-soft)] px-4 py-3 text-[0.875rem] leading-relaxed text-ink"
        >
          <span className="font-medium text-[var(--refused)]">{result.reason}</span>{" "}
          {result.remedy}
        </p>
      ) : null}

      <dl className="mt-7 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      <section className="mt-9">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">
            Recently edited
          </h2>
          {resumes.length > 0 ? (
            <Link
              href="/resumes"
              className="inline-flex items-center gap-1 rounded-md px-1 py-1 text-[0.8125rem] font-medium text-[var(--stamp-strong)] hover:underline"
            >
              See all
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </Link>
          ) : null}
        </div>

        {resumes.length === 0 ? (
          <div className="mt-4 rounded-xl border border-rule bg-paper-raised px-5 py-10 text-center shadow-xs">
            <p className="mx-auto max-w-[46ch] text-[0.9375rem] leading-relaxed text-ink-muted">
              Nothing here yet. Upload the resume you have been sending out and
              Tailor will rewrite it against one posting, showing the source
              line behind every change.
            </p>
            <LinkButton size="lg" className="mt-6 gap-2" href="/start">
              <Plus aria-hidden="true" />
              Start your first one
            </LinkButton>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
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
    <div className="rounded-xl border border-rule bg-paper-raised px-5 py-5 shadow-xs">
      <dt className="text-[0.8125rem] font-medium text-ink-muted">{label}</dt>
      <dd className="mt-2.5 text-[1.875rem] leading-none font-semibold tracking-[-0.03em] text-ink tabular-nums">
        {value}
      </dd>
      <dd className="mt-2 text-[0.75rem] leading-snug text-ink-muted">{note}</dd>
    </div>
  );
}
