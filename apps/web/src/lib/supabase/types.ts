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
  /**
   * The upload this resume was created from, added in migration 0007.
   *
   * Null for a resume started from scratch, and null again if the source
   * document is later deleted. The truth guard reads `documents.raw_text`
   * through this, so null means there is nothing to check a rewrite against
   * and the editor has to say so rather than report a pass.
   */
  source_document_id: string | null;
  /**
   * The version currently shown in the editor. Null until the first version
   * is written, which is the state every resume is in the moment it is
   * created: /api/resumes inserts the row before any document exists.
   */
  current_version_id: string | null;
  /** Shape of `resume_versions.doc_json`. Bumped on a breaking change. */
  schema_version: number;
  /** Set when this resume was tailored from a master. Null otherwise. */
  base_resume_id: string | null;
  updated_at: string;
  created_at: string;
};

/**
 * One row of the list.
 *
 * Deliberately a Pick of ResumeRow rather than an extension of it. The list
 * query selects a handful of columns, and typing the result as the whole row
 * meant that every column added to the table broke this file, in a place with
 * nothing to do with the change. Widening the table should not require
 * touching a list that does not display the new column.
 */
export type ResumeListItem = Pick<
  ResumeRow,
  | "id"
  | "title"
  | "template_id"
  | "status"
  | "job_id"
  | "source_document_id"
  | "created_at"
  | "updated_at"
> & {
  targetRole: string | null;
  company: string | null;
  /** The computed ATS score, 0 to 100, or null when nothing has been scored. */
  score: number | null;
};

export type DocumentRow = {
  id: string;
  user_id: string;
  storage_path: string | null;
  kind: "pdf" | "docx" | "text";
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      resumes: {
        Row: ResumeRow;
        Insert: Partial<ResumeRow> & { user_id: string };
        Update: Partial<ResumeRow>;
        Relationships: [];
      };
      documents: {
        Row: DocumentRow;
        Insert: Partial<DocumentRow> & { user_id: string; kind: DocumentRow["kind"] };
        Update: Partial<DocumentRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
