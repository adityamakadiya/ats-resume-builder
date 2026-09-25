/**
 * POST /api/suggest/evidence
 *
 * Writes the line for a term the resume never mentioned.
 *
 * The attest flow asked the candidate to compose the bullet themselves,
 * which is the hardest part of the job handed back to the person who came
 * here to avoid doing it. They know what they did; turning it into the
 * register a resume uses is what this product is for.
 *
 * So they say the term, the role and roughly what they did, in as few words
 * as they like, and this returns a bullet.
 *
 * NO GUARD CALL HERE, AND THAT IS DELIBERATE. The guard checks a line
 * against the fact ledger, and this line has no fact behind it yet: it is
 * about to become one. Running it would refuse every time, correctly and
 * uselessly. What stands in for the guard is the prompt's single rule, that
 * nothing may appear which the candidate did not say, plus the fact that
 * the result is stored as `attested` and never counted as traced. The
 * product does not vouch for this line. It says so, to the user, before
 * they write it and again on the provenance badge afterwards.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { ResumeFactsSchema } from "@ats/core";

import { EVIDENCE } from "@/lib/pipeline/prompts";
import { structured } from "@/lib/llm/structured";
import { gate, readJsonBody, refuse } from "@/lib/sse";

export const runtime = "nodejs";
export const maxDuration = 60;

const BodySchema = z.object({
  /** The posting's term, spelled the posting's way. */
  term: z.string().min(1).max(120),
  /** The fact id of the role or project it belongs to. */
  groupId: z.string().min(1).max(64),
  /** What the candidate said they did. Their words, however few. */
  note: z.string().min(3).max(1_000),
  facts: ResumeFactsSchema,
});

const ReplySchema = z.object({
  text: z.string(),
  confident: z.boolean().default(true),
  note: z.string().default(""),
});

export async function POST(request: Request) {
  const entry = await gate("chat");
  if (!entry.ok) return entry.response;

  const body = await readJsonBody(request, BodySchema, 1_500_000);
  if (!body.ok) return body.response;

  const { term, groupId, note, facts } = body.value;

  const role =
    facts.experience.find((e) => e.id === groupId) ?? facts.projects.find((p) => p.id === groupId);
  if (!role) {
    return refuse(
      "That role is not on this resume.",
      "Reload the page so the editor and the server agree on it.",
      422,
    );
  }

  const where =
    "company" in role
      ? `${role.title} at ${role.company}`.trim()
      : `the project ${role.name}`.trim();

  /*
    The role's own bullets go in as register, not as material. The prompt
    is explicit that nothing may come from them; they are there so the new
    line sounds like the lines around it rather than pasted in.
  */
  const neighbours = role.bullets.slice(0, 6).map((b) => `- ${b.text}`).join("\n");

  const user = [
    `THE TERM: ${term}`,
    `WHERE: ${where}`,
    `WHAT THE CANDIDATE SAID THEY DID:\n${note}`,
    neighbours
      ? `THE OTHER BULLETS IN THIS ROLE, for register only. Nothing in the line you write may come from these:\n${neighbours}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const reply = await structured({
      system: EVIDENCE.text,
      user,
      schema: ReplySchema,
      schemaName: "EvidenceLine",
      step: "evidence",
      signal: request.signal,
    });

    return NextResponse.json({
      ok: true,
      text: reply.value.text.trim(),
      confident: reply.value.confident,
      note: reply.value.note,
    });
  } catch (error) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return refuse(
      "That line could not be written just now.",
      error instanceof Error ? error.message : "Try again in a moment.",
      502,
    );
  }
}
