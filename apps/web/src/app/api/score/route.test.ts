/**
 * Tests for the route on the typing path.
 *
 * The one that matters is "no network": this runs on every keystroke, so a
 * fetch sneaking into the scorer would turn a 2ms call into a 200ms one and
 * make the editor feel broken on a train.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/sse";
import { FACTS, JOB, TAILORED, unmigratedSupabase } from "@/lib/sse/test-support";

const supabaseState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  getServerClient: async () => supabaseState.client,
  getCurrentUser: async () => null,
}));

const { POST } = await import("./route");

function post(body: unknown) {
  return new Request("http://localhost/api/score", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resetRateLimits();
  supabaseState.client = unmigratedSupabase({ id: "user-1" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/score", () => {
  it("scores without touching the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await POST(post({ tailored: TAILORED, facts: FACTS, job: JOB }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(typeof payload.report.overall).toBe("number");
    expect(payload.report.matched_keywords).toContain("PostgreSQL");
    // No model, no document service, no database read. The auth check is
    // mocked out precisely so that anything left would show up here.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is deterministic, which is what lets the editor re-score on a keystroke", async () => {
    const first = await (await POST(post({ tailored: TAILORED, facts: FACTS, job: JOB }))).json();
    const second = await (await POST(post({ tailored: TAILORED, facts: FACTS, job: JOB }))).json();
    expect(second.report).toEqual(first.report);
  });

  it("refuses an unauthenticated caller with 401", async () => {
    supabaseState.client = unmigratedSupabase(null);

    const response = await POST(post({ tailored: TAILORED, facts: FACTS, job: JOB }));

    expect(response.status).toBe(401);
    expect((await response.json()).ok).toBe(false);
  });

  it("answers a malformed body with a readable 400, not a 500", async () => {
    const response = await POST(post({ tailored: { headline: 7 }, facts: FACTS, job: JOB }));

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload.reason).toMatch(/expected shape/i);
    expect(payload.remedy).toBeTruthy();
  });

  it("rate limits a caller that will not stop", async () => {
    let last = await POST(post({ tailored: TAILORED, facts: FACTS, job: JOB }));
    for (let i = 0; i < 200 && last.status === 200; i += 1) {
      last = await POST(post({ tailored: TAILORED, facts: FACTS, job: JOB }));
    }
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBeTruthy();
  });
});
