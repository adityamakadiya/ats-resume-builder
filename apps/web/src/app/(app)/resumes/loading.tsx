/**
 * The waiting state for /resumes.
 *
 * It names the step. "Reading your library" tells you which of the two slow
 * things is happening, and the skeleton rows are the shape of the answer, so
 * the page does not jump when it arrives. A bare spinner would have told you
 * neither.
 */

export default function ResumesLoading() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <p className="label">Library</p>
      <h1 className="mt-2 font-display text-4xl leading-none text-ink sm:text-5xl">
        My resumes
      </h1>

      <div className="mt-8" role="status" aria-live="polite">
        <div className="flex items-center gap-3 border-b border-rule pb-2">
          <span aria-hidden="true" className="sweeping h-0.5 w-10 rounded-full" />
          <span className="label">Reading your library</span>
        </div>

        <ul className="sheet rounded-xs border-t-0">
          {[0, 1, 2].map((row) => (
            <li
              key={row}
              className="flex items-start gap-4 border-b border-rule px-4 py-5 sm:px-5"
              style={{ opacity: 1 - row * 0.25 }}
            >
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="h-4 w-48 max-w-full rounded-xs bg-paper-sunk" />
                <div className="h-3 w-64 max-w-full rounded-xs bg-paper-sunk" />
                <div className="h-2.5 w-32 rounded-xs bg-paper-sunk" />
              </div>
              <div className="h-7 w-14 shrink-0 rounded-xs bg-paper-sunk" />
            </li>
          ))}
        </ul>
        <span className="sr-only">Loading your resumes.</span>
      </div>
    </div>
  );
}
