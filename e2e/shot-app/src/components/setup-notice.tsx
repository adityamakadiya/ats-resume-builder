/**
 * What you see before the database exists.
 *
 * This is the first screen most people will hit, because the repository ships
 * without an .env.local. Treating that as an error state would be a lie: it
 * is the expected state of a fresh clone. So it reads as a checklist, names
 * the exact variables, says which file they go in and where to copy them
 * from, and stays inside the same light product surface as everything else
 * rather than dropping to an unstyled Next.js error overlay.
 */

import { SUPABASE_ENV_KEYS } from "@/lib/supabase/config";

export type SetupNoticeProps = {
  /** Which keys were missing. Defaults to all of them. */
  missing?: readonly string[];
  /** What the user was trying to do, so the copy can name it. */
  context?: string;
};

const CODE =
  "rounded-md bg-paper-sunk px-1.5 py-0.5 font-mono text-[0.8125rem] text-ink";

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-stamp-soft text-[0.75rem] font-semibold text-[var(--stamp-strong)]"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}

export function SetupNotice({
  missing = SUPABASE_ENV_KEYS,
  context = "This screen",
}: SetupNoticeProps) {
  return (
    <section
      aria-labelledby="setup-notice-heading"
      className="mx-auto w-full max-w-xl rounded-xl border border-rule bg-paper-raised p-6 shadow-xs sm:p-8"
    >
      <p className="inline-flex items-center rounded-full bg-[var(--caution-soft)] px-2.5 py-1 text-[0.75rem] font-medium text-[var(--caution)]">
        Setup required
      </p>
      <h2
        id="setup-notice-heading"
        className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-[1.75rem]"
      >
        Supabase is not configured
      </h2>
      <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink-muted">
        {context} reads and writes through Supabase, and the two variables it
        needs are not set. Nothing is broken. Add them and reload.
      </p>

      <ol className="mt-7 space-y-5 text-sm">
        <Step n={1}>
          <p className="leading-relaxed text-ink">
            Create a file named <code className={CODE}>.env.local</code> in{" "}
            <code className={CODE}>apps/web</code>. There is an{" "}
            <code className={CODE}>.env.example</code> beside it to copy.
          </p>
        </Step>
        <Step n={2}>
          <p className="leading-relaxed text-ink">
            Set these {missing.length === 1 ? "value" : "values"}:
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {missing.map((key) => (
              <li
                key={key}
                className="flex items-center gap-2.5 rounded-lg border border-rule bg-paper-sunk px-3 py-2 font-mono text-[0.75rem] break-all text-ink"
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 shrink-0 rounded-full bg-[var(--refused)]"
                />
                <span className="sr-only">Missing: </span>
                {key}
              </li>
            ))}
          </ul>
        </Step>
        <Step n={3}>
          <p className="leading-relaxed text-ink">
            Find both under Project Settings, API in your Supabase dashboard.
            Running locally, <code className={CODE}>supabase start</code> prints
            them.
          </p>
        </Step>
        <Step n={4}>
          <p className="leading-relaxed text-ink">
            Apply the schema. <code className={CODE}>supabase db push</code> for
            a hosted project, or <code className={CODE}>supabase db reset</code>{" "}
            against a local one. Reset drops the database, so the two are not
            interchangeable. Then restart the dev server: Next inlines public
            variables at build time, so a reload alone will not pick them up.
          </p>
        </Step>
      </ol>

      <p className="mt-7 border-t border-rule pt-5 text-[0.8125rem] leading-relaxed text-ink-muted">
        The anon key is meant to be public. Row-level security in
        <span className="font-mono"> supabase/migrations/0002_rls.sql</span> is
        what keeps one account out of another&apos;s rows, not the secrecy of
        that key.
      </p>
    </section>
  );
}
