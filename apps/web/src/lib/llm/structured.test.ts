/**
 * Tests for the one seam every model call goes through.
 *
 * Nothing here talks to OpenAI. The SDK is stubbed, because what needs proving
 * is our handling of the outcomes it reports, and three of those outcomes are
 * successful HTTP responses that mean failure: a refusal, a truncation, and a
 * payload that parses as JSON but is not the shape we asked for. Treating any
 * of the three as success is how an empty or invented resume reaches a
 * candidate, so each one gets a test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const create = vi.fn();

vi.mock("openai", () => {
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  // A class, not vi.fn returning an object: the client is built with `new`,
  // and an arrow function is not a constructor. The resulting TypeError was
  // swallowed by normalise() and surfaced as a retryable "upstream" error,
  // which is worth noting because it is the same shape a real outage takes.
  class OpenAI {
    responses = { create };
    static APIError = APIError;
  }
  return { default: OpenAI, APIError };
});

const { structured, strictify, LLMError } = await import("./structured");
const OpenAIStub = (await import("openai")).default as unknown as {
  APIError: new (status: number, message: string) => Error;
};

const Person = z.object({
  name: z.string(),
  years: z.number(),
});

function ok(payload: unknown, usage?: Record<string, unknown>) {
  return {
    status: "completed",
    output_text: JSON.stringify(payload),
    output: [{ content: [{ type: "output_text", text: JSON.stringify(payload) }] }],
    usage: usage ?? {
      input_tokens: 1000,
      output_tokens: 200,
      input_tokens_details: { cached_tokens: 800 },
      output_tokens_details: { reasoning_tokens: 50 },
    },
  };
}

const call = () =>
  structured({
    system: "You extract people.",
    user: "Rohan Iyer, six years.",
    schema: Person,
    schemaName: "Person",
    step: "extract",
    attempts: 3,
  });

beforeEach(() => {
  create.mockReset();
  process.env.OPENAI_API_KEY = "test-key";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------- schema  */

describe("strictify", () => {
  it("requires every property and forbids the rest", () => {
    const out = strictify({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "number", default: 0 } },
      required: ["a"],
    }) as Record<string, unknown>;

    expect(out.additionalProperties).toBe(false);
    // b had a default, which a schema generator reads as "optional". Strict
    // mode disagrees, and so do we: a missing field and an empty field are
    // different bugs and only one of them is visible downstream.
    expect(out.required).toEqual(["a", "b"]);
    expect((out.properties as Record<string, Record<string, unknown>>).b.default).toBeUndefined();
  });

  it("reaches into nested objects and arrays", () => {
    const out = strictify({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: { type: "object", properties: { x: { type: "string" } }, required: [] },
        },
      },
      required: ["items"],
    }) as Record<string, Record<string, Record<string, Record<string, unknown>>>>;

    expect(out.properties.items.items.additionalProperties).toBe(false);
    expect(out.properties.items.items.required).toEqual(["x"]);
  });

  it("does not mutate the schema it was given", () => {
    const input = { type: "object", properties: { a: { type: "string" } }, required: [] };
    const snapshot = JSON.stringify(input);
    strictify(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

/* ----------------------------------------------------------------- calls  */

describe("structured", () => {
  it("returns the parsed value with usage and cost", async () => {
    create.mockResolvedValueOnce(ok({ name: "Rohan Iyer", years: 6 }));

    const result = await call();

    expect(result.value).toEqual({ name: "Rohan Iyer", years: 6 });
    expect(result.usage.input).toBe(1000);
    expect(result.usage.cachedInput).toBe(800);
    expect(result.usage.reasoning).toBe(50);
    // Cached input bills at a fraction of fresh input, so a cost that ignores
    // the split overstates every run and makes the profile table useless.
    expect(result.usage.costUsd).toBeGreaterThan(0);
    expect(result.usage.costUsd).toBeLessThan(0.01);
  });

  it("puts the system prompt first, so the cache prefix can hold", async () => {
    create.mockResolvedValueOnce(ok({ name: "A", years: 1 }));
    await call();

    const input = create.mock.calls[0][0].input;
    expect(input[0].role).toBe("system");
    expect(input[1].role).toBe("user");
  });

  it("sends a strict json_schema format", async () => {
    create.mockResolvedValueOnce(ok({ name: "A", years: 1 }));
    await call();

    const format = create.mock.calls[0][0].text.format;
    expect(format.type).toBe("json_schema");
    expect(format.strict).toBe(true);
    expect(format.name).toBe("Person");
    expect(format.schema.additionalProperties).toBe(false);
  });

  it("treats a refusal as a failure, not as content", async () => {
    create.mockResolvedValueOnce({
      status: "completed",
      output_text: "",
      output: [{ content: [{ type: "refusal", refusal: "I cannot help with that." }] }],
      usage: {},
    });

    await expect(call()).rejects.toMatchObject({ kind: "refused" });
    expect(create).toHaveBeenCalledTimes(1); // a refusal is not retryable
  });

  it("treats truncation as a failure, with an actionable message", async () => {
    create.mockResolvedValueOnce({
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output_text: '{"name":"Roh',
      output: [],
      usage: {},
    });

    const error = await call().catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).toBe("truncated");
    // Half a resume that parses is worse than no resume, so the message has to
    // tell the candidate what to do rather than blame the model.
    expect(error.message).toMatch(/shorter resume|job description/i);
  });

  it("rejects a payload that is valid JSON but the wrong shape", async () => {
    create.mockResolvedValueOnce(ok({ name: "Rohan", years: "six" }));

    const error = await call().catch((e) => e);
    expect(error.kind).toBe("schema_mismatch");
    expect(error.message).toContain("years");
  });

  it("rejects a response that is not JSON at all", async () => {
    create.mockResolvedValueOnce({
      status: "completed",
      output_text: "Sure! Here is the person you asked for.",
      output: [],
      usage: {},
    });

    await expect(call()).rejects.toMatchObject({ kind: "bad_json" });
  });

  it("rejects an empty response", async () => {
    create.mockResolvedValueOnce({ status: "completed", output_text: "   ", output: [], usage: {} });
    await expect(call()).rejects.toMatchObject({ kind: "bad_json" });
  });

  it("retries a rate limit and succeeds", async () => {
    create
      .mockRejectedValueOnce(new OpenAIStub.APIError(429, "slow down"))
      .mockResolvedValueOnce(ok({ name: "Rohan Iyer", years: 6 }));

    const result = await call();

    expect(result.value.name).toBe("Rohan Iyer");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("retries a 500 and gives up after the attempt budget", async () => {
    create.mockRejectedValue(new OpenAIStub.APIError(503, "unavailable"));

    await expect(call()).rejects.toMatchObject({ kind: "upstream" });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("does not retry a bad key", async () => {
    create.mockRejectedValue(new OpenAIStub.APIError(401, "bad key"));

    await expect(call()).rejects.toMatchObject({ kind: "no_key" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("does not retry a schema mismatch", async () => {
    create.mockResolvedValue(ok({ name: "Rohan" }));

    await expect(call()).rejects.toMatchObject({ kind: "schema_mismatch" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when no key is configured, before any request", async () => {
    delete process.env.OPENAI_API_KEY;
    // The client is memoised, so a key removed after first use would not be
    // noticed. This asserts the check runs on the path, not once at startup.
    await expect(call()).rejects.toMatchObject({ kind: "no_key" });
  });
});
