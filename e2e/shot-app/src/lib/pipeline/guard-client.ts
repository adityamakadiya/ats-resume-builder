/**
 * The truth guard, over HTTP.
 *
 * The guard stayed in Python deliberately. It is several hundred lines of
 * rules over a technology vocabulary, an alias map, a metric grammar and a
 * set of morphology exceptions, every one of which was added because a real
 * draft was wrongly rejected or wrongly accepted. Two implementations of that
 * in two languages would be two sets of rules that disagree under pressure,
 * and the pressure arrives exactly when a candidate is about to send a resume.
 *
 * The scorer is ported and the guard is not, and the difference is call
 * frequency. The scorer runs on every keystroke, where 60ms of network is the
 * whole latency budget. The guard runs once per generation, after a candidate
 * has already waited forty seconds for a model, where 60ms is noise.
 *
 * FAILURE POLICY, and it is the important part of this file: a guard that
 * cannot be reached does not silently pass. Verification is the product. If
 * this call fails, the caller is told the document is UNVERIFIED and the UI
 * says so, rather than showing a green tick it did not earn.
 */

import { TruthReportSchema, type ResumeFacts, type TailoredResume, type TruthReport } from "@ats/core";

export class GuardUnavailableError extends Error {
  constructor(cause: string) {
    super(
      `The verification service could not be reached (${cause}). This document has not been checked.`,
    );
    this.name = "GuardUnavailableError";
  }
}

export type GuardRequest = {
  tailored: TailoredResume;
  facts: ResumeFacts;
  rawResumeText?: string;
  jdTerms?: string[];
  /** Costs a model call. Worth it on a finished draft, not on a single line. */
  entailment?: boolean;
  signal?: AbortSignal;
};

function baseUrl(): string {
  return process.env.DOCSVC_URL ?? "http://localhost:8000";
}

export async function runGuard(request: GuardRequest): Promise<TruthReport> {
  const { signal, ...body } = request;

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/api/guard`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The document service is internal. It never sees a user's token and
        // is never routed from the public internet.
        ...(process.env.DOCSVC_TOKEN ? { Authorization: `Bearer ${process.env.DOCSVC_TOKEN}` } : {}),
      },
      body: JSON.stringify({
        tailored: body.tailored,
        facts: body.facts,
        raw_resume_text: body.rawResumeText ?? "",
        jd_terms: body.jdTerms ?? [],
        entailment: body.entailment ?? false,
      }),
      signal,
    });
  } catch (error) {
    throw new GuardUnavailableError(error instanceof Error ? error.message : "network error");
  }

  if (!response.ok) {
    throw new GuardUnavailableError(`HTTP ${response.status}`);
  }

  const parsed = TruthReportSchema.safeParse(await response.json());
  if (!parsed.success) {
    // A malformed report is indistinguishable from no report. Treating it as
    // a pass would be the single worst bug this system could have.
    throw new GuardUnavailableError("the report did not match the expected shape");
  }

  return parsed.data;
}
