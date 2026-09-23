/**
 * POST /api/render
 *
 * The browser sends the serialized HTML of the live preview, and gets back a
 * PDF of exactly that.
 *
 * WHY THE CLIENT SENDS THE HTML. The alternative is sending the document
 * model and having the server rebuild the page from it, which means two
 * renderers - React in the preview, something else in Python - and two
 * renderers means the download eventually stops matching the screen. Usually
 * in a way nobody notices until a recruiter opens it. Printing the very bytes
 * the user was looking at is the only version of this that cannot drift.
 *
 * This route is a proxy and deliberately nothing more. It authenticates, caps
 * the body, forwards, and streams the PDF back without buffering it, so a
 * three-page render does not sit in this process's heap on its way through.
 *
 * The cap is 3MB against the document service's 4MB. Failing on our side of
 * the boundary is failing where the error message can be written by someone
 * who knows what the user was doing: FastAPI's answer to an oversized field
 * is a 422 full of Pydantic, which is true and useless.
 */

import { z } from "zod";

import { docServiceHeaders, docServiceUrl, gate, readJsonBody, refuse } from "@/lib/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Headless Chrome cold-starting on the Python side is the slow part. */
export const maxDuration = 120;

/** Under the document service's 4_000_000, so the clearer error wins. */
const MAX_HTML_BYTES = 3_000_000;

const BodySchema = z.object({
  html: z.string().min(1, "the preview sent an empty document"),
  filename: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  const entry = await gate("render");
  if (!entry.ok) return entry.response;

  // Slightly above the HTML cap: the JSON envelope and the filename are also
  // bytes, and rejecting at exactly the HTML limit would refuse a document
  // that is in fact inside it.
  const body = await readJsonBody(request, BodySchema, MAX_HTML_BYTES + 200_000);
  if (!body.ok) return body.response;

  const { html } = body.value;
  const size = Buffer.byteLength(html, "utf8");
  if (size > MAX_HTML_BYTES) {
    return refuse(
      `That page is ${(size / 1_000_000).toFixed(1)}MB of HTML, over the ${(MAX_HTML_BYTES / 1_000_000).toFixed(0)}MB limit.`,
      "This is almost always an embedded image. Use a photo-free template, or link the image instead of inlining it.",
      413,
    );
  }

  const filename = safeFilename(body.value.filename);

  let upstream: Response;
  try {
    upstream = await fetch(`${docServiceUrl()}/api/render/html`, {
      method: "POST",
      headers: docServiceHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ html, filename }),
      // A closed tab must not leave a headless browser rendering.
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal.aborted) {
      // The user navigated away mid-download. Nothing to report to.
      return new Response(null, { status: 499 });
    }
    return refuse(
      "The PDF service could not be reached.",
      `Your document is safe and still on screen. Try the download again in a moment. (${
        error instanceof Error ? error.message : "network error"
      })`,
      502,
    );
  }

  if (!upstream.ok || !upstream.body) {
    const detail = await readDetail(upstream);
    // The service's own 4xx are the user's to fix; its 5xx are ours. Either
    // way it comes back as a sentence, never a proxied stack trace.
    const status = upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
    return refuse(
      detail || `The PDF could not be produced (HTTP ${upstream.status}).`,
      "Your document is safe and still on screen. Try again, or switch template and retry.",
      status,
    );
  }

  /*
    Forwarded verbatim, because the editor shows them:

      X-Render-Pages    what it actually came out at
      X-Render-Fitted   whether it fitted the page target, or overflowed
      X-Render-Warnings what the renderer had to compromise on

    A resume that silently became three pages is the failure this header set
    exists to make loud, so dropping them here would be dropping the warning.
  */
  const headers = new Headers({
    "Content-Type": "application/pdf",
    "Content-Disposition":
      upstream.headers.get("content-disposition") ?? `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
  });

  for (const name of ["X-Render-Pages", "X-Render-Fitted", "X-Render-Warnings", "X-Render-Ms"]) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }

  // Streamed through, not buffered. This process never holds the PDF.
  return new Response(upstream.body, { status: 200, headers });
}

/**
 * A filename that cannot escape the Content-Disposition header.
 *
 * The value arrives from the browser and is echoed into a header, so a
 * newline or a quote in it is a header-injection bug. Stripped rather than
 * rejected: the user asked for a PDF, not a lecture about their job title
 * containing a slash.
 */
function safeFilename(raw?: string): string {
  const cleaned = (raw ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  if (!cleaned) return "resume.pdf";
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned : `${cleaned}.pdf`;
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
