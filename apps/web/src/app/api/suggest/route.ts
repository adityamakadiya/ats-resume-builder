/**
 * POST /api/suggest
 *
 * Rewrites one line, and proves it before offering it.
 *
 * The detector in `lib/editor/writing.ts` finds weak lines with no model at
 * all, because finding them needs no intelligence and has to run on every
 * keystroke. Writing the better version does need one, so it happens here,
 * per line, when the user asks for that line.
 *
 * ONE LINE, NOT THE DOCUMENT. A whole-document pass is the tailor, and it
 * already exists. This is for the user who has read a card, agrees with it,
 * and wants that one bullet fixed. Small, fast and individually refusable
 * beats another forty-second run they have to accept or discard whole.
 *
 * THE GUARD RUNS ON THE RESULT. A rewrite is exactly where invention creeps
 * in: the model is being asked to make a line stronger, and the easiest way
 * to make a line stronger is to add a number. So the proposed line is put
 * back into the document and checked by the same guard the tailor uses, and
 * a rewrite that fails is not shown. The user never sees a suggestion the
 * product would have refused.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ResumeFactsSchema,
  JobSpecSchema,
  type TailoredResume,
} from "@ats/core";

import { REWRITE } from "@/lib/pipeline/prompts";
import { structured } from "@/lib/llm/structured";
import { runGuard, GuardUnavailableError } from "@/lib/pipeline/guard-client";
import { gate, readJsonBody, refuse } from "@/lib/sse";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY = 1_500_000;

const BodySchema = z.object({
  /** The line as it stands. */
  text: z.string().min(1).max(2_000),
  /** Where it lives, echoed back so the client can apply it without matching. */
  path: z.string().min(1).max(200),
  /** What the detector said was wrong, in words. */
  problems: z.array(z.string().max(400)).max(6).default([]),
  facts: ResumeFactsSchema,
  job: JobSpecSchema.nullable().default(null),
  /** The document, so the guard checks the line in place. */
  tailored: z.unknown(),
});

const ReplySchema = z.object({
  text: z.string(),
  source_ids: z.array(z.string()).default([]),
  changed: z.boolean().default(true),
  note: z.string().default(""),
});

/** The line, put back where it came from, for the guard to check in place. */
function withLine(tailored: TailoredResume, path: string, text: string): TailoredResume | null {
  const parts = path.split("/").filter(Boolean);
  // /experience/0/bullets/2/text  or  /summary/text
  const clone = structuredClone(tailored) as unknown as Record<string, unknown>;
  let node: unknown = clone;

  for (let i = 0; i < parts.length - 1; i += 1) {
    if (node === null || typeof node !== "object") return null;
    node = (node as Record<string, unknown>)[parts[i]!];
  }
  if (node === null || typeof node !== "object") return null;

  (node as Record<string, unknown>)[parts[parts.length - 1]!] = text;
  return clone as unknown as TailoredResume;
}

export async function POST(request: Request) {
  const entry = await gate("chat");
  if (!entry.ok) return entry.response;

  const body = await readJsonBody(request, BodySchema, MAX_BODY);
  if (!body.ok) return body.response;

  const { text, path, problems, facts, job, tailored } = body.value;

  const allowedIds = [
    ...facts.experience.flatMap((e) => e.bullets.map((b) => b.id)),
    ...facts.projects.flatMap((p) => p.bullets.map((b) => b.id)),
    ...facts.other_sections.flatMap((o) => o.bullets.map((b) => b.id)),
  ];

  const user = [
    `THE LINE TO REWRITE:\n${text}`,
    problems.length > 0 ? `WHAT IS WRONG WITH IT:\n- ${problems.join("\n- ")}` : "",
    job
      ? `THE POSTING: ${job.title} at ${job.company}. Terms it uses: ${job.keywords
          .map((k) => k.term)
          .slice(0, 25)
          .join(", ")}`
      : "",
    `FACTS YOU MAY DRAW ON (id: text). Nothing outside this list exists:\n${[
      ...facts.experience.flatMap((e) => e.bullets.map((b) => `${b.id}: ${b.text}`)),
      ...facts.projects.flatMap((p) => p.bullets.map((b) => `${b.id}: ${b.text}`)),
    ]
      .slice(0, 80)
      .join("\n")}`,
    `VALID source_ids: ${allowedIds.join(", ")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  let reply;
  try {
    reply = await structured({
      system: REWRITE.text,
      user,
      schema: ReplySchema,
      schemaName: "RewrittenLine",
      step: "rewrite",
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return refuse(
      "That line could not be rewritten just now.",
      error instanceof Error ? error.message : "Try again in a moment.",
      502,
    );
  }

  const proposed = reply.value;

  if (!proposed.changed || proposed.text.trim() === text.trim()) {
    return NextResponse.json({
      ok: true,
      changed: false,
      text,
      note: proposed.note || "This line is already as strong as the facts behind it allow.",
    });
  }

  /*
    Ids the model invented are dropped rather than trusted. An unknown id is
    a citation that does not resolve, the guard would reject the line for it,
    and silently forwarding one turns a fixable answer into a refusal the
    user cannot act on.
  */
  const cited = proposed.source_ids.filter((id) => allowedIds.includes(id));

  const candidate = withLine(tailored as TailoredResume, path, proposed.text);
  if (!candidate) {
    return refuse(
      "That line could not be placed back into the document.",
      "Reload the page so the editor and the server agree on its shape.",
      422,
    );
  }

  let truth;
  try {
    truth = await runGuard({ tailored: candidate, facts, entailment: false });
  } catch (error) {
    if (error instanceof GuardUnavailableError) {
      return refuse(
        "The rewrite could not be verified, so it is not being offered.",
        "An unchecked rewrite is worse than the line you already have. Try again in a minute.",
        503,
      );
    }
    throw error;
  }

  const offending = truth.violations.filter(
    (v) => v.severity === "error" && v.offending && proposed.text.includes(v.offending),
  );

  if (offending.length > 0) {
    return NextResponse.json({
      ok: true,
      changed: false,
      text,
      refused: true,
      note:
        "A stronger version was written and it claimed something your resume does not say, so it was thrown away. The line stands as it is.",
      violations: offending.map((v) => ({ code: v.code, detail: v.detail })),
    });
  }

  return NextResponse.json({
    ok: true,
    changed: true,
    text: proposed.text,
    source_ids: cited,
    note: proposed.note,
  });
}
