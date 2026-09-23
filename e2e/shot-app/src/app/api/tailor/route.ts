/**
 * POST /api/tailor
 *
 * The long one. A resume and a posting in, a verified tailored resume out,
 * streamed as it happens.
 *
 * THE STEPS ARE REAL. The product we are beating shows an animated progress
 * bar in front of one synchronous request, so the bar is a guess that is
 * wrong in both directions: it crawls while the model is fast and sits at 90%
 * while the model is slow. Every `{t:"step"}` below is written at the moment
 * the work begins and the moment it ends, which is why `tailorResume` takes
 * an `onEvent` callback rather than being timed from outside.
 *
 * There are no `{t:"token"}` events here, and that is the same decision for
 * the same reason. Each step is one strict-schema call through
 * `structured()`; there is no token stream to forward, and manufacturing one
 * would be the fake progress bar again, one layer down.
 *
 * Failure policy, in order of how much it matters:
 *
 *   - The guard cannot be reached  -> the run FAILS with an error event.
 *     `tailorResume` lets `GuardUnavailableError` out and this route lets it
 *     reach the user. A tailored resume nobody verified is the one output
 *     this product must never hand over with a green tick, and "the checker
 *     was down" is not a pass.
 *   - The posting's site blocked us -> `needsJdPaste`, which the editor turns
 *     into a paste box. Expected, not exceptional.
 *   - The database rejected the write -> `persisted:false` on the done event.
 *     The user still gets the document. Supabase has no schema applied on
 *     this deployment and a missing table must not eat a paid model run.
 */

import { GuardUnavailableError } from "@/lib/pipeline/guard-client";
import { analyzeGaps, extractJobSpec, extractResumeFacts, tailorResume } from "@/lib/pipeline/steps";
import { LLMError } from "@/lib/llm/structured";
import { gate, readJsonBody, refuse, sseStream, type TailorEvent } from "@/lib/sse";
import type { ServerClient } from "@/lib/supabase/server";
import { z } from "zod";

import { fetchJobDescription } from "./jd";
import { persistRun } from "./persist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Four model calls, one of them a repair. Five minutes is the honest ceiling. */
export const maxDuration = 300;

const BodySchema = z.object({
  resumeText: z.string().optional(),
  /** The id `/api/start/upload` returned, or a resume to attach a version to. */
  resumeId: z.string().optional(),
  jdText: z.string().optional(),
  jdUrl: z.string().optional(),
  templateId: z.string().optional(),
});

export async function POST(request: Request) {
  const entry = await gate("tailor");
  if (!entry.ok) return entry.response;

  // 3MB: a resume is kilobytes and a pasted posting is kilobytes. Anything
  // this large is a paste accident or an attack, and either way the answer
  // is the same and it should arrive before we have read the whole body.
  const body = await readJsonBody(request, BodySchema, 3_000_000);
  if (!body.ok) return body.response;

  const { resumeText, resumeId, jdText, jdUrl, templateId } = body.value;

  // Both of these are the caller's mistake, both are fixable, and neither is
  // worth opening a stream to report. 4xx before the first byte of SSE.
  if (!resumeText?.trim() && !resumeId) {
    return refuse(
      "No resume was provided.",
      "Upload a PDF or DOCX, or paste your resume text, then try again.",
      400,
    );
  }
  if (!jdText?.trim() && !jdUrl?.trim()) {
    return refuse(
      "No job description was provided.",
      "Paste the posting text, or give the URL of the posting.",
      400,
    );
  }

  const { userId, supabase } = entry;

  return sseStream<TailorEvent>({
    signal: request.signal,
    onError: describeError,
    run: async (write) => {
      /* ------------------------------------------------------ parse ---- */

      write.send({ t: "step", step: "parse", state: "start" });

      const raw = resumeText?.trim()
        ? resumeText
        : await loadResumeText(supabase, resumeId as string);

      if (!raw) {
        write.send({
          t: "error",
          message: "That resume could not be found.",
          hint: "Upload the file again, or paste the text of your resume.",
        });
        return;
      }

      // `{kind:"user"}`, always. A cache entry derived from a resume is that
      // person's data, and a global key on resume-derived input is one tenant
      // reading another's. See the privacy note in lib/pipeline/cache.ts.
      const scope = { kind: "user", userId } as const;

      const facts = await extractResumeFacts(raw, scope, write.signal);
      write.send({ t: "step", step: "parse", state: "done" });

      /* --------------------------------------------------------- jd ---- */

      write.send({ t: "step", step: "jd", state: "start" });

      let postingText: string;
      let sourceNote: string;

      if (jdText?.trim()) {
        postingText = jdText.trim();
        sourceNote = "pasted by the candidate";
      } else {
        const fetched = await fetchJobDescription((jdUrl as string).trim(), write.signal);
        if (fetched.kind !== "ok") {
          // Blocked and failed both end the same way for the user, and the
          // remedy is the same sentence, so the flag is the same too.
          write.send({
            t: "error",
            message: fetched.reason,
            hint: fetched.hint,
            needsJdPaste: true,
          });
          return;
        }
        postingText = fetched.text;
        sourceNote = fetched.sourceNote;
      }

      // Global scope, and only here: a public posting carries nothing private,
      // and two candidates applying to the same role should pay for one
      // decomposition between them. `extractJobSpec` hardcodes that.
      const job = await extractJobSpec(postingText, sourceNote, write.signal);
      write.send({ t: "step", step: "jd", state: "done" });

      /* ------------------------------------------------------- gaps ---- */

      write.send({ t: "step", step: "gaps", state: "start" });
      const gaps = await analyzeGaps(job.value, facts.value, scope, write.signal);
      write.send({ t: "step", step: "gaps", state: "done" });

      /* ----------------------------------------------------- tailor ---- */

      write.send({ t: "step", step: "tailor", state: "start" });

      const outcome = await tailorResume({
        job: job.value,
        facts: facts.value,
        gaps: gaps.value,
        rawResumeText: raw,
        scope,
        signal: write.signal,
        onEvent: (event) => {
          if (event.type === "draft") {
            write.send({ t: "step", step: "tailor", state: "done" });
            write.send({ t: "step", step: "guard", state: "start" });
          } else if (event.type === "verified") {
            write.send({ t: "step", step: "guard", state: "done" });
          } else if (event.type === "repairing") {
            // The first draft failed verification. Say so while the rewrite
            // runs, rather than after: this is the twenty seconds where the
            // user most deserves to know what is happening and why.
            write.send({ t: "guard", passed: false, violations: [], repairing: true });
            write.send({ t: "step", step: "tailor", state: "start" });
          }
        },
      });

      if (outcome.repairAttempted) {
        // `tailorResume` reports the repair's own draft and re-verification
        // silently, so the second pair of brackets is closed here.
        write.send({ t: "step", step: "tailor", state: "done" });
        write.send({ t: "step", step: "guard", state: "start" });
        write.send({ t: "step", step: "guard", state: "done" });
      }

      write.send({
        t: "guard",
        passed: outcome.truth.passed,
        violations: outcome.truth.violations,
        repairing: false,
      });

      /* ------------------------------------------------------ score ---- */

      // Already computed inside `tailorResume`, by formula, on the document
      // that was just verified. Bracketed as a step anyway so the UI's step
      // list is complete rather than ending on a guard.
      write.send({ t: "step", step: "score", state: "start" });
      write.send({ t: "score", report: outcome.report });
      write.send({ t: "step", step: "score", state: "done" });

      /* ---------------------------------------------------- persist ---- */

      const saved = await persistRun({
        supabase,
        userId,
        resumeId,
        templateId,
        jdText: postingText,
        jdUrl,
        sourceNote,
        job: job.value,
        gaps: gaps.value,
        tailored: outcome.tailored,
        truth: outcome.truth,
        report: outcome.report,
      });

      if (!saved.persisted) {
        console.warn("[tailor] run not persisted:", saved.reason);
      }

      write.send({
        t: "done",
        resumeId: saved.resumeId,
        versionId: saved.versionId,
        tailored: outcome.tailored,
        truth: outcome.truth,
        gaps: gaps.value,
        persisted: saved.persisted,
      });
    },
  });
}

/**
 * The raw text behind an uploaded document.
 *
 * Best-effort by necessity: the table may not exist yet. A miss is not an
 * exception, it is "we could not find your resume", which the caller turns
 * into an instruction to upload it again.
 */
async function loadResumeText(supabase: ServerClient, id: string): Promise<string> {
  type Loose = {
    from: (table: string) => {
      select: (columns: string) => {
        eq: (
          column: string,
          value: string,
        ) => {
          maybeSingle: () => Promise<{
            data: { raw_text?: string | null } | null;
            error: unknown;
          }>;
        };
      };
    };
  };

  try {
    const { data } = await (supabase as unknown as Loose)
      .from("documents")
      .select("raw_text")
      .eq("id", id)
      .maybeSingle();
    return (data?.raw_text ?? "").trim();
  } catch (error) {
    console.warn("[tailor] could not read the stored resume:", error);
    return "";
  }
}

/**
 * Every thrown failure, as one sentence the user can act on.
 *
 * The guard case is first because it is the one that must not be softened.
 */
function describeError(error: unknown): TailorEvent {
  if (error instanceof GuardUnavailableError) {
    return {
      t: "error",
      message: error.message,
      hint:
        "Nothing has been saved and nothing is shown, because an unverified resume is " +
        "worse than no resume. Try again in a minute.",
    };
  }

  if (error instanceof LLMError) {
    return {
      t: "error",
      message: error.message,
      hint:
        error.kind === "no_key"
          ? "Set OPENAI_API_KEY in .env.local and restart the server."
          : "This one is on us. Try again; nothing was charged for a failed run.",
    };
  }

  console.error("[tailor] unhandled:", error);
  return {
    t: "error",
    message: "The tailoring run failed partway through.",
    hint: "Nothing was saved. Try again, and if it repeats, paste the posting text instead of the link.",
  };
}
