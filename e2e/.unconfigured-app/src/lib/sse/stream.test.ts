/**
 * Tests for the stream helper itself.
 *
 * The wire format and the disconnect are the two things four routes depend on
 * and neither is visible from a route's own test, so they are pinned here.
 */

import { describe, expect, it } from "vitest";

import { readSseEvents, sseStream } from "./stream";

type Event = { t: string; n?: number };

describe("sseStream", () => {
  it("writes one JSON object per data line", async () => {
    const response = sseStream<Event>({
      heartbeatMs: 0,
      run: async (write) => {
        write.send({ t: "a", n: 1 });
        write.send({ t: "b", n: 2 });
      },
    });

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.clone().text();

    // Not pretty-printed: a multi-line payload is legal SSE and a different
    // parse on the client, and every client would have to agree on it.
    expect(body).toBe('data: {"t":"a","n":1}\n\ndata: {"t":"b","n":2}\n\n');
    expect(await readSseEvents<Event>(response)).toEqual([
      { t: "a", n: 1 },
      { t: "b", n: 2 },
    ]);
  });

  it("turns a thrown error into a final event", async () => {
    const response = sseStream<Event>({
      heartbeatMs: 0,
      onError: () => ({ t: "error" }),
      run: async (write) => {
        write.send({ t: "a" });
        throw new Error("boom");
      },
    });

    expect(await readSseEvents<Event>(response)).toEqual([{ t: "a" }, { t: "error" }]);
  });

  it("aborts the work when the client disconnects, and closes", async () => {
    const client = new AbortController();
    let upstream: AbortSignal | null = null;

    const response = sseStream<Event>({
      heartbeatMs: 0,
      signal: client.signal,
      onError: () => ({ t: "error" }),
      run: async (write) => {
        write.send({ t: "a" });
        upstream = write.signal;
        // Stands in for the model call: it respects the signal, as the SDK
        // does, and rejects when the tab closes.
        await new Promise((_resolve, reject) => {
          write.signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
        write.send({ t: "never" });
      },
    });

    client.abort();
    const events = await readSseEvents<Event>(response);

    expect((upstream as unknown as AbortSignal).aborted).toBe(true);
    // No error event: a disconnect is not a failure to report, and there is
    // nobody left to report it to.
    expect(events).toEqual([{ t: "a" }]);
  });

  it("does not throw when a route keeps writing after a disconnect", async () => {
    const client = new AbortController();

    const response = sseStream<Event>({
      heartbeatMs: 0,
      signal: client.signal,
      run: async (write) => {
        write.send({ t: "a" });
        client.abort();
        expect(write.send({ t: "b" })).toBe(false);
        expect(write.closed).toBe(true);
      },
    });

    expect(await readSseEvents<Event>(response)).toEqual([{ t: "a" }]);
  });
});
