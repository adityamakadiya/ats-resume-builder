/**
 * Server-sent events, written once.
 *
 * Four routes stream, and four hand-rolled `ReadableStream`s would be four
 * places to get the same three things wrong: the encoding, the close, and the
 * disconnect.
 *
 * THE DISCONNECT IS THE REASON THIS FILE EXISTS. A closed tab does not stop a
 * model call. Next gives us `request.signal`, which aborts when the client
 * goes away, and unless that abort is chained into the OpenAI call and the
 * document-service fetch, a user who navigates away mid-tailor keeps a
 * gpt-5 generation running to completion and pays for all of it. So the
 * writer owns an `AbortController`, it is linked to the request, and every
 * route passes `writer.signal` down into anything that talks to a network.
 *
 * Writing to a stream whose reader is gone throws. Every enqueue is guarded
 * and the writer goes quietly inert instead, because by the time the client
 * has left there is nobody to report the failure to.
 */

const encoder = new TextEncoder();

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  // Nginx and friends buffer by default, which turns a live progress stream
  // into one delivery at the end, which is exactly the thing we are fixing.
  "X-Accel-Buffering": "no",
};

export class SseWriter<E> {
  #controller: ReadableStreamDefaultController<Uint8Array>;
  #abort: AbortController;
  #closed = false;
  /** Every event written, in order. Tests read this; production ignores it. */
  readonly written: E[] = [];

  constructor(
    controller: ReadableStreamDefaultController<Uint8Array>,
    abort: AbortController,
  ) {
    this.#controller = controller;
    this.#abort = abort;
  }

  /** Aborts when the client disconnects. Pass it to every network call. */
  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  get closed(): boolean {
    return this.#closed || this.#abort.signal.aborted;
  }

  /**
   * One JSON object, on one `data:` line.
   *
   * Single-line on purpose: a pretty-printed payload would be split across
   * several `data:` lines by the SSE grammar and rejoined with newlines by the
   * browser, which works but makes every client's parser guess. Returns false
   * when the client has already gone.
   */
  send(event: E): boolean {
    if (this.closed) return false;
    try {
      this.#controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      this.written.push(event);
      return true;
    } catch {
      this.#closed = true;
      return false;
    }
  }

  /** A comment line. Invisible to `onmessage`, enough to keep a proxy awake. */
  comment(text = ""): void {
    if (this.closed) return;
    try {
      this.#controller.enqueue(encoder.encode(`: ${text}\n\n`));
    } catch {
      this.#closed = true;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#controller.close();
    } catch {
      // Already closed by a cancel. Nothing to do and nobody to tell.
    }
  }
}

export type SseStreamOptions<E> = {
  /** `request.signal`. Omitting it means a disconnect costs real money. */
  signal?: AbortSignal;
  run: (writer: SseWriter<E>) => Promise<void>;
  /**
   * Turns a thrown error into the last event on the wire. Returning null
   * sends nothing, which is right when the handler already reported it.
   */
  onError?: (error: unknown) => E | null;
  /** Comment ping interval. 0 disables it. */
  heartbeatMs?: number;
  headers?: Record<string, string>;
};

/**
 * Run `run` and stream whatever it writes.
 *
 * The handler is started inside `start()` and deliberately not awaited, so the
 * `Response` is returned with headers flushed before the first step begins.
 * A route that awaited its own pipeline here would send nothing for forty
 * seconds and then send everything, which is a synchronous request wearing a
 * stream's content type.
 */
export function sseStream<E>(options: SseStreamOptions<E>): Response {
  const { signal, run, onError, heartbeatMs = 20_000 } = options;
  const abort = new AbortController();

  let onRequestAbort: (() => void) | null = null;
  const detach = () => {
    if (onRequestAbort && signal) signal.removeEventListener("abort", onRequestAbort);
    onRequestAbort = null;
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const writer = new SseWriter<E>(controller, abort);

      const heartbeat =
        heartbeatMs > 0 ? setInterval(() => writer.comment("ping"), heartbeatMs) : null;

      const shutdown = () => {
        if (heartbeat) clearInterval(heartbeat);
        detach();
        writer.close();
      };

      if (signal) {
        if (signal.aborted) abort.abort();
        else {
          onRequestAbort = () => {
            abort.abort();
            // Shut down now rather than waiting for `run` to unwind. Whatever
            // it is awaiting has been handed this signal and should reject,
            // but "should" is not a guarantee, and a stream left open because
            // one call ignored an abort holds a socket and a timer for the
            // request's whole timeout.
            shutdown();
          };
          signal.addEventListener("abort", onRequestAbort, { once: true });
        }
      }

      void (async () => {
        try {
          await run(writer);
        } catch (error) {
          // A disconnect surfaces as an AbortError from whatever call was in
          // flight. That is the expected shutdown path, not a failure to
          // report, and there is no longer a socket to report it on.
          if (!abort.signal.aborted) {
            const event = onError?.(error) ?? null;
            if (event) writer.send(event);
          }
        } finally {
          shutdown();
        }
      })();
    },
    cancel() {
      // The reader went away. Abort so the model call stops billing.
      abort.abort();
      detach();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { ...SSE_HEADERS, ...(options.headers ?? {}) },
  });
}

/**
 * Parse an SSE body back into events.
 *
 * Lives here rather than in a test helper because the wire format has exactly
 * one definition and a second one in a test file would eventually disagree
 * with this one and pass anyway.
 */
export async function readSseEvents<E>(response: Response): Promise<E[]> {
  const text = await response.text();
  const events: E[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    events.push(JSON.parse(payload) as E);
  }
  return events;
}
