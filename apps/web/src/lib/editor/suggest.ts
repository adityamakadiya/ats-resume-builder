/** Client for POST /api/suggest. Never throws; the panel renders the reason. */

import type { JobSpec, ResumeFacts } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import { tailoredOf } from "./doc";

export type RewriteResult =
  | { ok: true; changed: true; text: string; sourceIds: string[]; note: string }
  | { ok: true; changed: false; note: string; refused?: boolean }
  | { ok: false; message: string };

export async function requestRewrite(input: {
  text: string;
  path: string;
  problems: string[];
  facts: ResumeFacts;
  job: JobSpec | null;
  doc: ResumeDoc;
  signal?: AbortSignal;
}): Promise<RewriteResult> {
  let response: Response;
  try {
    response = await fetch("/api/suggest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: input.text,
        path: input.path,
        problems: input.problems,
        facts: input.facts,
        job: input.job,
        tailored: tailoredOf(input.doc),
      }),
      signal: input.signal,
    });
  } catch {
    return { ok: false, message: "Could not reach the rewriter." };
  }

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, message: `The rewriter answered ${response.status}.` };
  }

  if (!response.ok || body.ok !== true) {
    const reason = typeof body.reason === "string" ? body.reason : `Answered ${response.status}.`;
    const remedy = typeof body.remedy === "string" ? ` ${body.remedy}` : "";
    return { ok: false, message: `${reason}${remedy}` };
  }

  if (body.changed !== true) {
    return {
      ok: true,
      changed: false,
      note: typeof body.note === "string" ? body.note : "Nothing to change here.",
      refused: body.refused === true,
    };
  }

  return {
    ok: true,
    changed: true,
    text: String(body.text ?? ""),
    sourceIds: Array.isArray(body.source_ids) ? (body.source_ids as string[]).map(String) : [],
    note: typeof body.note === "string" ? body.note : "",
  };
}
