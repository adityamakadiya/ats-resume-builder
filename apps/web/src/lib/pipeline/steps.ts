/**
 * The pipeline steps, in the order they run.
 *
 * Port of backend/src/atsresume/pipeline/steps.py, with three deliberate
 * changes, each one a finding from reviewing the original:
 *
 * 1. **Strategy is off the critical path.** It is advice about a resume, not
 *    part of one, and it was costing roughly twenty seconds of a candidate
 *    staring at a progress bar before they could see anything. It is now a
 *    separate call the editor makes once it is already open.
 *
 * 2. **Every step is cached by content.** One resume against ten postings
 *    extracts once. See cache.ts for the privacy rule that decides which
 *    steps may share a cache entry across users and which may not.
 *
 * 3. **Verification is a service call, not an import.** The guard is hundreds
 *    of lines of rules over a technology vocabulary, and owning two copies of
 *    it in two languages would mean owning two sets of rules that disagree
 *    under pressure. It stays in Python; this calls it.
 */

import {
  GapAnalysisSchema,
  JobSpecSchema,
  ResumeFactsSchema,
  TailoredResumeSchema,
  computeAtsReport,
  sanitize,
  type AtsReport,
  type GapAnalysis,
  type JobSpec,
  type ResumeFacts,
  type TailoredResume,
  type TruthReport,
} from "@ats/core";

import { configFor } from "../llm/profiles";
import { structured, type Usage } from "../llm/structured";
import { cacheKey, withCache, type CacheScope } from "./cache";
import { PROMPTS, block } from "./prompts";
import { runGuard } from "./guard-client";

export type StepTrace = {
  step: string;
  model: string;
  ms: number;
  usage: Usage | null;
  cacheHit: boolean;
};

export type Traced<T> = { value: T; trace: StepTrace };

async function runStep<T>(opts: {
  step: Parameters<typeof configFor>[0];
  promptVersion: string;
  system: string;
  user: string;
  schema: Parameters<typeof structured>[0]["schema"];
  schemaName: string;
  scope: CacheScope;
  signal?: AbortSignal;
}): Promise<Traced<T>> {
  const config = configFor(opts.step);
  const started = Date.now();

  const key = cacheKey({
    step: opts.step,
    promptVersion: opts.promptVersion,
    model: config.model,
    // The system prompt is in the version, so only the variable half needs
    // hashing. Hashing both would invalidate on a whitespace edit that the
    // version deliberately did not bump for.
    payload: opts.user,
    scope: opts.scope,
  });

  const { value, hit } = await withCache(key, async () => {
    const result = await structured({
      system: opts.system,
      user: opts.user,
      schema: opts.schema,
      schemaName: opts.schemaName,
      step: opts.step,
      signal: opts.signal,
    });
    return { data: result.value, usage: result.usage };
  });

  const payload = value as { data: T; usage: Usage };

  return {
    value: payload.data,
    trace: {
      step: opts.step,
      model: config.model,
      ms: Date.now() - started,
      usage: hit ? null : payload.usage,
      cacheHit: hit,
    },
  };
}

/* --------------------------------------------------------------- extract  */

export function extractResumeFacts(
  rawResumeText: string,
  scope: CacheScope,
  signal?: AbortSignal,
): Promise<Traced<ResumeFacts>> {
  return runStep<ResumeFacts>({
    step: "extract",
    promptVersion: PROMPTS.extract.version,
    system: PROMPTS.extract.text,
    user: `Extract structured facts from this resume.\n\n${block("resume", rawResumeText)}`,
    schema: ResumeFactsSchema,
    schemaName: "ResumeFacts",
    // A resume is the most sensitive thing in the system. Never shared.
    scope,
    signal,
  });
}

/* -------------------------------------------------------------------- jd  */

export function extractJobSpec(
  jdText: string,
  sourceNote: string,
  signal?: AbortSignal,
): Promise<Traced<JobSpec>> {
  return runStep<JobSpec>({
    step: "analyze",
    promptVersion: PROMPTS.jd.version,
    system: PROMPTS.jd.text,
    user: `Decompose this job description.\n\nSource: ${sourceNote}\n\n${block("job_description", jdText)}`,
    schema: JobSpecSchema,
    schemaName: "JobSpec",
    // A public job posting carries nothing private, and two candidates
    // applying to the same role should pay for one decomposition between them.
    scope: { kind: "global" },
    signal,
  });
}

/* ------------------------------------------------------------------ gaps  */

export function analyzeGaps(
  job: JobSpec,
  facts: ResumeFacts,
  scope: CacheScope,
  signal?: AbortSignal,
): Promise<Traced<GapAnalysis>> {
  return runStep<GapAnalysis>({
    step: "gaps",
    promptVersion: PROMPTS.gaps.version,
    system: PROMPTS.gaps.text,
    user: [
      "Compare this candidate against this role.",
      block("job_spec", JSON.stringify(job, null, 2)),
      block("resume_facts", JSON.stringify(facts, null, 2)),
    ].join("\n\n"),
    schema: GapAnalysisSchema,
    schemaName: "GapAnalysis",
    scope,
    signal,
  });
}

/* ---------------------------------------------------------------- tailor  */

export type TailorOutcome = {
  tailored: TailoredResume;
  truth: TruthReport;
  report: AtsReport;
  repairAttempted: boolean;
  /** Why the first draft was rejected. The repair doubles the cost of the most
   *  expensive step, so which rule keeps tripping is the difference between
   *  tuning the prompt and guessing at it. */
  firstDraftViolations: string[];
  traces: StepTrace[];
};

function buildBrief(job: JobSpec, facts: ResumeFacts, gaps: GapAnalysis): string {
  return [
    "Rewrite this candidate's resume for this role.",
    block("job_spec", JSON.stringify(job, null, 2)),
    block("resume_facts", JSON.stringify(facts, null, 2)),
    block("gap_analysis", JSON.stringify(gaps, null, 2)),
    "The gap analysis lists missing_keywords the candidate cannot truthfully claim. " +
      "Do not use them.\n" +
      "Surface every recoverable_keyword - those are already true and merely buried.",
  ].join("\n\n");
}

/**
 * Rewrite, verify, and repair exactly once.
 *
 * One repair, not a loop. A loop that keeps pushing until the guard passes is
 * an optimiser applying pressure toward whatever wording slips past it, which
 * is precisely the opposite of what the guard is for. If a second draft still
 * fails, the candidate is shown which lines cannot be traced rather than
 * handed a resume that reads well and cannot be defended in an interview.
 */
export async function tailorResume(args: {
  job: JobSpec;
  facts: ResumeFacts;
  gaps: GapAnalysis;
  rawResumeText: string;
  scope: CacheScope;
  signal?: AbortSignal;
  onEvent?: (event: { type: "draft" | "verified" | "repairing" }) => void;
}): Promise<TailorOutcome> {
  const { job, facts, gaps, rawResumeText, scope, signal } = args;
  const jdTerms = [
    ...job.requirements.map((r) => r.term),
    ...job.keywords.flatMap((k) => [k.term, ...k.variants]),
  ];
  const traces: StepTrace[] = [];
  const brief = buildBrief(job, facts, gaps);

  const first = await runStep<TailoredResume>({
    step: "tailor",
    promptVersion: PROMPTS.tailor.version,
    system: PROMPTS.tailor.text,
    user: brief,
    schema: TailoredResumeSchema,
    schemaName: "TailoredResume",
    scope,
    signal,
  });
  traces.push(first.trace);
  args.onEvent?.({ type: "draft" });

  let tailored = sanitize(first.value);
  let truth = await runGuard({ tailored, facts, rawResumeText, jdTerms, entailment: true });
  args.onEvent?.({ type: "verified" });

  let repairAttempted = false;
  let firstDraftViolations: string[] = [];

  if (!truth.passed) {
    repairAttempted = true;
    args.onEvent?.({ type: "repairing" });

    const errors = truth.violations.filter((v) => v.severity === "error");
    firstDraftViolations = errors.map((v) => `${v.code}: ${v.detail}`);
    const findings = errors
      .map((v) => `- [${v.code}] ${v.location}: ${v.detail}\n  Line: "${v.offending}"`)
      .join("\n");

    console.warn(
      `[tailor] guard rejected the first draft (${truth.error_count} errors): ` +
        firstDraftViolations.slice(0, 5).join("; "),
    );

    const repair = await runStep<TailoredResume>({
      step: "tailor",
      promptVersion: PROMPTS.tailor.version,
      system: PROMPTS.tailor.text,
      user: [
        brief,
        `Your previous draft failed verification against the uploaded resume:\n${findings}`,
        "Rewrite it. For each failing line, either restate it using only what its " +
          "sources actually say, or drop it. Do not try to justify a figure or a " +
          "technology that is not in the original resume.",
      ].join("\n\n"),
      schema: TailoredResumeSchema,
      schemaName: "TailoredResume",
      scope,
      signal,
    });
    traces.push(repair.trace);

    tailored = sanitize(repair.value);
    truth = await runGuard({ tailored, facts, rawResumeText, jdTerms, entailment: true });
  }

  // Computed, not asked of a model: free, instant, and the same answer every
  // time, which is what lets the editor re-score on every keystroke.
  const report = computeAtsReport(job, facts, tailored);

  return { tailored, truth, report, repairAttempted, firstDraftViolations, traces };
}
