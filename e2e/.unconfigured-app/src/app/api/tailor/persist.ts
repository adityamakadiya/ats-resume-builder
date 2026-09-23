/**
 * Writing the run down, if the database will have it.
 *
 * SUPABASE HAS NO SCHEMA APPLIED ON THIS DEPLOYMENT. Every statement below
 * can fail with "relation does not exist", and none of those failures may
 * cost the user the forty seconds of model time they just paid for. So this
 * module cannot throw: it reports what it managed, the route streams the
 * result either way, and `persisted:false` is what tells the editor to keep
 * the document in memory and offer a download rather than promising a save.
 *
 * The ids it returns when the write fails are real UUIDs, generated here.
 * The alternative - empty strings - would have every client special-casing
 * them, and the editor needs a stable key for the version it is showing
 * whether or not Postgres agrees that the version exists.
 *
 * The typed client in `lib/supabase/types.ts` declares only the two tables
 * another part of the app reads. Rather than widen a type someone else owns,
 * the writes below go through a deliberately untyped view of the same
 * client. That is a real loss of checking and it is confined to this file.
 */

import type { AtsReport, GapAnalysis, JobSpec, TailoredResume, TruthReport } from "@ats/core";
import type { ServerClient } from "@/lib/supabase/server";

export type PersistInput = {
  supabase: ServerClient;
  userId: string;
  resumeId?: string;
  templateId?: string;
  jdText: string;
  jdUrl?: string;
  sourceNote: string;
  job: JobSpec;
  gaps: GapAnalysis;
  tailored: TailoredResume;
  truth: TruthReport;
  report: AtsReport;
};

export type PersistResult = {
  persisted: boolean;
  resumeId: string;
  versionId: string;
  /** Logged, not shown. The user cannot fix a missing migration. */
  reason?: string;
};

/** A shape with no table knowledge, so an unmigrated schema is a runtime miss. */
type LooseClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => {
      select: (columns: string) => {
        single: () => Promise<{ data: { id?: string } | null; error: { message: string } | null }>;
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ error: { message: string } | null }>;
    };
    upsert: (
      row: Record<string, unknown>,
      options?: { onConflict?: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

export async function persistRun(input: PersistInput): Promise<PersistResult> {
  const fallback: PersistResult = {
    persisted: false,
    resumeId: input.resumeId ?? crypto.randomUUID(),
    versionId: crypto.randomUUID(),
  };

  const db = input.supabase as unknown as LooseClient;

  try {
    const jobTitle = input.job.title || "Untitled role";
    const company = input.job.company || "";

    const jobRow = await db
      .from("jobs")
      .insert({
        user_id: input.userId,
        source_url: input.jdUrl ?? null,
        jd_text: input.jdText,
        jd_source: input.sourceNote,
        company,
        title: jobTitle,
        spec_json: input.job,
      })
      .select("id")
      .single();

    if (jobRow.error || !jobRow.data?.id) {
      return { ...fallback, reason: jobRow.error?.message ?? "jobs insert returned no id" };
    }
    const jobId = jobRow.data.id;

    let resumeId = input.resumeId;
    if (!resumeId) {
      const resumeRow = await db
        .from("resumes")
        .insert({
          user_id: input.userId,
          title: company ? `${jobTitle} - ${company}` : jobTitle,
          template_id: input.templateId ?? "default",
          job_id: jobId,
          status: "draft",
        })
        .select("id")
        .single();

      if (resumeRow.error || !resumeRow.data?.id) {
        return { ...fallback, reason: resumeRow.error?.message ?? "resumes insert returned no id" };
      }
      resumeId = resumeRow.data.id;
    }

    const versionRow = await db
      .from("resume_versions")
      .insert({
        user_id: input.userId,
        resume_id: resumeId,
        doc_json: input.tailored,
        created_by: "ai_tailor",
      })
      .select("id")
      .single();

    if (versionRow.error || !versionRow.data?.id) {
      // The document exists and the resume row exists; only the snapshot
      // failed. Still a failed save from the user's point of view.
      return {
        persisted: false,
        resumeId,
        versionId: fallback.versionId,
        reason: versionRow.error?.message ?? "resume_versions insert returned no id",
      };
    }
    const versionId = versionRow.data.id;

    // From here on the run is recoverable even if a statement fails: the
    // document is stored and addressable. These two are bookkeeping.
    const pointer = await db
      .from("resumes")
      .update({ current_version_id: versionId, job_id: jobId })
      .eq("id", resumeId);

    const analysis = await db.from("resume_jobs").upsert(
      {
        user_id: input.userId,
        resume_id: resumeId,
        job_id: jobId,
        gaps_json: input.gaps,
        report_json: input.report,
        truth_json: input.truth,
      },
      { onConflict: "resume_id,job_id" },
    );

    const reason = pointer.error?.message ?? analysis.error?.message;
    if (reason) console.warn("[tailor] run stored, bookkeeping failed:", reason);

    return { persisted: true, resumeId, versionId, reason };
  } catch (error) {
    return {
      ...fallback,
      reason: error instanceof Error ? error.message : "unknown persistence failure",
    };
  }
}
