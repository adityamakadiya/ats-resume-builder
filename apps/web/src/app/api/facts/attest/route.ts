/**
 * POST /api/facts/attest
 *
 * Records something the candidate did that their resume never said.
 *
 * This is the other half of the truth guard. Refusing a claim because no
 * fact supports it is only half an answer: very often the claim is true and
 * the resume simply never mentioned it, and a product that can only say no
 * turns a correct refusal into a dead end. The user supplies the missing
 * evidence, it enters the ledger as theirs, and the guard can cite it from
 * then on.
 *
 * `origin: 'attested'` is the whole point of the column. 0001 shipped it
 * before anything wrote to it, on the reasoning that provenance cannot be
 * backfilled - once rows exist with no origin recorded there is no way to
 * tell a parsed fact from a supplied one except by guessing. This is the
 * route that finally uses it.
 *
 * The write is best effort in the same sense as the rest of the pipeline: a
 * failure costs a reload, not the user's typing, because the fact is already
 * live in the editor by the time this is called.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { getServerClient } from "@/lib/supabase/server";
import { describeDbError } from "@/lib/supabase/errors";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BodySchema = z.object({
  documentId: z.string().regex(UUID, "documentId must be a uuid"),
  /** `E1.A1`: the role it belongs to, and which attested line it is. */
  factKey: z.string().min(1).max(64),
  /** The candidate's own sentence. Stored verbatim, never paraphrased. */
  text: z.string().min(1).max(600),
});

function refuse(reason: string, remedy: string, status: number) {
  return NextResponse.json({ ok: false, reason, remedy }, { status });
}

export async function POST(request: Request) {
  const supabase = await getServerClient();
  if (!supabase) {
    return refuse(
      "This deployment has no database configured.",
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart.",
      503,
    );
  }

  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await request.json());
  } catch (error) {
    return refuse(
      error instanceof z.ZodError
        ? `That was not a fact we could record: ${error.issues[0]?.message}`
        : "The request body was not readable.",
      "Reload the page and try again.",
      400,
    );
  }

  const { documentId, factKey, text } = parsed;

  const { data, error } = await (supabase as unknown as {
    from: (t: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (c: string) => { single: () => Promise<{ data: { id?: string } | null; error: unknown }> };
      };
    };
  })
    .from("facts")
    .insert({
      document_id: documentId,
      fact_key: factKey,
      text,
      origin: "attested",
      // No user_id: 0009 defaults it. No entities_json: the guard tokenises
      // what it needs at check time, and guessing here would put a second
      // extractor in the codebase that nothing tests.
      evidence_json: { section: "attested", quote: text },
    })
    .select("id")
    .single();

  if (error) {
    const described = describeDbError(error as { code?: string; message?: string }, "Recording what you told us");
    console.warn("[attest] could not record the fact:", described.reason);
    return NextResponse.json(
      { ok: false, reason: described.reason, remedy: described.remedy },
      { status: described.status },
    );
  }

  return NextResponse.json({ ok: true, id: data?.id ?? null });
}
