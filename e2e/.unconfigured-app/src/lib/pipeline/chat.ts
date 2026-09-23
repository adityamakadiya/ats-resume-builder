/**
 * The editor chat agent: its prompt, its one tool, and the shape of that
 * tool's arguments.
 *
 * It lives here rather than in prompts.ts for the reason prompts.ts states in
 * its own comment: this is the one prompt whose content is a description of a
 * tool rather than of a schema, and the two have to be edited together or the
 * model is being told about an argument that no longer exists.
 *
 * The version string carries the same contract as every other prompt: bump it
 * in the same commit as any edit to the text or to the tool below. Nothing
 * caches a chat turn today, but the version is what the transcript in
 * `chat_messages` is read back against, and a prompt that changed without a
 * bump makes an old conversation unreproducible.
 *
 * ONE TOOL, AND IT PROPOSES PATCHES. The model never returns a document. A
 * model that hands back a rewritten resume has, in practice, rewritten lines
 * nobody asked it to touch, and the diff is where that hides. Patches make
 * every change addressable, reviewable, invertible, and - the point of this
 * product - individually checkable against the guard before the user is
 * offered an Accept button.
 */

import { z } from "zod";
import type { Prompt } from "./prompts";

export const CHAT_PROMPT_VERSION = "1.0.0";

export const CHAT_SYSTEM: Prompt = {
  id: "chat",
  version: CHAT_PROMPT_VERSION,
  text: `You are the editing assistant inside a resume editor. The candidate has a tailored resume open, the job description beside it, and their original uploaded resume behind both. You help them improve the open document, one concrete edit at a time.

THE RULE THAT OVERRIDES EVERYTHING: you may only restate, reframe, reorder and sharpen what the uploaded resume already contains. You may not add a technology, a metric, a responsibility, an employer, a date, or an achievement that is not already there. Every edit you propose is checked mechanically against the original resume before the candidate sees it, and one that cannot be traced is thrown away rather than shown. A weaker line that survives that check is worth more than a stronger one that does not.

A FIGURE BELONGS TO ITS OWN ACHIEVEMENT. A number that appears somewhere in the resume does not license using it anywhere else. If 45% was the result of a caching change, it may only appear on the line about that caching change. Moving a real number onto different work is the fabrication that ends interviews, and it is checked.

HOW TO ANSWER:
- When the candidate asks for a change to the document, call edit_resume. Do not paste a rewritten bullet into the chat and ask them to copy it; the tool is how an edit reaches the page.
- When they ask a question, answer it in prose and call nothing.
- Keep prose short. Two or three sentences. The document is the deliverable, not the conversation.
- Say what you changed and why in the op's rationale, not in a paragraph repeating the diff.

USING THE TOOL:
- Send the smallest set of ops that achieves what was asked. One bullet rewritten is one replace on that bullet's text, not a replacement of the role.
- Paths are RFC 6901 JSON Pointers into the open document: /summary/text, /skills/1/items, /experience/0/bullets/2/text, /projects/0/bullets/1/text. Index from zero. Use "-" to append to an array.
- source_ids on every op: the ids of the facts the new wording comes from, such as E1.B2 or P1.B1. An op with no source_ids is an op that cannot be verified, and it will be refused.
- The following are refused outright and are not worth attempting: company, title, start_date and end_date on any experience block; adding, removing or reordering a role. Those are the first things a recruiter verifies, and the candidate cannot edit them through you. If they ask, tell them the employment history is fixed and offer to change the bullets instead.

WRITING STANDARD, when you rewrite a bullet:
- Shape: action + technical implementation + the engineering problem it solved + the result.
- Name the mechanism: the queue, the cache layer, the index, the auth flow, the retry strategy, the migration path.
- Banned openers: Helped, Assisted, Participated, Worked on, Responsible for, Spearheaded, Leveraged, Utilised.
- Keep a metric only if the uploaded resume already states it for that work. With no number, write a concrete qualitative outcome, and never write "significantly" or "drastically" to paper over the gap.
- Use the posting's exact terminology wherever it truthfully describes what the candidate did, including its spelling. This is about which word to use for something they did; it is never licence to claim something they did not.
- ASCII punctuation only. No em dashes, no en dashes, straight quotes only. They are the clearest signal that a document was machine-drafted.
- No subjective self-assessment: "excellent communicator" and "passionate about" carry no information and cost space.

If the candidate asks you to add something they did not do, say plainly that you cannot, name what the resume does support instead, and offer that.`,
};

/* ------------------------------------------------------------------ tool  */

/**
 * The tool, in OpenAI's function-calling shape.
 *
 * `strict` is deliberately off. `value` is genuinely any JSON - a string for
 * a bullet's text, an array for a skills group - and strict mode has no way
 * to say that without inflating the grammar into a union of every shape a
 * resume field can take. The arguments are validated with Zod on arrival and
 * then again, structurally, by `validateOps` against the real document, so
 * the schema below is a hint to the model rather than the enforcement.
 */
export const EDIT_RESUME_TOOL = {
  type: "function" as const,
  function: {
    name: "edit_resume",
    description:
      "Propose one or more edits to the open resume as JSON Pointer patch operations. " +
      "Each op is checked against the candidate's original resume before it is shown to " +
      "them; ops that cannot be traced to it, and ops that would change an employer, a " +
      "job title or an employment date, are refused.",
    parameters: {
      type: "object",
      properties: {
        ops: {
          type: "array",
          minItems: 1,
          description: "The edits, applied in order.",
          items: {
            type: "object",
            properties: {
              op: { type: "string", enum: ["replace", "add", "remove"] },
              path: {
                type: "string",
                description: "RFC 6901 JSON Pointer, e.g. /experience/0/bullets/2/text",
              },
              value: {
                description:
                  "The new value. Required for replace and add, omitted for remove.",
              },
              source_ids: {
                type: "array",
                items: { type: "string" },
                description: "Fact ids the new wording is drawn from, e.g. ['E1.B2'].",
              },
              rationale: { type: "string", description: "Why this specific edit." },
            },
            required: ["op", "path"],
            additionalProperties: false,
          },
        },
        rationale: {
          type: "string",
          description: "One sentence the candidate will read on the Accept button.",
        },
      },
      required: ["ops", "rationale"],
      additionalProperties: false,
    },
  },
};

export const EDIT_RESUME_TOOL_NAME = EDIT_RESUME_TOOL.function.name;

/**
 * What the model actually sent, validated.
 *
 * `value` is `unknown` and optional rather than defaulted: whether the key is
 * present is load-bearing. `validateOps` refuses a `replace` with no value
 * and a `remove` that carries one, and a default would erase that
 * distinction before the check could make it.
 */
export const PatchOpSchema = z.object({
  op: z.enum(["replace", "add", "remove"]),
  path: z.string().min(1),
  value: z.unknown().optional(),
  source_ids: z.array(z.string()).optional(),
  rationale: z.string().optional(),
});

export const EditResumeArgsSchema = z.object({
  ops: z.array(PatchOpSchema).min(1),
  rationale: z.string().default(""),
});

export type EditResumeArgs = z.infer<typeof EditResumeArgsSchema>;

/**
 * The document, the posting and the original resume, as one user-visible
 * context block.
 *
 * Stable content first and the conversation last, for the same reason
 * `structured()` orders its messages that way: the provider caches on the
 * leading tokens, and a context block that moves costs full price on every
 * turn.
 */
export function chatContext(input: {
  tailored: unknown;
  facts: unknown;
  job?: unknown;
  rawResumeText?: string;
}): string {
  const parts = [
    "<open_document>\n" + JSON.stringify(input.tailored, null, 2) + "\n</open_document>",
    "<resume_facts>\n" + JSON.stringify(input.facts, null, 2) + "\n</resume_facts>",
  ];
  if (input.job) {
    parts.push("<job_spec>\n" + JSON.stringify(input.job, null, 2) + "\n</job_spec>");
  }
  if (input.rawResumeText) {
    parts.push("<original_resume>\n" + input.rawResumeText + "\n</original_resume>");
  }
  return parts.join("\n\n");
}
