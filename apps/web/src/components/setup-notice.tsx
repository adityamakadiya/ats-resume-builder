/**
 * What you see before the database exists.
 *
 * This is the first screen most people will hit, because the repository ships
 * without an .env.local. Treating that as an error state would be a lie: it
 * is the expected state of a fresh clone. So it reads as a checklist, names
 * the exact variables, says which file they go in and where to copy them
 * from, and stays inside the same paper design as everything else rather than
 * dropping to an unstyled Next.js error overlay.
 */

import { SUPABASE_ENV_KEYS } from "@/lib/supabase/config";

export type SetupNoticeProps = {
  /** Which keys were missing. Defaults to all of them. */
  missing?: readonly string[];
  /** What the user was trying to do, so the copy can name it. */
  context?: string;
};

export function SetupNotice({
  missing = SUPABASE_ENV_KEYS,
  context = "This screen",
}: SetupNoticeProps) {
  return (
    <section
      aria-labelledby="setup-notice-heading"
      className="sheet mx-auto w-full max-w-xl rounded-xs p-6 sm:p-8"
    >
      <p className="label">Setup required</p>
      <h2
        id="setup-notice-heading"
        className="mt-3 font-display text-3xl leading-tight text-ink sm:text-4xl"
      >
        Supabase is not configured
      </h2>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">
        {context} reads and writes through Supabase, and the two variables it
        needs are not set. Nothing is broken. Add them and reload.
      </p>

      <ol className="mt-6 space-y-5 text-sm">
        <li>
          <p className="text-ink">
            <span className="font-mono text-xs text-ink-faint">1.</span> Create a
            file named{" "}
            <code className="rounded-xs bg-paper-sunk px-1.5 py-0.5 font-mono text-[0.8125rem]">
              .env.local
            </code>{" "}
            in{" "}
            <code className="rounded-xs bg-paper-sunk px-1.5 py-0.5 font-mono text-[0.8125rem]">
              apps/web
            </code>
            . There is an{" "}
            <code className="rounded-xs bg-paper-sunk px-1.5 py-0.5 font-mono text-[0.8125rem]">
              .env.example
            </code>{" "}
            beside it to copy.
          </p>
        </li>
        <li>
          <p className="text-ink">
            <span className="font-mono text-xs text-ink-faint">2.</span> Set
            these {missing.length === 1 ? "value" : "values"}:
          </p>
          <ul className="mt-2 space-y-1.5">
            {missing.map((key) => (
              <li
                key={key}
                className="flex items-start gap-2 rounded-xs border border-rule bg-paper-sunk px-3 py-2 font-mono text-[0.75rem] break-all text-ink"
              >
                <span aria-hidden="true" className="text-stamp">
                  &times;
                </span>
                <span>
                  <span className="sr-only">Missing: </span>
                  {key}
                </span>
              </li>
            ))}
          </ul>
        </li>
        <li>
          <p className="text-ink">
            <span className="font-mono text-xs text-ink-faint">3.</span> Find
            both under Project Settings, API in your Supabase dashboard. Running
            locally,{" "}
            <code className="rounded-xs bg-paper-sunk px-1.5 py-0.5 font-mono text-[0.8125rem]">
              supabase start
            </code>{" "}
            prints them.
          </p>
        </li>
        <li>
          <p className="text-ink">
            <span className="font-mono text-xs text-ink-faint">4.</span> Apply
            the schema with{" "}
            <code className="rounded-xs bg-paper-sunk px-1.5 py-0.5 font-mono text-[0.8125rem]">
              supabase db reset
            </code>
            , then restart the dev server. Next inlines public variables at
            build time, so a reload alone will not pick them up.
          </p>
        </li>
      </ol>

      <p className="mt-6 border-t border-rule pt-4 text-[0.8125rem] leading-relaxed text-ink-faint">
        The anon key is meant to be public. Row-level security in
        <span className="font-mono"> supabase/migrations/0002_rls.sql</span> is
        what keeps one account out of another&rsquo;s rows, not the secrecy of
        that key.
      </p>
    </section>
  );
}
