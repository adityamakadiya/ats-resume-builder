/**
 * Postgres error codes, translated into something a person can act on.
 *
 * Three of these come up constantly while the schema is catching up with the
 * application, and every one of them surfaces as a sentence that describes
 * the database's internal state rather than the reader's next move:
 *
 *   42501  "new row violates row-level security policy for table jobs"
 *   42P01  "relation public.resumes does not exist"
 *   42703  "column documents.facts_json does not exist"
 *
 * Each is a migration that has not been run, and each one appeared in this
 * project as a bug report rather than as an instruction, because nothing
 * turned the code into the command that fixes it. The RLS one is the worst:
 * after authentication was removed there is no session to satisfy a policy,
 * so every single write fails with a message about security that has nothing
 * to teach anyone. It reads like a permissions bug and it is a missing
 * migration.
 *
 * Kept in one file so the mapping cannot drift between the six routes that
 * write, and so adding a code means adding it once.
 */

export type Actionable = { reason: string; remedy: string; status: number };

type PgLike = { code?: string | null; message?: string | null } | null | undefined;

/** Where to send someone whose database is behind the code. */
const APPLY =
  "Apply the migrations: paste supabase/APPLY_ALL.sql into the SQL editor, " +
  "or run `supabase db push` if the CLI can reach this project.";

export function describeDbError(error: PgLike, doing: string): Actionable {
  const code = error?.code ?? "";
  const message = error?.message ?? "an unknown database error";

  switch (code) {
    /*
      Row-level security refused the write. With authentication removed this
      is never a permissions problem and always migration 0009, which turns
      the policies off. Saying "violates row-level security policy" to
      somebody who has no way to be authenticated is telling them the cause
      and withholding the cure.
    */
    case "42501":
      return {
        reason: `${doing} was refused by row-level security.`,
        remedy:
          "This app has no sign in, so there is no session for a policy to " +
          `check and every write fails until the policies are gone. ${APPLY} ` +
          "Migration 0009 is the one that does it.",
        status: 503,
      };

    // The table is not there at all: nothing has been applied.
    case "42P01":
      return {
        reason: `${doing} failed because the table does not exist yet.`,
        remedy: `The schema has never been applied to this project. ${APPLY}`,
        status: 503,
      };

    // A column the code writes is missing: the schema is part-way applied.
    case "42703":
      return {
        reason: `${doing} failed because a column the app writes is missing.`,
        remedy: `The schema is behind the code. ${APPLY}`,
        status: 503,
      };

    /*
      A foreign key did not resolve. Retrying cannot help, so the remedy has
      to be something other than "try again": most often the thing being
      pointed at was deleted, or belongs to an older install.
    */
    case "23503":
      return {
        reason: `${doing} referred to something that is no longer there.`,
        remedy:
          "It may have been deleted. Start again from the upload; repeating " +
          "this step will fail the same way.",
        status: 422,
      };

    // Unique violation: the same thing twice.
    case "23505":
      return {
        reason: `${doing} already exists.`,
        remedy: "Reload the page; it is probably already saved.",
        status: 409,
      };

    default:
      return {
        reason: `${doing} could not be completed.`,
        remedy: `${message}. Nothing was saved, so it is safe to try again.`,
        status: 502,
      };
  }
}

/** True when the cause is a migration that has not been run. */
export function isSchemaBehind(error: PgLike): boolean {
  return ["42501", "42P01", "42703"].includes(error?.code ?? "");
}
