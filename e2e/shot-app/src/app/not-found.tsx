/**
 * 404.
 *
 * Says which two places actually exist rather than offering a search box
 * over a product with six screens.
 */

import { Wordmark } from "@/components/brand";
import { LinkButton } from "@/components/link-button";

export default function NotFound() {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 py-5 sm:px-8">
        <Wordmark />
      </header>
      <main
        id="main"
        className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8"
      >
        <section className="w-full max-w-lg rounded-xl border border-rule bg-paper-raised p-6 shadow-xs sm:p-8">
          <p className="inline-flex items-center rounded-full bg-paper-sunk px-2.5 py-1 text-[0.75rem] font-medium text-ink-muted">
            Not found
          </p>
          <h1 className="mt-3.5 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-[2rem]">
            There is no page at that address
          </h1>
          <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink-muted">
            The link may be from an older version, or a resume that has since
            been deleted.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <LinkButton
              size="lg"
              href="/resumes"
            >
              My resumes
            </LinkButton>
            <LinkButton
              variant="outline"
              size="lg"
              href="/start"
            >
              Start a new one
            </LinkButton>
          </div>
        </section>
      </main>
    </div>
  );
}
