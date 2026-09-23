/**
 * Tests for the long route.
 *
 * Nothing here reaches OpenAI, the document service or Postgres. The SDK is
 * stubbed with a class, as `lib/llm/structured.test.ts` explains: the client
 * is built with `new`, and an arrow function is not a constructor, so a
 * `vi.fn()` returning an object produces a TypeError that `normalise()`
 * swallows into a retryable "upstream" error and the test passes for the
 * wrong reason.
 *
 * What is actually being pinned:
 *
 *   - The envelope. A client switches on `t`, and the order of the step
 *     events is the progress bar. Both are contract.
 *   - A blocked posting URL comes back as `needsJdPaste`, because that is a
 *     third of real postings and the fix takes the user ten seconds.
 *   - A guard that cannot be reached FAILS THE RUN. Not a pass with a
 *     warning, not a document with the tick missing.
 *   - A disconnect aborts the model call, because a closed tab must not keep
 *     spending.
 *   - A database with no schema still yields a result, with persisted:false.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setCacheStore } from "@/lib/pipeline/cache";
import { readSseEvents, resetRateLimits, type TailorEvent } from "@/lib/sse";
import { modelJson, truthReport, unmigratedSupabase } from "@/lib/sse/test-support";

const create = vi.hoisted(() => vi.fn());
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
    responses = { create };
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

/**
 * Every pipeline step returns the minimum its schema accepts.
 *
 * Dispatched on the schema name the route asked for rather than on a call
 * counter: the steps are cached by content, so "the fourth call" is not a
 * stable way to name the rewrite.
 */
function stubPipeline(tailored?: unknown) {
  create.mockImplementation(async (params: { text: { format: { name: string } } }) => {
    const schema = params.text.format.name;
    // Every schema in @ats/core defaults every field, so `{}` is a valid
    // answer for the three steps that are not being asserted on.
    return modelJson(schema === "TailoredResume" ? (tailored ?? TAILORED_DRAFT) : {});
  });
}

const TAILORED_DRAFT = {
  headline: "Senior Backend Engineer",
  summary: { text: "Backend engineer on pricing and reporting.", source_ids: ["E1"] },
  experience: [
    {
      source_id: "E1",
      company: "Northwind Logistics",
      title: "Senior Backend Engineer",
      start_date: "Jun 2021",
      end_date: "Present",
      bullets: [
        { text: "Put a Redis cache in front of pricing.", source_ids: ["E1.B1"], keywords: [] },
      ],
    },
  ],
  section_order: ["summary", "experience"],
};

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function stubFetch(handler: FetchHandler) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url, init as RequestInit));
  });
}

const guardPasses: FetchHandler = (url) => {
  if (url.includes("/api/guard")) return Response.json(truthReport());
  throw new Error(`unexpected fetch: ${url}`);
};

/** A fresh resume text per test: the step cache is keyed on content. */
function resume(tag: string) {
  return `Rohan Iyer\nSenior Backend Engineer at Northwind Logistics (${tag})\n- Added a Redis cache in front of the pricing service.`;
}

function post(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/tailor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

/**
 * A cache per test.
 *
 * The step cache is process-local and content-addressed, so without this the
 * second test's rewrite is served from the first test's answer and the call
 * counts below measure nothing.
 */
function freshCache() {
  const entries = new Map<string, unknown>();
  return {
    async get(key: string) {
      return entries.get(key) ?? null;
    },
    async set(key: string, value: unknown) {
      entries.set(key, value);
    },
  };
}

beforeEach(() => {
  create.mockReset();
  setCacheStore(freshCache());
  resetRateLimits();
  process.env.OPENAI_API_KEY = "test-key";
  supabaseState.client = unmigratedSupabase({ id: "user-1" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ---------------------------------------------------------------- tests  */

describe("POST /api/tailor", () => {
  it("streams the whole envelope, in the order the work happens", async () => {
    stubPipeline();
    stubFetch(guardPasses);

    const response = await POST(
      post({ resumeText: resume("full-run"), jdText: "Backend engineer. Python, Postgres." }),
    );

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = await readSseEvents<TailorEvent>(response);

    const steps = events
      .filter((e): e is Extract<TailorEvent, { t: "step" }> => e.t === "step")
      .map((e) => `${e.step}:${e.state}`);

    expect(steps).toEqual([
      "parse:start",
      "parse:done",
      "jd:start",
      "jd:done",
      "gaps:start",
      "gaps:done",
      "tailor:start",
      "tailor:done",
      "guard:start",
      "guard:done",
      "score:start",
      "score:done",
    ]);

    const guard = events.find((e) => e.t === "guard");
    expect(guard).toMatchObject({ t: "guard", passed: true, repairing: false });

    const score = events.find((e) => e.t === "score");
    expect(score && "report" in score && typeof score.report.overall).toBe("number");

    const done = events.at(-1);
    expect(done?.t).toBe("done");
    if (done?.t !== "done") throw new Error("unreachable");
    expect(done.tailored.headline).toBe("Senior Backend Engineer");
    expect(done.truth.passed).toBe(true);
    expect(done.gaps).toBeTruthy();
    expect(done.resumeId).toBeTruthy();
    expect(done.versionId).toBeTruthy();
    // No schema applied, so the write failed and the run still completed.
    expect(done.persisted).toBe(false);

    expect(events.some((e) => e.t === "error")).toBe(false);
    // No invented tokens: this pipeline has no token stream to forward.
    expect(events.some((e) => e.t === "token")).toBe(false);
  });

  it("tells the user to paste when the posting's site blocks the fetch", async () => {
    stubPipeline();
    stubFetch((url) => {
      if (url.includes("/api/jd/fetch")) {
        return Response.json({
          text: "",
          portal: "linkedin",
          method: "http",
          source_note: "",
          blocked: true,
          block_reason: "LinkedIn requires a sign-in to read this posting.",
        });
      }
      if (url.includes("/api/guard")) return Response.json(truthReport());
      throw new Error(`unexpected fetch: ${url}`);
    });

    const response = await POST(
      post({ resumeText: resume("blocked"), jdUrl: "https://linkedin.com/jobs/view/1" }),
    );
    const events = await readSseEvents<TailorEvent>(response);

    const error = events.find((e) => e.t === "error");
    expect(error).toMatchObject({ t: "error", needsJdPaste: true });
    expect(error && "message" in error && error.message).toMatch(/sign-in/i);
    // The run stops there: no document, no score, nothing half-finished.
    expect(events.some((e) => e.t === "done")).toBe(false);
    expect(events.some((e) => e.t === "score")).toBe(false);
  });

  it("does not turn an unreachable guard into a pass", async () => {
    stubPipeline();
    stubFetch((url) => {
      if (url.includes("/api/guard")) return new Response("upstream down", { status: 503 });
      throw new Error(`unexpected fetch: ${url}`);
    });

    const response = await POST(
      post({ resumeText: resume("guard-down"), jdText: "Backend engineer. Python." }),
    );
    const events = await readSseEvents<TailorEvent>(response);

    const error = events.find((e) => e.t === "error");
    expect(error).toBeTruthy();
    expect(error && "message" in error && error.message).toMatch(/not been checked|could not be reached/i);

    // The three ways this could go wrong, each asserted separately, because
    // each one on its own would ship an unverified resume as a verified one.
    expect(events.some((e) => e.t === "done")).toBe(false);
    expect(events.some((e) => e.t === "score")).toBe(false);
    expect(events.some((e) => e.t === "guard" && e.passed)).toBe(false);
  });

  it("aborts the model call when the client disconnects", async () => {
    const client = new AbortController();
    const seen: AbortSignal[] = [];

    create.mockImplementation((_params: unknown, options: { signal?: AbortSignal }) => {
      if (options?.signal) seen.push(options.signal);
      // The SDK rejects on abort. Standing in for that is the whole point:
      // a stub that resolved anyway would prove nothing about the chain.
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("Request was aborted."), { name: "AbortError" })),
          { once: true },
        );
      });
    });
    stubFetch(guardPasses);

    const response = await POST(
      post({ resumeText: resume("disconnect"), jdText: "Backend engineer." }, client.signal),
    );

    client.abort();
    const events = await readSseEvents<TailorEvent>(response);

    expect(seen).toHaveLength(1);
    expect(seen[0]?.aborted).toBe(true);
    // Nothing is reported after a disconnect: there is no socket to report
    // on, and an error event here would be written to a closed tab.
    expect(events.some((e) => e.t === "error")).toBe(false);
    expect(events.some((e) => e.t === "done")).toBe(false);
  });

  it("reports the guard's violations and the repair, when the first draft fails", async () => {
    stubPipeline();
    let guardCalls = 0;
    stubFetch((url) => {
      if (!url.includes("/api/guard")) throw new Error(`unexpected fetch: ${url}`);
      guardCalls += 1;
      if (guardCalls === 1) {
        return Response.json(
          truthReport([
            {
              code: "UNSOURCED_METRIC",
              severity: "error",
              location: "Experience / Northwind Logistics / bullet 1",
              detail: "The figure 45% does not appear in the uploaded resume.",
              offending: "Cut pricing latency by 45%.",
            },
          ]),
        );
      }
      return Response.json(truthReport());
    });

    const response = await POST(
      post({ resumeText: resume("repair"), jdText: "Backend engineer. Redis." }),
    );
    const events = await readSseEvents<TailorEvent>(response);

    const guards = events.filter((e): e is Extract<TailorEvent, { t: "guard" }> => e.t === "guard");
    expect(guards[0]).toMatchObject({ repairing: true, passed: false });
    expect(guards.at(-1)).toMatchObject({ repairing: false, passed: true });

    // One repair, not a loop: five model calls total (four steps plus the
    // single rewrite), and every step bracket still closes.
    expect(create).toHaveBeenCalledTimes(5);
    const steps = events
      .filter((e): e is Extract<TailorEvent, { t: "step" }> => e.t === "step")
      .map((e) => `${e.step}:${e.state}`);
    expect(steps.filter((s) => s === "tailor:start")).toHaveLength(2);
    expect(steps.filter((s) => s === "tailor:done")).toHaveLength(2);
    expect(steps.filter((s) => s === "guard:start")).toHaveLength(2);
    expect(steps.filter((s) => s === "guard:done")).toHaveLength(2);
  });

  it("refuses a request with no resume, before opening a stream", async () => {
    const response = await POST(post({ jdText: "Backend engineer." }));

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).remedy).toMatch(/upload|paste/i);
  });

  it("refuses a request with no posting", async () => {
    const response = await POST(post({ resumeText: resume("no-jd") }));
    expect(response.status).toBe(400);
    expect((await response.json()).reason).toMatch(/job description/i);
  });

  it("401s an expired session", async () => {
    supabaseState.client = unmigratedSupabase(null);
    const response = await POST(post({ resumeText: resume("anon"), jdText: "x" }));
    expect(response.status).toBe(401);
  });
});
