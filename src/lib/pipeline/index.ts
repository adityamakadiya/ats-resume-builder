import { structured } from "@/lib/claude";
import { runTruthGuard } from "@/lib/truth/guard";
import {
  AtsReportWithStrategySchema,
  GapAnalysisSchema,
  JobSpecSchema,
  ResumeFactsSchema,
  TailoredResumeSchema,
  type GapAnalysis,
  type JobSpec,
  type ResumeFacts,
  type TailoredResume,
  type TruthReport,
} from "@/lib/schemas";
import {
  GAP_ANALYSIS_SYSTEM,
  JD_EXTRACTION_SYSTEM,
  RESUME_EXTRACTION_SYSTEM,
  SCORING_SYSTEM,
  TAILOR_SYSTEM,
} from "./prompts";

export async function extractResumeFacts(rawResumeText: string): Promise<ResumeFacts> {
  return structured({
    system: RESUME_EXTRACTION_SYSTEM,
    user: `Extract structured facts from this resume.\n\n<resume>\n${rawResumeText}\n</resume>`,
    schema: ResumeFactsSchema,
    effort: "medium",
  });
}

export async function extractJobSpec(jdText: string, sourceNote: string): Promise<JobSpec> {
  return structured({
    system: JD_EXTRACTION_SYSTEM,
    user: `Decompose this job description.\n\nSource: ${sourceNote}\n\n<job_description>\n${jdText}\n</job_description>`,
    schema: JobSpecSchema,
    effort: "high",
  });
}

export async function analyzeGaps(job: JobSpec, facts: ResumeFacts): Promise<GapAnalysis> {
  return structured({
    system: GAP_ANALYSIS_SYSTEM,
    user: [
      "Compare this candidate against this role.",
      "",
      "<job_spec>",
      JSON.stringify(job, null, 2),
      "</job_spec>",
      "",
      "<resume_facts>",
      JSON.stringify(facts, null, 2),
      "</resume_facts>",
    ].join("\n"),
    schema: GapAnalysisSchema,
    effort: "high",
  });
}

export type TailorOutcome = {
  tailored: TailoredResume;
  truth: TruthReport;
  repairAttempted: boolean;
};

/**
 * Rewrites the resume, then verifies it. If the guard finds fabrication, the
 * violations go back to the model once as a repair instruction. A second
 * failure is surfaced rather than hidden — the candidate is told exactly which
 * lines are unverifiable instead of being handed a resume that reads well and
 * cannot be defended in an interview.
 */
export async function tailorResume(
  job: JobSpec,
  facts: ResumeFacts,
  gaps: GapAnalysis,
  rawResumeText: string,
): Promise<TailorOutcome> {
  const brief = [
    "Rewrite this candidate's resume for this role.",
    "",
    "<job_spec>",
    JSON.stringify(job, null, 2),
    "</job_spec>",
    "",
    "<resume_facts>",
    JSON.stringify(facts, null, 2),
    "</resume_facts>",
    "",
    "<gap_analysis>",
    JSON.stringify(gaps, null, 2),
    "</gap_analysis>",
    "",
    "The gap analysis lists missingKeywords the candidate cannot truthfully claim. Do not use them.",
    "Surface every recoverableKeyword — those are already true and merely buried.",
  ].join("\n");

  let tailored = await structured({
    system: TAILOR_SYSTEM,
    user: brief,
    schema: TailoredResumeSchema,
    effort: "xhigh",
  });

  let truth = runTruthGuard(tailored, facts, rawResumeText);
  let repairAttempted = false;

  if (!truth.passed) {
    repairAttempted = true;
    const findings = truth.violations
      .filter((v) => v.severity === "error")
      .map((v) => `- [${v.code}] ${v.location}: ${v.detail}\n  Line: "${v.offending}"`)
      .join("\n");

    tailored = await structured({
      system: TAILOR_SYSTEM,
      user: [
        brief,
        "",
        "Your previous draft failed verification against the uploaded resume:",
        findings,
        "",
        "Rewrite it. For each failing line, either restate it using only what its sources actually say,",
        "or drop it. Do not attempt to justify a figure or a technology that is not in the original resume.",
      ].join("\n"),
      schema: TailoredResumeSchema,
      effort: "xhigh",
    });
    truth = runTruthGuard(tailored, facts, rawResumeText);
  }

  return { tailored, truth, repairAttempted };
}

export async function scoreAndStrategize(
  job: JobSpec,
  gaps: GapAnalysis,
  tailored: TailoredResume,
) {
  return structured({
    system: SCORING_SYSTEM,
    user: [
      "Evaluate this tailored resume against the role.",
      "",
      "<job_spec>",
      JSON.stringify(job, null, 2),
      "</job_spec>",
      "",
      "<gap_analysis>",
      JSON.stringify(gaps, null, 2),
      "</gap_analysis>",
      "",
      "<tailored_resume>",
      JSON.stringify(tailored, null, 2),
      "</tailored_resume>",
    ].join("\n"),
    schema: AtsReportWithStrategySchema,
    effort: "high",
  });
}
