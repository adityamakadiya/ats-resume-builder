/**
 * Tests for the print proxy.
 *
 * Two things matter here. The render headers have to survive the hop, because
 * "this came out at three pages" is the warning the editor shows and a
 * dropped header is a silent three-page resume. And the size cap has to fire
 * on this side of the boundary, where the error can be written by someone who
 * knows the user was trying to download a PDF.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetRateLimits } from "@/lib/sse";
import { unmigratedSupabase } from "@/lib/sse/test-support";

const supabaseState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/server", () => ({
  getServerClient: async () => supabaseState.client,
  getCurrentUser: async () => null,
}));

const { POST } = await import("./route");

function post(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/render", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

beforeEach(() => {
  resetRateLimits();
  supabaseState.client = unmigratedSupabase({ id: "user-1" });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/render", () => {
  it("streams the PDF back and forwards the render headers", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": 'attachment; filename="rohan-iyer.pdf"',
          "X-Render-Pages": "2",
          "X-Render-Fitted": "0",
          "X-Render-Warnings": "shrank the body font | dropped a project",
        },
      }),
    );

    const response = await POST(post({ html: "<html><body>hi</body></html>", filename: "cv" }));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-render-pages")).toBe("2");
    expect(response.headers.get("x-render-fitted")).toBe("0");
    expect(response.headers.get("x-render-warnings")).toContain("shrank the body font");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    );

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/render/html");
    // The preview's own HTML, forwarded unchanged. Rebuilding it here would
    // be the second renderer this design exists to avoid.
    expect(JSON.parse(String(init.body)).html).toBe("<html><body>hi</body></html>");
    expect(JSON.parse(String(init.body)).filename).toBe("cv.pdf");
  });

  it("refuses an oversized document before the document service has to", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const response = await POST(post({ html: "x".repeat(3_100_000) }));

    expect(response.status).toBe(413);
    expect((await response.json()).remedy).toMatch(/image/i);
    expect(spy).not.toHaveBeenCalled();
  });

  it("turns an unreachable service into a readable 502", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const response = await POST(post({ html: "<html></html>" }));

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.reason).toMatch(/could not be reached/i);
    expect(payload.remedy).toMatch(/still on screen/i);
  });

  it("passes the service's own 4xx through as a 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ detail: "The page could not be printed: unclosed tag." }, { status: 422 }),
    );

    const response = await POST(post({ html: "<html>" }));

    expect(response.status).toBe(422);
    expect((await response.json()).reason).toMatch(/unclosed tag/);
  });

  it("strips a filename that would break out of the header", async () => {
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }));

    await POST(post({ html: "<html></html>", filename: 'a"\r\nX-Evil: 1' }));

    const sent = JSON.parse(String((spy.mock.calls[0] as [string, RequestInit])[1].body));
    expect(sent.filename).not.toMatch(/["\r\n]/);
  });

  it("401s an expired session", async () => {
    supabaseState.client = unmigratedSupabase(null);
    expect((await POST(post({ html: "<html></html>" }))).status).toBe(401);
  });
});
