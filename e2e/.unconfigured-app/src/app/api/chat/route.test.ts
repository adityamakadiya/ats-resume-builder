/**
 * Tests for the route that decides what the user is allowed to be offered.
 *
 * The first test is the one this whole product is for: a suggestion carrying
 * a metric the resume does not support must never reach the browser as a
 * `{t:"patch"}` with an Accept button. It has to arrive as `{t:"refused"}`
 * with the violation, or not at all. Everything else here is scaffolding
 * around that.
 *
 * The OpenAI SDK is stubbed with a class, for the reason
 * `lib/llm/structured.test.ts` records: the client is built with `new`, and
 * an arrow function is not a constructor.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readSseEvents, resetRateLimits, type ChatEvent } from "@/lib/sse";
import {
  FACTS,
  JOB,
  TAILORED,
  fabricatedMetric,
  truthReport,
  unmigratedSupabase,
} from "@/lib/sse/test-support";

const chatCreate = vi.hoisted(() => vi.fn());
const supabaseState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("openai", () => {
  class APIError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  class OpenAI {
    chat = { completions: { create: chatCreate } };
    static APIError = APIError;
  }
  return { default: OpenAI, APIError };
});

vi.mock("@/lib/supabase/server", () => ({
  getServerClient: async () => supabaseState.client,
  getCurrentUser: async () => null,
}));

const { POST } = await import("./route");

/* --------------------------------------------------------------- setup  */

type Op = { op: string; path: string; value?: unknown; source_ids?: string[] };

/**
 * A streamed turn: some prose, then one `edit_resume` call.
 *
 * The arguments are split across chunks on purpose. A tool call arrives as
 * fragments of a JSON string and a route that parsed each fragment would
 * work on every short call and fail on every long one.
 */
function turn(prose: string, ops: Op[], rationale = "Sharper wording.") {
  const args = JSON.stringify({ ops, rationale });
  const half = Math.ceil(args.length / 2);

  return async function* () {
    yield { choices: [{ delta: { content: prose } }] };
    yield {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                function: { name: "edit_resume", arguments: args.slice(0, half) },
              },
            ],
          },
        },
      ],
    };
    yield {
      choices: [
        { delta: { tool_calls: [{ index: 0, function: { arguments: args.slice(half) } }] } },
      ],
    };
  };
}

function stubTurn(prose: string, ops: Op[], rationale?: string) {
  const make = turn(prose, ops, rationale);
  chatCreate.mockImplementation(async () => make());
}

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(handler: FetchHandler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url, init as RequestInit));
  });
}

function post(body: Record<string, unknown>, signal?: AbortSignal) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tailored: TAILORED,
      facts: FACTS,
      job: JOB,
      rawResumeText: "Added a Redis cache in front of the pricing service.",
      messages: [{ role: "user", content: "Make the first bullet stronger." }],
      ...body,
    }),
    signal,
  });
}

const BULLET = "/experience/0/bullets/0/text";

beforeEach(() => {
  chatCreate.mockReset();
  resetRateLimits();
  process.env.OPENAI_API_KEY = "test-key";
  supabaseState.client = unmigratedSupabase({ id: "user-1" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------- tests  */

describe("POST /api/chat", () => {
  it("refuses a patch carrying a fabricated metric, and never emits it as a proposal", async () => {
    stubTurn("Here is a sharper version.", [
      {
        op: "replace",
        path: BULLET,
        value: "Cut checkout latency by 45%.",
        source_ids: ["E1.B1"],
      },
    ]);

    let call = 0;
    stubFetch((url) => {
      if (!url.includes("/api/guard")) throw new Error(`unexpected fetch: ${url}`);
      call += 1;
      // First call is the baseline on the untouched document; second is the
      // copy with the proposal applied.
      return Response.json(call === 1 ? truthReport() : truthReport([fabricatedMetric(BULLET)]));
    });

    const events = await readSseEvents<ChatEvent>(await POST(post({})));

    // The assertion the product exists for.
    expect(events.some((e) => e.t === "patch")).toBe(false);

    const refused = events.find((e): e is Extract<ChatEvent, { t: "refused" }> => e.t === "refused");
    expect(refused).toBeTruthy();
    expect(refused?.violation.code).toBe("UNSOURCED_METRIC");
    expect(refused?.violation.offending).toContain("45%");
    expect(refused?.reason).toMatch(/could not defend|cannot be traced/i);

    // The prose still streams. The chat keeps working; only the edit is held.
    expect(events.filter((e) => e.t === "token").length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ t: "done", proposed: [], refused: 1 });
  });

  it("offers a patch that the guard clears, with the score it will actually produce", async () => {
    stubTurn("Named the mechanism.", [
      {
        op: "replace",
        path: BULLET,
        value: "Cached pricing reads in Redis, cutting repeat lookups on the pricing service.",
        source_ids: ["E1.B1"],
      },
    ]);
    stubFetch((url) => {
      if (!url.includes("/api/guard")) throw new Error(`unexpected fetch: ${url}`);
      return Response.json(truthReport());
    });

    const events = await readSseEvents<ChatEvent>(await POST(post({})));

    const patch = events.find((e): e is Extract<ChatEvent, { t: "patch" }> => e.t === "patch");
    expect(patch).toBeTruthy();
    expect(patch?.ops).toHaveLength(1);
    expect(patch?.ops[0]?.path).toBe(BULLET);
    expect(typeof patch?.scoreDelta).toBe("number");
    expect(events.some((e) => e.t === "refused")).toBe(false);
    expect(events.at(-1)).toMatchObject({ t: "done", refused: 0 });
  });

  it("refuses an edit to an employer field outright, without consulting the guard", async () => {
    stubTurn("Retitled the role.", [
      { op: "replace", path: "/experience/0/title", value: "Staff Engineer", source_ids: ["E1"] },
    ]);
    const fetchSpy = stubFetch(() => {
      throw new Error("the guard must not be reached for a structurally refused op");
    });

    const events = await readSseEvents<ChatEvent>(await POST(post({})));

    const refused = events.find((e): e is Extract<ChatEvent, { t: "refused" }> => e.t === "refused");
    expect(refused?.violation.code).toBe("ALTERED_EMPLOYER_FACT");
    expect(refused?.reason).toMatch(/employer, a job title or an employment date/i);
    expect(events.some((e) => e.t === "patch")).toBe(false);
    // validateOps is a pure check and runs first, so a refused employment
    // edit costs nothing and cannot be talked past by a model.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to reorder or delete a role for the same reason", async () => {
    stubTurn("Dropped the older role.", [{ op: "remove", path: "/experience/0" }]);
    stubFetch(() => {
      throw new Error("the guard must not be reached");
    });

    const events = await readSseEvents<ChatEvent>(await POST(post({})));
    expect(events.some((e) => e.t === "patch")).toBe(false);
    expect(events.some((e) => e.t === "refused")).toBe(true);
  });

  it("withholds every edit when the guard service is down", async () => {
    stubTurn("A cleaner line.", [
      { op: "replace", path: BULLET, value: "Cached pricing reads in Redis.", source_ids: ["E1.B1"] },
    ]);
    stubFetch(() => {
      throw new Error("ECONNREFUSED");
    });

    const events = await readSseEvents<ChatEvent>(await POST(post({})));

    // Unverifiable is refused, not shown with a caveat. This is the branch
    // that decides whether the product means anything when it is degraded.
    expect(events.some((e) => e.t === "patch")).toBe(false);
    const refused = events.find((e): e is Extract<ChatEvent, { t: "refused" }> => e.t === "refused");
    expect(refused?.reason).toMatch(/verification service is unreachable/i);
    expect(refused?.violation.severity).toBe("error");
    expect(events.at(-1)).toMatchObject({ t: "done", refused: 1 });
  });

  it("does not let a pre-existing violation block an unrelated new edit", async () => {
    stubTurn("Tidied the summary.", [
      { op: "replace", path: "/summary/text", value: "Backend engineer on pricing.", source_ids: ["E1"] },
    ]);

    const existing = fabricatedMetric("Experience / Northwind Logistics / bullet 2");
    stubFetch((url) => {
      if (!url.includes("/api/guard")) throw new Error(`unexpected fetch: ${url}`);
      // The same violation in both reports: the document already had it, so
      // this proposal did not introduce it.
      return Response.json(truthReport([existing]));
    });

    const events = await readSseEvents<ChatEvent>(await POST(post({})));

    expect(events.some((e) => e.t === "patch")).toBe(true);
    expect(events.some((e) => e.t === "refused")).toBe(false);
  });

  it("brackets each verification as a real step", async () => {
    stubTurn("Fine.", [
      { op: "replace", path: BULLET, value: "Cached pricing reads in Redis.", source_ids: ["E1.B1"] },
    ]);
    stubFetch(() => Response.json(truthReport()));

    const events = await readSseEvents<ChatEvent>(await POST(post({})));
    const steps = events
      .filter((e): e is Extract<ChatEvent, { t: "step" }> => e.t === "step")
      .map((e) => `${e.step}:${e.state}`);

    expect(steps).toEqual(["guard:start", "guard:done"]);
  });

  it("aborts the model stream when the client disconnects", async () => {
    const client = new AbortController();
    const seen: AbortSignal[] = [];

    chatCreate.mockImplementation(
      async (_params: unknown, options: { signal?: AbortSignal }) => {
        if (options?.signal) seen.push(options.signal);
        return {
          async *[Symbol.asyncIterator]() {
            yield { choices: [{ delta: { content: "thinking" } }] };
            await new Promise((_resolve, reject) => {
              options?.signal?.addEventListener(
                "abort",
                () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
                { once: true },
              );
            });
          },
        };
      },
    );

    const response = await POST(post({}, client.signal));
    client.abort();
    const events = await readSseEvents<ChatEvent>(response);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.aborted).toBe(true);
    expect(events.some((e) => e.t === "done")).toBe(false);
  });

  it("answers a question without proposing anything", async () => {
    chatCreate.mockImplementation(async () => ({
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: "Your Redis bullet is the strongest one." } }] };
      },
    }));
    const fetchSpy = stubFetch(() => Response.json(truthReport()));

    const events = await readSseEvents<ChatEvent>(await POST(post({})));

    expect(events.filter((e) => e.t === "token")).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ t: "done", proposed: [], refused: 0 });
    // A turn with no proposal pays for no guard call.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("401s an expired session before calling the model", async () => {
    supabaseState.client = unmigratedSupabase(null);
    const response = await POST(post({}));
    expect(response.status).toBe(401);
    expect(chatCreate).not.toHaveBeenCalled();
  });
});
