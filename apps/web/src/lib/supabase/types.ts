/**
 * The slice of the schema this app reads, hand-written against
 * supabase/migrations/0001_core_tables.sql.
 *
 * Hand-written rather than generated because generation needs a live project,
 * and the app has to typecheck on a machine that has never seen one. Only the
 * columns the list view actually selects are declared; widening this type is
 * a deliberate act, which is the point.
 */

/** `resumes.status` is free text in Postgres so a new state needs no migration. */
export const RESUME_STATUSES = [
  "draft",
  "applied",
  "screening",
  "interviewing",
  "offer",
  "rejected",
  "abandoned",
] as const;

export type ResumeStatus = (typeof RESUME_STATUSES)[number];

export type ResumeRow = {
  id: string;
  title: string;
  template_id: string;
  /** Free text in the database. Anything unrecognised is shown verbatim. */
  status: string;
  job_id: string | null;
  updated_at: string;
  created_at: string;
};

/**
 * One row of the list, after the score has been joined on from
 * `resume_jobs.report_json` and the target role from `jobs`.
 */
export type ResumeListItem = ResumeRow & {
  targetRole: string | null;
  company: string | null;
  /** The computed ATS score, 0 to 100, or null when nothing has been scored. */
  score: number | null;
};

export type Database = {
  public: {
    Tables: {
      resumes: {
        Row: ResumeRow;
        Insert: Partial<ResumeRow> & { user_id: string };
        Update: Partial<ResumeRow>;
      };
    };
  };
};
