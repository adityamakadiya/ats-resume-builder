/**
 * 404.
 *
 * Says which two places actually exist rather than offering a search box
 * over a product with six screens.
 */

import Link from "next/link";
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
        <section className="w-full max-w-lg">
          <p className="label">Not found</p>
          <h1 className="mt-3 font-display text-4xl leading-tight text-ink sm:text-5xl">
            There is no page at that address
          </h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">
            The link may be from an older version, or a resume that has since
            been deleted.
          </p>
          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <LinkButton
              size="lg"
              className="rounded-xs bg-stamp px-5 py-5 text-paper-raised hover:bg-stamp/90"
              href="/resumes"
            >
              My resumes
            </LinkButton>
            <LinkButton
              variant="outline"
              size="lg"
              className="rounded-xs border-rule-strong bg-paper-raised px-5 py-5 text-ink hover:bg-paper-sunk"
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
