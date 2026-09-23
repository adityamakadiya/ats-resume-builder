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
  /**
   * What the document service read out of the file.
   *
   * Null until it has been parsed, and null forever if parsing failed. This
   * is the column the truth guard checks every rewritten line against, so a
   * document with no raw_text cannot be verified against anything and the
   * editor has to say so rather than report a pass.
   */
  raw_text: string | null;
  page_count: number | null;
  /** The measured StyleProfile: page box, columns, type ladder, accent. */
  style_json: unknown | null;
  /** Reader notes worth showing, such as "this resume is in two columns". */
  notes: string[] | null;
  /**
   * The structured extraction as the model returned it, added in 0008.
   * Rebuilds the candidate's own document for the editor. Not read by
   * the truth guard, which uses raw_text and the facts ledger.
   */
  facts_json: unknown | null;
  sha256: string | null;
  created_at: string;
};

/**
 * One row of the provenance ledger.
 *
 * `origin` is the field the whole design rests on. 'document' means the
 * uploaded file says this, so a rewrite may cite it. 'attested' means the
 * candidate told us in conversation, which is equally usable and separately
 * auditable. Nothing may be cited that is neither.
 */
export type FactRow = {
  id: string;
  user_id: string;
  document_id: string | null;
  /** The citable id, 'E1.B2' shaped, referenced by every tailored line. */
  fact_key: string;
  text: string;
  origin: "document" | "attested" | "derived";
  entities_json: unknown | null;
  evidence_json: unknown | null;
  supersedes: string | null;
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
      facts: {
        Row: FactRow;
        Insert: Partial<FactRow> & {
          user_id: string;
          fact_key: string;
          text: string;
          origin: FactRow["origin"];
        };
        Update: Partial<FactRow>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
