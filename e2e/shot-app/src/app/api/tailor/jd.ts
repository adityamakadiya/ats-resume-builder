/**
 * Getting the posting's text.
 *
 * The fetch itself stays in Python. It is a portal-by-portal affair - a
 * Greenhouse embed, a Lever board, a Workday tenant and a LinkedIn login wall
 * each need different handling - and that logic already exists there with its
 * own tests. This is the call, the timeout, and the translation of "the
 * portal refused" into something a candidate can act on.
 *
 * A blocked fetch is NOT an error in the usual sense. It is the expected
 * outcome for about a third of real postings, the user can fix it in ten
 * seconds by pasting, and the only unforgivable response is a spinner that
 * never resolves. So it comes back as a distinct result the route turns into
 * `needsJdPaste`, which the editor renders as a paste box rather than a
 * red banner.
 */

import { docServiceHeaders, docServiceUrl } from "@/lib/sse";

export type JdResult =
  | { kind: "ok"; text: string; sourceNote: string; portal: string }
  | { kind: "blocked"; reason: string; hint: string; portal: string }
  | { kind: "failed"; reason: string; hint: string };

const PASTE_HINT =
  "Open the posting in your browser, copy the full job description, and paste it here instead. " +
  "Sites that require a sign-in cannot be read from a server.";

export async function fetchJobDescription(
  url: string,
  signal?: AbortSignal,
): Promise<JdResult> {
  const form = new FormData();
  form.set("url", url);

  let response: Response;
  try {
    response = await fetch(`${docServiceUrl()}/api/jd/fetch`, {
      method: "POST",
      headers: docServiceHeaders(),
      body: form,
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      kind: "failed",
      reason: "The service that reads job postings could not be reached.",
      hint: `${PASTE_HINT} (${error instanceof Error ? error.message : "network error"})`,
    };
  }

  if (!response.ok) {
    const detail = await readDetail(response);
    return {
      kind: "failed",
      reason: detail || `The posting could not be read (HTTP ${response.status}).`,
      hint: PASTE_HINT,
    };
  }

  let payload: {
    text?: string;
    portal?: string;
    source_note?: string;
    blocked?: boolean;
    block_reason?: string;
  };
  try {
    payload = await response.json();
  } catch {
    return {
      kind: "failed",
      reason: "The posting service returned something that was not a job description.",
      hint: PASTE_HINT,
    };
  }

  if (payload.blocked) {
    return {
      kind: "blocked",
      reason: payload.block_reason || "That site blocked the request.",
      hint: PASTE_HINT,
      portal: payload.portal ?? "",
    };
  }

  const text = (payload.text ?? "").trim();
  if (!text) {
    // A 200 with nothing in it is a block that did not admit to being one:
    // a login wall that served an empty shell, or a JS-rendered page.
    return {
      kind: "blocked",
      reason: "That page returned no job description text.",
      hint: PASTE_HINT,
      portal: payload.portal ?? "",
    };
  }

  return {
    kind: "ok",
    text,
    sourceNote: payload.source_note || `fetched from ${payload.portal || "the posting URL"}`,
    portal: payload.portal ?? "",
  };
}

async function readDetail(response: Response): Promise<string> {
  try {
    const body = await response.json();
    const detail = (body as { detail?: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object") {
      return String((detail as { error?: unknown }).error ?? "");
    }
  } catch {
    // Not JSON. The status code is all we have.
  }
  return "";
}
