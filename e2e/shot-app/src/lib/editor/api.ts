/**
 * The editor's side of the streaming contract.
 *
 * Every route below is being built by another agent, so every call here has to
 * survive a 404 without taking the page down with it. The rule is the same in
 * each case: a missing route is a state the UI can name, not an exception. The
 * caller gets an `{t:"error"}` envelope carrying a hint that says the route is
 * not wired up yet, which the chat panel renders as a line of transcript.
 *
 * The transport is server-sent events over `fetch`, not `EventSource`, because
 * the requests are POSTs with a body and `EventSource` can only GET. The frame
 * parser below is the whole of SSE that this product uses: `data:` lines,
 * blank line terminates. Comments and `event:` names are skipped rather than
 * mishandled, so a heartbeat from the server cannot desynchronise the stream.
 */

import type { AtsReport, Op, TruthViolation } from "@ats/core";
import type {
  ErrorEvent as ServerErrorEvent,
  StepName,
  TailorEvent as ServerTailorEvent,
} from "@/lib/sse/events";

/* ---------------------------------------------------------- the envelope -- */

/**
 * The step names are the server's, imported rather than retyped. A step
 * renamed in `lib/sse/events.ts` should stop this file compiling, not go
 * quietly unrendered in the progress list.
 */
export type TailorStep = StepName;

export type TailorEvent =
  | { t: "step"; step: TailorStep; state: "start" | "done" }
  | { t: "token"; text: string }
  | { t: "guard"; passed: boolean; violations: TruthViolation[]; repairing: boolean }
  | { t: "score"; report: AtsReport }
  | { t: "patch"; ops: Op[]; rationale: string }
  | { t: "done"; resumeId: string; versionId: string }
  | ServerErrorEvent;

/** The tailoring run's own envelope, exactly as the route writes it. */
export type TailorRunEvent = ServerTailorEvent;

/** What each step is doing, so no wait is ever rendered as a bare spinner. */
export const STEP_LABEL: Record<TailorStep, string> = {
  parse: "Reading your resume into facts",
  jd: "Reading the posting",
  gaps: "Comparing your resume against the posting",
  tailor: "Rewriting, line by line, from your own facts",
  guard: "Checking every rewritten line traces back to a fact",
  score: "Recomputing the score",
};

/** The order the route emits them in, which is the order they are drawn in. */
export const TAILOR_STEPS: TailorStep[] = [
  "parse",
  "jd",
  "gaps",
  "tailor",
  "guard",
  "score",
];

/* ------------------------------------------------------------- parsing -- */

function parseEvent<E>(raw: string): E | null {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (typeof (payload as { t?: unknown }).t !== "string") return null;
  return payload as E;
}

/**
 * Splits an SSE byte stream into envelopes.
 *
 * Written as an async generator so the caller reads it with `for await`, which
 * means the loop that renders tokens is the same shape as the loop that reads
 * them and there is no callback soup in the component.
 */
export async function* readEventStream<E = TailorEvent>(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<E> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) return;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        const data = frame
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");

        if (data) {
          const event = parseEvent<E>(data);
          if (event) yield event;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/* ------------------------------------------------------------ requests -- */

const NOT_WIRED: ServerErrorEvent = {
  t: "error",
  message: "That route is not running yet.",
  hint: "Everything on this page that does not need the server still works. Your edits, the score and the preview are all computed here.",
};

/**
 * A refusal that arrived before the stream opened.
 *
 * The routes answer a bad request with `{ok:false, reason, remedy}` and a 4xx
 * rather than opening a stream to say so, and those two sentences are written
 * for the user. Reading them back is the difference between "Your session has
 * expired. Sign in again." and "The server answered 401".
 */
async function refusalOf(response: Response): Promise<ServerErrorEvent> {
  try {
    const payload = (await response.json()) as { reason?: string; remedy?: string };
    if (typeof payload.reason === "string" && payload.reason) {
      return { t: "error", message: payload.reason, hint: payload.remedy };
    }
  } catch {
    // Not JSON. Fall through to the status line.
  }
  return {
    t: "error",
    message: `The server answered ${response.status}.`,
    hint: response.statusText || undefined,
  };
}

async function* post<E>(
  url: string,
  body: unknown,
  signal?: AbortSignal,
): AsyncGenerator<E | ServerErrorEvent> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return;
    yield {
      t: "error",
      message: "Could not reach the server.",
      hint: (err as Error).message,
    };
    return;
  }

  if (response.status === 404 || response.status === 501) {
    yield NOT_WIRED;
    return;
  }
  if (!response.ok || !response.body) {
    yield await refusalOf(response);
    return;
  }

  yield* readEventStream<E>(response.body, signal);
}

/**
 * The tailoring run.
 *
 * `jdUrl` is allowed to come back refused with `needsJdPaste`, which is not a
 * failure: several of the biggest job boards serve a login wall to anything
 * without a session, and the remedy is for the user to paste the text. The
 * caller swaps the input and keeps what they typed.
 */
export type TailorRequest = {
  /** The resume row this run belongs to, so the version lands on it. */
  resumeId?: string;
  /** The document as it stands. Sent so the run tailors what is on screen. */
  resumeText?: string;
  jdText?: string;
  jdUrl?: string;
  templateId?: string;
};

export function streamTailor(
  input: TailorRequest,
  signal?: AbortSignal,
): AsyncGenerator<TailorRunEvent> {
  return post<TailorRunEvent>("/api/tailor", input, signal);
}

export function streamChat(
  input: { resumeId: string; versionId: string; message: string },
  signal?: AbortSignal,
): AsyncGenerator<TailorEvent> {
  return post<TailorEvent>("/api/chat", input, signal);
}

/* ---------------------------------------------------------- one-shot -- */

/**
 * The server's opinion of the score.
 *
 * The editor does not need it. `computeAtsReport` is deterministic and runs in
 * about a millisecond in the browser, which is why the number moves as you
 * type. This exists only so a version written to the database can be scored by
 * the same code on the server, and it returns null rather than throwing when
 * the route is absent.
 */
export async function fetchScore(resumeId: string): Promise<AtsReport | null> {
  try {
    const response = await fetch("/api/score", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ resumeId }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { report?: AtsReport };
    return data.report ?? null;
  } catch {
    return null;
  }
}

export type RenderResult =
  | { ok: true; url: string }
  | { ok: false; message: string; hint?: string };

/**
 * Asks for a PDF.
 *
 * Returns an object URL the caller is responsible for revoking. A download is
 * the one action where a silent failure is unacceptable: someone clicks it
 * because they are about to send the thing.
 */
export async function requestRender(input: {
  resumeId: string;
  templateId: string;
  doc: unknown;
}): Promise<RenderResult> {
  let response: Response;
  try {
    response = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch (err) {
    return { ok: false, message: "Could not reach the renderer.", hint: (err as Error).message };
  }

  if (response.status === 404 || response.status === 501) {
    return {
      ok: false,
      message: "The PDF renderer is not running yet.",
      hint: "Use your browser's print dialog on the preview in the meantime.",
    };
  }
  if (!response.ok) {
    return { ok: false, message: `The renderer answered ${response.status}.` };
  }

  const blob = await response.blob();
  return { ok: true, url: URL.createObjectURL(blob) };
}
