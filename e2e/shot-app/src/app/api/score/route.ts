/**
 * POST /api/score
 *
 * The one route that must never be the thing that fails.
 *
 * The editor re-scores on every keystroke, so this is on the typing path. It
 * is pure computation: no model, no document service, no database read, no
 * cache. `computeAtsReport` is a deterministic function in `@ats/core` that
 * runs identically here and in the browser, which means the number the user
 * watches move while typing is the same number that was stored at the end of
 * the tailor run. A route that asked a model for a score could not promise
 * that, and could not answer in the time between two keystrokes.
 *
 * It still authenticates, because an unauthenticated scoring endpoint is a
 * free CPU-burning endpoint. That is the only I/O on the path, and it is the
 * platform's cached session check rather than a query of ours.
 *
 * Deliberately NOT streaming. There is nothing to stream: the answer exists
 * in a few milliseconds, and an SSE frame around it would cost more than the
 * computation.
 */

import {
  JobSpecSchema,
  ResumeFactsSchema,
  TailoredResumeSchema,
  computeAtsReport,
} from "@ats/core";
import { z } from "zod";

import { gate, readJsonBody, refuse } from "@/lib/sse";

export const runtime = "nodejs";
// Never cached and never prerendered: the answer is a function of the body.
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  tailored: TailoredResumeSchema,
  facts: ResumeFactsSchema,
  job: JobSpecSchema,
});

export async function POST(request: Request) {
  const entry = await gate("score");
  if (!entry.ok) return entry.response;

  const body = await readJsonBody(request, BodySchema);
  if (!body.ok) return body.response;

  try {
    const report = computeAtsReport(body.value.job, body.value.facts, body.value.tailored);
    return Response.json({ ok: true, report });
  } catch (error) {
    // Scoring is pure, so reaching here means a document shape the scorer
    // cannot walk. Say so plainly: the editor's fallback is to keep the last
    // good score on screen, and it needs to know this was our fault.
    console.error("[score] computeAtsReport threw:", error);
    return refuse(
      "The score could not be computed for this document.",
      "Your text is safe. Undo the last edit, or reload to fetch the saved version.",
      422,
    );
  }
}
