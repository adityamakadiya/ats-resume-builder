"use client";

/**
 * The last resort.
 *
 * Reached only when a screen threw something it did not expect, which in
 * this app should be rare, because the data layer returns states rather than
 * throwing. So it says what class of thing happened, offers the one action
 * that ever helps (try again), and shows the digest, which is the only
 * string that lets someone find the matching server log.
 */

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main
      id="main"
      className="flex min-h-full flex-1 items-center justify-center px-5 py-16"
    >
      <section
        role="alert"
        className="w-full max-w-lg rounded-xl border border-rule bg-paper-raised p-6 shadow-xs sm:p-8"
      >
        <p className="inline-flex items-center rounded-full bg-[var(--refused-soft)] px-2.5 py-1 text-[0.75rem] font-medium text-[var(--refused)]">
          Unexpected error
        </p>
        <h1 className="mt-3.5 text-2xl font-semibold tracking-[-0.02em] text-ink">
          This screen stopped before it finished loading
        </h1>
        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink-muted">
          Nothing was saved and nothing was lost. Your resumes are on the
          server exactly as they were.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button
            type="button"
            size="lg"
            onClick={reset}
          >
            Try loading it again
          </Button>
          <LinkButton
            variant="outline"
            size="lg"
            href="/resumes"
          >
            Back to my resumes
          </LinkButton>
        </div>

        {error.digest ? (
          <p className="mt-7 border-t border-rule pt-4 font-mono text-[0.75rem] break-all text-ink-muted">
            Reference {error.digest}
          </p>
        ) : null}
      </section>
    </main>
  );
}
