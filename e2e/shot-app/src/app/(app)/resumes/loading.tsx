/**
 * The waiting state for /resumes.
 *
 * It names the step. "Reading your library" tells you which of the two slow
 * things is happening, and the skeleton cards are the shape of the answer,
 * so the page does not jump when it arrives. A bare spinner would have told
 * you neither.
 */

export default function ResumesLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-[1.75rem]">
        My resumes
      </h1>

      <div className="mt-7" role="status" aria-live="polite">
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="sweeping h-1 w-10 rounded-full" />
          <span className="text-[0.875rem] text-ink-muted">
            Reading your library
          </span>
        </div>

        <ul className="mt-4 space-y-3">
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="flex items-start gap-4 rounded-xl border border-rule bg-paper-raised px-4 py-5 shadow-xs sm:px-5"
              style={{ opacity: 1 - row * 0.25 }}
            >
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="h-4 w-48 max-w-full rounded-md bg-paper-sunk" />
                <div className="h-3 w-64 max-w-full rounded-md bg-paper-sunk" />
                <div className="h-2.5 w-32 rounded-md bg-paper-sunk" />
              </div>
              <div className="h-7 w-14 shrink-0 rounded-md bg-paper-sunk" />
            </li>
          ))}
        </ul>
        <span className="sr-only">Loading your resumes.</span>
      </div>
    </div>
  );
}
