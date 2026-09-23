/**
 * The single call shape every pipeline step uses.
 *
 * This is the OpenAI port of backend/src/atsresume/llm.py. The seam is kept
 * deliberately narrow: one function, a system prompt, a user message, a Zod
 * schema, and a step name that selects the model. Call sites do not choose
 * models, do not set temperatures, and do not parse JSON. When any of that
 * needs to change it changes here, once.
 *
 * Four things the previous implementation paid to learn, all of which carry
 * over:
 *
 * 1. **Strict schemas must be normalised by hand.** A schema generator marks a
 *    field with a default as optional; strict structured output wants every
 *    property listed in `required` and `additionalProperties: false` on every
 *    object. Handing over a raw generated schema fails in ways that read like
 *    model errors rather than schema errors.
 *
 * 2. **Absent means empty string, never null.** Nullable unions inflate the
 *    compiled grammar and buy nothing here. The schemas in @ats/core follow
 *    the same rule for the same reason.
 *
 * 3. **Refusals and truncation are not exceptions, they are outcomes.** Both
 *    arrive as ordinary successful responses with a different finish reason,
 *    and treating them as success is how an empty resume reaches a candidate.
 *
 * 4. **The prompt prefix must be byte-stable.** Caching keys on the prefix, so
 *    everything stable goes first and everything variable goes last. A stray
 *    space in a system prompt silently costs full price on every call. There
 *    is a test for this; do not edit prompts casually.
 */

import OpenAI from "openai";
import { z } from "zod";

import { configFor, costOf, type Step } from "./profiles";

export class LLMError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "no_key"
      | "refused"
      | "truncated"
      | "bad_json"
      | "schema_mismatch"
      | "rate_limited"
      | "upstream"
      | "timeout",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "LLMError";
  }
}

export type Usage = {
  input: number;
  cachedInput: number;
  output: number;
  reasoning: number;
  costUsd: number;
};

export type StructuredResult<T> = {
  value: T;
  usage: Usage;
  model: string;
  ms: number;
};

let client: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new LLMError(
      "OPENAI_API_KEY is not set. Add it to .env.local before running the pipeline.",
      "no_key",
    );
  }
  client ??= new OpenAI({
    apiKey,
    // The rewrite step is long. The SDK's default is far too short for it, and
    // a timeout mid-generation costs the whole call.
    timeout: Number(process.env.LLM_TIMEOUT_MS ?? 600_000),
    maxRetries: 0, // retried here instead, so the backoff is visible and logged
  });
  return client;
}

/* ------------------------------------------------------------------ schema */

type JsonSchema = Record<string, unknown>;

/**
 * Make a generated JSON Schema acceptable to strict structured output.
 *
 * Every object gets `additionalProperties: false` and a `required` array
 * naming all of its properties. Defaults stay in the schema as documentation
 * but stop being a licence for the model to omit the key, which is exactly the
 * behaviour we want: a missing field and an empty field are different bugs and
 * only one of them is detectable downstream.
 */
export function strictify(schema: JsonSchema): JsonSchema {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;

    const obj = node as Record<string, unknown>;
    if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
      obj.additionalProperties = false;
      obj.required = Object.keys(obj.properties as Record<string, unknown>);
    }
    // Strict mode rejects several annotation keywords outright. They are
    // documentation, so dropping them costs nothing and keeps the grammar
    // small enough to compile.
    for (const key of ["default", "format", "$schema", "examples"]) delete obj[key];

    Object.values(obj).forEach(walk);
  };

  const cloned = structuredClone(schema);
  walk(cloned);
  return cloned;
}

/* ------------------------------------------------------------------- call  */

export type StructuredOptions<T extends z.ZodTypeAny> = {
  /** Stable across calls. Goes first, so the cache prefix holds. */
  system: string;
  /** Varies per call. Goes last, for the same reason. */
  user: string;
  schema: T;
  /** Names the shape to the model and to the logs. */
  schemaName: string;
  step: Step;
  signal?: AbortSignal;
  /** Attempts on a retryable failure. The default is deliberately small. */
  attempts?: number;
};

export async function structured<T extends z.ZodTypeAny>(
  options: StructuredOptions<T>,
): Promise<StructuredResult<z.infer<T>>> {
  const { system, user, schema, schemaName, step, signal } = options;
  const attempts = options.attempts ?? 3;
  const config = configFor(step);
  const started = Date.now();

  const jsonSchema = strictify(
    z.toJSONSchema(schema, { target: "draft-2020-12", io: "output" }) as JsonSchema,
  );

  let lastError: LLMError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await getClient().responses.create(
        {
          model: config.model,
          reasoning: { effort: config.effort },
          max_output_tokens: config.maxOutputTokens,
          // System first, user last. See the note at the top of this file: the
          // cache keys on the prefix and this ordering is the whole reason it
          // ever hits.
          input: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
          text: {
            format: {
              type: "json_schema",
              name: schemaName,
              strict: true,
              schema: jsonSchema,
            },
          },
        },
        { signal },
      );

      const usage = readUsage(response, config.model);

      if (response.status === "incomplete") {
        const reason = response.incomplete_details?.reason;
        throw new LLMError(
          reason === "max_output_tokens"
            ? "The response hit the token ceiling before it finished. Try a shorter resume or job description."
            : `The response came back incomplete (${reason ?? "unknown"}).`,
          "truncated",
          false,
        );
      }

      const refusal = findRefusal(response);
      if (refusal) throw new LLMError(`The model declined this request: ${refusal}`, "refused");

      const raw = response.output_text;
      if (!raw || !raw.trim()) throw new LLMError("The model returned an empty response.", "bad_json");

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new LLMError("The model returned a response that was not valid JSON.", "bad_json");
      }

      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        throw new LLMError(`The response did not match ${schemaName}: ${issues}`, "schema_mismatch");
      }

      return { value: parsed.data, usage, model: config.model, ms: Date.now() - started };
    } catch (error) {
      lastError = normalise(error);
      if (!lastError.retryable || attempt === attempts) break;

      // Full jitter. A fixed backoff synchronises every client that got rate
      // limited at the same moment into hitting again at the same moment.
      const ceiling = Math.min(2 ** attempt * 500, 8_000);
      const delay = Math.random() * ceiling;
      console.warn(
        `[llm] ${step}/${schemaName} attempt ${attempt} failed (${lastError.kind}); retrying in ${Math.round(delay)}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new LLMError("The request failed for an unknown reason.", "upstream");
}

/* ---------------------------------------------------------------- helpers  */

function readUsage(response: { usage?: unknown }, model: string): Usage {
  const u = (response.usage ?? {}) as {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens_details?: { reasoning_tokens?: number };
  };

  const input = u.input_tokens ?? 0;
  const cachedInput = u.input_tokens_details?.cached_tokens ?? 0;
  const output = u.output_tokens ?? 0;
  const reasoning = u.output_tokens_details?.reasoning_tokens ?? 0;

  return {
    input,
    cachedInput,
    output,
    reasoning,
    costUsd: costOf(model, { input, cachedInput, output }),
  };
}

function findRefusal(response: { output?: unknown }): string | null {
  const output = response.output as Array<{ content?: Array<{ type?: string; refusal?: string }> }> | undefined;
  for (const item of output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "refusal" && part.refusal) return part.refusal;
    }
  }
  return null;
}

function normalise(error: unknown): LLMError {
  if (error instanceof LLMError) return error;

  if (error instanceof OpenAI.APIError) {
    const status = error.status ?? 0;
    if (status === 401 || status === 403) {
      return new LLMError("OPENAI_API_KEY was rejected.", "no_key");
    }
    if (status === 429) {
      return new LLMError("Rate limited by the API. Retrying.", "rate_limited", true);
    }
    if (status >= 500) {
      return new LLMError(`The API returned ${status}. Retrying.`, "upstream", true);
    }
    return new LLMError(`The API rejected the request: ${error.message}`, "upstream");
  }

  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new LLMError("The request was cancelled.", "timeout");
    }
    if (/timeout/i.test(error.message)) {
      return new LLMError("The request timed out. Retrying.", "timeout", true);
    }
    return new LLMError(error.message, "upstream", true);
  }

  return new LLMError("The request failed for an unknown reason.", "upstream");
}
