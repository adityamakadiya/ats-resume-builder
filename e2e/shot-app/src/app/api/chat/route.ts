/**
 * POST /api/chat
 *
 * The editor's assistant. The model proposes patches; this route decides
 * whether the user is ever offered them.
 *
 * THE GUARD RUNS BEFORE THE PROPOSAL REACHES THE BROWSER, AND THAT IS THE
 * WHOLE PRODUCT. The obvious implementation streams the tool call straight
 * through and verifies on accept. That is wrong in a way that is hard to
 * undo: a suggestion rendered with an Accept button has already been
 * endorsed. If it reads well and carries a fabricated 40%, some fraction of
 * users click it, and the ones who do not still spend attention deciding.
 * So every proposed op is applied to a COPY, the copy goes through the truth
 * guard, and only a copy that survives becomes a `{t:"patch"}`. One that does
 * not becomes a `{t:"refused"}` carrying the violation, so the UI can say
 * which line could not be traced and to what.
 *
 * Two gates, in order, because they refuse different things:
 *
 *   1. `validateOps` from @ats/core. Structural and absolute. An op that
 *      would change a company, a job title or an employment date is refused
 *      outright, before any model or service is consulted, because those are
 *      the four fields a recruiter verifies against LinkedIn in thirty
 *      seconds and there is no wording that makes changing them acceptable.
 *   2. The truth guard. Semantic. Does the new text say anything the
 *      original resume does not support.
 *
 * WHEN THE GUARD SERVICE IS DOWN, EVERY PATCH IS REFUSED. Not shown with a
 * warning, not shown greyed out: refused, with the reason. An unverifiable
 * suggestion is exactly the thing this route exists to keep off the page, and
 * "the checker was unreachable" is the situation in which that matters most,
 * not an exception to it. The chat keeps talking; it just cannot hand over
 * edits until verification comes back.
 */

import {
  JobSpecSchema,
  ResumeFactsSchema,
  TailoredResumeSchema,
  applyPatch,
  computeAtsReport,
  deepClone,
  validateOps,
  type JobSpec,
  type Op,
  type ResumeFacts,
  type TailoredResume,
  type TruthReport,
} from "@ats/core";
import OpenAI from "openai";
import { z } from "zod";

import { configFor } from "@/lib/llm/profiles";
import {
  CHAT_SYSTEM,
  EDIT_RESUME_TOOL,
  EDIT_RESUME_TOOL_NAME,
  EditResumeArgsSchema,
  chatContext,
} from "@/lib/pipeline/chat";
import { GuardUnavailableError, runGuard } from "@/lib/pipeline/guard-client";
import { gate, readJsonBody, refuse, sseStream, type ChatEvent, type Violation } from "@/lib/sse";
import type { ServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One turn, plus a guard call per proposal. Well under the tailor ceiling. */
export const maxDuration = 120;

const MessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const BodySchema = z.object({
  /** The document as it is on screen right now, not as it was saved. */
  tailored: TailoredResumeSchema,
  facts: ResumeFactsSchema,
  job: JobSpecSchema.optional(),
  rawResumeText: z.string().optional(),
  messages: z.array(MessageSchema).min(1).max(40),
  resumeId: z.string().optional(),
  versionId: z.string().optional(),
});

export async function POST(request: Request) {
  const entry = await gate("chat");
  if (!entry.ok) return entry.response;

  const body = await readJsonBody(request, BodySchema, 3_000_000);
  if (!body.ok) return body.response;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // Before the stream: this is a deployment fault, not a chat turn, and a
    // 500 inside an SSE body is the hardest kind of error to read.
    return refuse(
      "This deployment has no model configured.",
      "Set OPENAI_API_KEY in .env.local and restart the server.",
      503,
    );
  }

  const input = body.value;
  const { userId, supabase } = entry;

  return sseStream<ChatEvent>({
    signal: request.signal,
    onError: describeError,
    run: async (write) => {
      const config = configFor("chat");
      const client = new OpenAI({
        apiKey,
        timeout: Number(process.env.LLM_TIMEOUT_MS ?? 600_000),
        maxRetries: 0,
      });

      /* ------------------------------------------------- the model ---- */

      const stream = await client.chat.completions.create(
        {
          model: config.model,
          reasoning_effort: config.effort,
          max_completion_tokens: config.maxOutputTokens,
          tools: [EDIT_RESUME_TOOL],
          tool_choice: "auto",
          // Stable first, conversation last. The provider caches on the
          // leading tokens; a context block that moves pays full price every
          // turn. Same ordering rule as lib/llm/structured.ts.
          messages: [
            { role: "system", content: CHAT_SYSTEM.text },
            { role: "user", content: chatContext(input) },
            ...input.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: true,
        },
        // The disconnect chain. Without this, a closed tab keeps generating.
        { signal: write.signal },
      );

      const calls = new Map<number, { id: string; name: string; args: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (typeof delta.content === "string" && delta.content) {
          // Real tokens, forwarded as they arrive. This is the only route
          // that emits them, because it is the only one that has them.
          write.send({ t: "token", text: delta.content });
        }

        for (const call of delta.tool_calls ?? []) {
          const slot = calls.get(call.index) ?? { id: "", name: "", args: "" };
          if (call.id) slot.id = call.id;
          if (call.function?.name) slot.name += call.function.name;
          if (call.function?.arguments) slot.args += call.function.arguments;
          calls.set(call.index, slot);
        }
      }

      /* ------------------------------------------- verify, then offer -- */

      const reviewer = new PatchReviewer(input, write.signal);
      const proposed: string[] = [];
      let refusedCount = 0;

      for (const call of calls.values()) {
        if (call.name !== EDIT_RESUME_TOOL_NAME) {
          // The model called something that does not exist. Not the user's
          // problem and not worth an error banner; log and move on.
          console.warn(`[chat] ignoring unknown tool call: ${call.name || "(unnamed)"}`);
          continue;
        }

        const parsed = parseArgs(call.args);
        if (!parsed.ok) {
          refusedCount += 1;
          write.send({
            t: "refused",
            reason: parsed.reason,
            violation: violation("UNSOURCED_LINE", "tool call", parsed.reason, ""),
          });
          continue;
        }

        write.send({ t: "step", step: "guard", state: "start" });
        const verdict = await reviewer.review(parsed.value.ops);
        write.send({ t: "step", step: "guard", state: "done" });

        if (verdict.kind === "refused") {
          refusedCount += 1;
          write.send({ t: "refused", reason: verdict.reason, violation: verdict.violation });
          continue;
        }

        const id = call.id || crypto.randomUUID();
        proposed.push(id);

        write.send({
          t: "patch",
          id,
          ops: parsed.value.ops,
          rationale: parsed.value.rationale || firstRationale(parsed.value.ops),
          scoreDelta: verdict.scoreDelta,
        });

        await recordProposal(supabase, {
          userId,
          resumeId: input.resumeId,
          versionId: input.versionId,
          ops: parsed.value.ops,
        });
      }

      write.send({ t: "done", proposed, refused: refusedCount });
    },
  });
}

/* ------------------------------------------------------------- review  */

type Verdict =
  | { kind: "ok"; scoreDelta: number }
  | { kind: "refused"; reason: string; violation: Violation };

/**
 * Applies ops to a copy and decides whether the user may see them.
 *
 * The baseline matters. A document that already has an unresolved violation
 * somewhere would otherwise make every subsequent suggestion unacceptable,
 * including the ones that fix it, so the guard is run once on the document as
 * it stands and a proposal is judged on the violations it ADDS. The baseline
 * is computed lazily, because a turn that proposes nothing should not pay for
 * a guard call, and cached for the turn, because three proposals should not
 * pay for it three times.
 */
class PatchReviewer {
  #baseline: Set<string> | null = null;
  #baseScore: number | null = null;

  constructor(
    private readonly input: {
      tailored: TailoredResume;
      facts: ResumeFacts;
      job?: JobSpec;
      rawResumeText?: string;
    },
    private readonly signal: AbortSignal,
  ) {}

  async review(ops: Op[]): Promise<Verdict> {
    /* Gate 1: structural. No model, no service, no argument. */
    const structural = validateOps(this.input.tailored, ops);
    if (!structural.ok) {
      const reason = structural.errors.join("; ");
      const guarded = /guarded|employment history/i.test(reason);
      return {
        kind: "refused",
        reason: guarded
          ? "That edit would change an employer, a job title or an employment date, " +
            "which this editor does not allow. Those are the facts a recruiter checks first. " +
            `(${reason})`
          : `That edit does not apply to the open document: ${reason}`,
        violation: violation(
          guarded ? "ALTERED_EMPLOYER_FACT" : "UNSOURCED_LINE",
          ops[0]?.path ?? "",
          reason,
          asText(ops[0]?.value),
        ),
      };
    }

    let candidate: TailoredResume;
    try {
      candidate = applyPatch(deepClone(this.input.tailored), ops);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "the edit could not be applied";
      return {
        kind: "refused",
        reason: `That edit does not apply to the open document: ${reason}`,
        violation: violation("UNSOURCED_LINE", ops[0]?.path ?? "", reason, ""),
      };
    }

    /* Gate 2: semantic. Can every new line be traced to the real resume. */
    let baseline: Set<string>;
    let report: TruthReport;
    try {
      baseline = await this.#baselineViolations();
      report = await this.#guard(candidate);
    } catch (error) {
      if (!(error instanceof GuardUnavailableError)) throw error;
      // The single most important branch in this file. Unverifiable is
      // refused, never shown with a caveat.
      return {
        kind: "refused",
        reason:
          "This edit cannot be offered because the verification service is unreachable, " +
          "so there is no way to confirm it against your original resume. " +
          "The chat still works; edits will come back when verification does.",
        violation: violation(
          "UNSUPPORTED_CLAIM",
          ops[0]?.path ?? "",
          error.message,
          asText(ops[0]?.value),
        ),
      };
    }

    const introduced = report.violations.filter(
      (v) => v.severity === "error" && !baseline.has(key(v)),
    );

    if (introduced.length > 0) {
      const first = introduced[0] as Violation;
      return {
        kind: "refused",
        reason:
          `That edit was not offered: ${first.detail} ` +
          "It cannot be traced to anything in your uploaded resume, so accepting it would " +
          "put a claim on the page you could not defend in an interview.",
        violation: first,
      };
    }

    return { kind: "ok", scoreDelta: this.#delta(candidate) };
  }

  async #baselineViolations(): Promise<Set<string>> {
    if (this.#baseline) return this.#baseline;
    const report = await this.#guard(this.input.tailored);
    this.#baseline = new Set(report.violations.map(key));
    return this.#baseline;
  }

  #guard(doc: TailoredResume): Promise<TruthReport> {
    return runGuard({
      tailored: doc,
      facts: this.input.facts,
      rawResumeText: this.input.rawResumeText ?? "",
      jdTerms: this.input.job ? jdTerms(this.input.job) : [],
      // Token checks only. Entailment costs a model call, and this runs on
      // every proposal in an interactive loop rather than once on a finished
      // draft; guard-client.ts makes the same distinction for the same reason.
      entailment: false,
      signal: this.signal,
    });
  }

  /**
   * What the Accept button promises. Computed on the same copy the guard
   * just cleared, so the number and the document cannot disagree.
   */
  #delta(candidate: TailoredResume): number {
    const job = this.input.job;
    if (!job) return 0;
    this.#baseScore ??= computeAtsReport(job, this.input.facts, this.input.tailored).overall;
    const after = computeAtsReport(job, this.input.facts, candidate).overall;
    return Math.round((after - this.#baseScore) * 10) / 10;
  }
}

function key(v: Violation): string {
  return `${v.code}|${v.location}|${v.offending}`;
}

function jdTerms(job: JobSpec): string[] {
  return [
    ...job.requirements.map((r) => r.term),
    ...job.keywords.flatMap((k) => [k.term, ...k.variants]),
  ];
}

/* ------------------------------------------------------------ helpers  */

function violation(
  code: Violation["code"],
  location: string,
  detail: string,
  offending: string,
): Violation {
  return { code, severity: "error", location, detail, offending };
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  return JSON.stringify(value);
}

function firstRationale(ops: Op[]): string {
  return ops.find((o) => o.rationale)?.rationale ?? "Suggested edit.";
}

type ParsedArgs =
  | { ok: true; value: { ops: Op[]; rationale: string } }
  | { ok: false; reason: string };

function parseArgs(raw: string): ParsedArgs {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "The assistant proposed an edit that was not readable JSON." };
  }

  const parsed = EditResumeArgsSchema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, reason: `The assistant proposed a malformed edit: ${issues}.` };
  }

  return { ok: true, value: { ops: parsed.data.ops as Op[], rationale: parsed.data.rationale } };
}

/**
 * Write the proposal down, if the table exists.
 *
 * Best-effort, like every other write in this app until the schema is
 * applied. A proposal that could not be logged is still a proposal the user
 * can accept; losing the audit row is a smaller loss than losing the turn.
 */
async function recordProposal(
  supabase: ServerClient,
  input: { userId: string; resumeId?: string; versionId?: string; ops: Op[] },
): Promise<void> {
  if (!input.resumeId || !input.versionId) return;

  type Loose = {
    from: (table: string) => {
      insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;
    };
  };

  try {
    const { error } = await (supabase as unknown as Loose).from("patches").insert({
      user_id: input.userId,
      resume_id: input.resumeId,
      base_version_id: input.versionId,
      ops_json: input.ops,
      origin: "ai_chat",
      status: "proposed",
    });
    if (error) console.warn("[chat] proposal not recorded:", error.message);
  } catch (error) {
    console.warn("[chat] proposal not recorded:", error);
  }
}

function describeError(error: unknown): ChatEvent {
  if (error instanceof GuardUnavailableError) {
    return {
      t: "error",
      message: error.message,
      hint: "Edits are withheld while verification is down. Try again in a minute.",
    };
  }

  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    if (status === 429) {
      return {
        t: "error",
        message: "The model is rate limited right now.",
        hint: "Wait a few seconds and send that again.",
      };
    }
    if (status === 401 || status === 403) {
      return {
        t: "error",
        message: "The model rejected this deployment's API key.",
        hint: "Check OPENAI_API_KEY in .env.local.",
      };
    }
    return {
      t: "error",
      message: "The assistant could not answer that.",
      hint: "Try rephrasing, or ask for one change at a time.",
    };
  }

  console.error("[chat] unhandled:", error);
  return {
    t: "error",
    message: "The assistant stopped partway through that answer.",
    hint: "Nothing was changed in your document. Try again.",
  };
}
