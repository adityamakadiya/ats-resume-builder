/**
 * Reading the resume list.
 *
 * A read, so it goes straight to Postgres under RLS. There is no `where
 * user_id = ...` below and there should not be: the policy in
 * 0002_rls.sql is the filter, and adding a second one in application code
 * would create a place for the two to disagree.
 *
 * The score is joined from `resume_jobs.report_json`, which holds the
 * backend's AtsReport. `overall` is computed by formula in
 * backend/src/atsresume/scoring.py, not asked of a model, so it is a number
 * the UI can show without hedging.
 *
 * Nothing here throws. Every caller is a screen, and a screen has to render
 * something; a thrown error produces a boundary, and a boundary cannot tell
 * the user whether the problem was their session, the network or the schema.
 */

import { getServerClient } from "./server";
import type { ResumeListItem } from "./types";

export type ResumesResult =
  | { state: "unconfigured" }
  | { state: "signed-out" }
  | { state: "failed"; reason: string; remedy: string }
  | { state: "ok"; resumes: ResumeListItem[] };

/** The shape PostgREST returns for the select below. */
type Joined = {
  id: string;
  title: string;
  template_id: string;
  status: string;
  job_id: string | null;
  created_at: string;
  updated_at: string;
  jobs: { title: string | null; company: string | null } | null;
  resume_jobs: { report_json: { overall?: unknown } | null }[] | null;
};

function bestScore(rows: Joined["resume_jobs"]): number | null {
  if (!rows || rows.length === 0) return null;
  let best: number | null = null;
  for (const row of rows) {
    const value = row.report_json?.overall;
    if (typeof value === "number" && Number.isFinite(value)) {
      best = best === null ? value : Math.max(best, value);
    }
  }
  return best;
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

export async function listResumes(): Promise<ResumesResult> {
  const supabase = await getServerClient();
  if (!supabase) return { state: "unconfigured" };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { state: "signed-out" };

  const { data, error } = await supabase
    .from("resumes")
    .select(
      "id, title, template_id, status, job_id, created_at, updated_at, jobs(title, company), resume_jobs(report_json)"
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    /*
      42P01 is "relation does not exist", which on a fresh project means the
      migrations were never applied. That is a different problem from a
      network blip and deserves a different instruction.
    */
    if (error.code === "42P01") {
      return {
        state: "failed",
        reason: "The database is reachable but the tables are not there yet.",
        remedy:
          "Apply the migrations from the repository root: `supabase db push` " +
          "for a hosted project, or `supabase db reset` against a local one.",
      };
    }
    return {
      state: "failed",
      reason: "Your resumes could not be loaded.",
      remedy: `${error.message}. Reload the page, and if it persists check that the project is running.`,
    };
  }

  /*
    The generated row type cannot express the embedded `jobs` and
    `resume_jobs` selects, because `Database` here declares columns and not
    relationships. The cast is to the shape PostgREST actually returns for
    this exact select string, declared above and kept next to it.
  */
  const rows = (data ?? []) as unknown as Joined[];

  const resumes: ResumeListItem[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    template_id: row.template_id,
    status: row.status,
    job_id: row.job_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    targetRole: nonEmpty(row.jobs?.title),
    company: nonEmpty(row.jobs?.company),
    score: bestScore(row.resume_jobs),
  }));

  return { state: "ok", resumes };
}
