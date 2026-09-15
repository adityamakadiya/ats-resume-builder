import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const MODEL = "claude-opus-5";

let client: Anthropic | null = null;

export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local before running the pipeline.",
    );
  }
  client ??= new Anthropic();
  return client;
}

type StructuredOptions<T extends z.ZodType> = {
  system: string;
  user: string;
  schema: T;
  /** Raise for reasoning-heavy steps (gap analysis, rewriting); lower for extraction. */
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens?: number;
};

/**
 * One call shape for every pipeline step: a cached system prompt, a single user
 * message, and a Zod-validated response.
 *
 * Streaming rather than `messages.parse`: the rewrite step runs long enough at
 * these token budgets that the SDK refuses to issue it as a single blocking
 * request. `output_config.format` still constrains the model server-side; the
 * schema is re-validated here because a streamed response carries no
 * `parsed_output`.
 */
export async function structured<T extends z.ZodType>({
  system,
  user,
  schema,
  effort = "high",
  maxTokens = 32000,
}: StructuredOptions<T>): Promise<z.infer<T>> {
  const stream = getClient().messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    output_config: { effort, format: zodOutputFormat(schema) },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });

  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error(
      `The model declined this request (${response.stop_details?.category ?? "unspecified"}).`,
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      "The response hit the token ceiling before it finished. Try a shorter resume or job description.",
    );
  }

  const raw = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The model returned a response that was not valid JSON.");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `The model returned a response that did not match the expected schema: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")} ${i.message}`)
        .join("; ")}`,
    );
  }
  return result.data as z.infer<T>;
}
