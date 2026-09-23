/**
 * Loading a run, on a database that may not exist.
 *
 * The migrations in `supabase/` are written and not applied, so a read for a
 * resume comes back with 42P01, "relation does not exist". Even once they are
 * applied, `POST /api/resumes` inserts a row whose `current_version_id` is
 * null, so a resume that genuinely exists still has no document behind it for
 * the length of a tailoring run.
 *
 * Both of those are ordinary states rather than errors, and neither is a
 * reason to show a 404 to somebody who has just uploaded their resume. Every
 * path here lands somewhere renderable: whatever was real about the row is
 * kept, the rest comes from the sample, and `saved: false` travels with it so
 * the banner cannot be forgotten.
 *
 * Nothing in this module throws. A screen has to render something.
 */

import { computeAtsReport, type GapAnalysis, type JobSpec, type ResumeFacts, type TruthReport } from "@ats/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResumeDoc } from "@ats/templates";
import { getServerClient } from "@/lib/supabase/server";
import { tailoredOf } from "./doc";
import { sampleRun, type EditorRun } from "./fixtures";

export type LoadedRun = {
  run: EditorRun;
  /** The uploaded file behind `?document=`, when the row is readable. */
  sourceFile: string | null;
};

const NO_VIOLATIONS: TruthReport = {
  passed: true,
  error_count: 0,
  warning_count: 0,
  violations: [],
};

const NO_GAPS: GapAnalysis = {
  strong_matches: [],
  partial_matches: [],
  transferable: [],
  missing: [],
  missing_keywords: [],
  recoverable_keywords: [],
  emphasize: [],
  deemphasize: [],
  recruiter_concerns: [],
  ats_rejection_risks: [],
};

/**
 * Facts standing in for a parse that has not been stored.
 *
 * The scoring layer measures recoverable terms against the original resume, so
 * it needs one. When the `facts` ledger is unreadable, the document itself is
 * the only honest stand-in: it reports that nothing was dropped, which is true
 * of what is on record, rather than inventing a richer original.
 */
function factsFromDoc(doc: ResumeDoc): ResumeFacts {
  const expId = (i: number, given: string) => given || `E${i + 1}`;
  const projId = (i: number, given: string) => given || `P${i + 1}`;

  return {
    contact: doc.contact,
    headline: doc.headline,
    summary: doc.summary.text,
    experience: doc.experience.map((exp, i) => ({
      id: expId(i, exp.source_id),
      company: exp.company,
      title: exp.title,
      location: exp.location,
      start_date: exp.start_date,
      end_date: exp.end_date,
      bullets: exp.bullets.map((b, bi) => ({ id: `${expId(i, exp.source_id)}.B${bi + 1}`, text: b.text })),
      tech: [],
    })),
    projects: doc.projects.map((proj, i) => ({
      id: projId(i, proj.source_id),
      name: proj.name,
      description: "",
      url: proj.url,
      bullets: proj.bullets.map((b, bi) => ({ id: `${projId(i, proj.source_id)}.B${bi + 1}`, text: b.text })),
      tech: [],
    })),
    education: doc.education.map((edu, i) => ({
      id: edu.source_id || `ED${i + 1}`,
      institution: edu.institution,
      degree: edu.degree,
      dates: edu.dates,
      details: "",
    })),
    skills: doc.skills.map((group, i) => ({
      id: `S${i + 1}`,
      category: group.category,
      items: group.items,
    })),
    certifications: doc.certifications.map((cert, i) => ({
      id: cert.source_id || `C${i + 1}`,
      text: cert.text,
    })),
    other_sections: doc.other_sections.map((section, i) => ({
      id: section.source_id || `O${i + 1}`,
      heading: section.heading,
      bullets: section.bullets.map((b, bi) => ({ id: `O${i + 1}.B${bi + 1}`, text: b.text })),
    })),
    total_years_experience: 0,
  };
}

function looksLikeDoc(value: unknown): value is ResumeDoc {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<ResumeDoc>;
  return Array.isArray(doc.experience) && typeof doc.headline === "string";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

export async function loadRun(resumeId: string, documentId?: string): Promise<LoadedRun> {
  const fallback: LoadedRun = { run: sampleRun(resumeId), sourceFile: null };

  const typed = await getServerClient();
  if (!typed) return fallback;

  /*
    `src/lib/supabase/types.ts` declares only the two tables the list view
    reads, and it belongs to another agent. Rather than widen someone else's
    type from here, the four tables this screen needs are read through an
    untyped handle and validated at runtime, which is what a jsonb column
    would need anyway.
  */
  const db = typed as unknown as SupabaseClient;

  let sourceFile: string | null = null;
  if (documentId) {
    const { data } = await db
      .from("documents")
      .select("storage_path, kind")
      .eq("id", documentId)
      .maybeSingle();
    const row = record(data);
    const path = typeof row?.storage_path === "string" ? row.storage_path : null;
    if (path) sourceFile = path.split("/").pop() ?? null;
    else if (row) sourceFile = `pasted ${String(row.kind ?? "text")}`;
  }

  const { data: resumeData, error } = await db
    .from("resumes")
    .select("id, title, template_id, current_version_id, job_id")
    .eq("id", resumeId)
    .maybeSingle();

  const resume = record(resumeData);
  if (error || !resume) return { ...fallback, sourceFile };

  const sample = sampleRun(resumeId);
  const title = typeof resume.title === "string" && resume.title ? resume.title : sample.title;
  const templateId =
    typeof resume.template_id === "string" && resume.template_id && resume.template_id !== "default"
      ? resume.template_id
      : sample.templateId;

  // A real row with nothing behind it. Keep what is real, sample the rest.
  const shell: EditorRun = { ...sample, title, templateId };

  const versionId = typeof resume.current_version_id === "string" ? resume.current_version_id : null;
  if (!versionId) return { run: shell, sourceFile };

  const { data: versionData } = await db
    .from("resume_versions")
    .select("id, doc_json")
    .eq("id", versionId)
    .maybeSingle();

  const doc = record(versionData)?.doc_json;
  if (!looksLikeDoc(doc)) return { run: shell, sourceFile };

  let job: JobSpec = sample.job;
  const jobId = typeof resume.job_id === "string" ? resume.job_id : null;
  if (jobId) {
    const { data: jobData } = await db.from("jobs").select("spec_json").eq("id", jobId).maybeSingle();
    const spec = record(jobData)?.spec_json;
    if (spec && typeof spec === "object") job = spec as JobSpec;
  }

  let truth = NO_VIOLATIONS;
  let gaps = NO_GAPS;
  if (jobId) {
    const { data: analysisData } = await db
      .from("resume_jobs")
      .select("gaps_json, truth_json")
      .eq("resume_id", resumeId)
      .eq("job_id", jobId)
      .maybeSingle();
    const analysis = record(analysisData);
    const storedTruth = record(analysis?.truth_json);
    const storedGaps = record(analysis?.gaps_json);
    if (storedTruth && Array.isArray(storedTruth.violations)) truth = storedTruth as unknown as TruthReport;
    if (storedGaps) gaps = { ...NO_GAPS, ...(storedGaps as Partial<GapAnalysis>) };
  }

  const facts = factsFromDoc(doc);

  return {
    run: {
      resumeId,
      versionId,
      title,
      templateId,
      saved: true,
      doc,
      job,
      facts,
      report: computeAtsReport(job, facts, tailoredOf(doc)),
      truth,
      gaps,
    },
    sourceFile,
  };
}
