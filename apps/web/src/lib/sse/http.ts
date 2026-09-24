/**
 * The three things every route in this group does before it does its job.
 *
 * Rate limit, read a body, and refuse in a sentence. There used to be a
 * fourth, authenticate, and there is no longer anyone to authenticate. They
 * live beside the SSE writer rather than in `src/app/api/_shared` because a
 * route folder is a routing concern and this is not; and because two of the
 * four routes have to refuse *inside* an already-open stream, where a `Response`
 * is no longer available and the same words have to come back as an event.
 *
 * `refuse()` returns a plain web `Response`, not `NextResponse`. Nothing here
 * needs the extra surface, and the plain one is constructible in a unit test
 * without standing up the framework.
 *
 * The error shape is `{ok:false, reason, remedy}`, matching the routes this
 * app already has (`/api/resumes`, `/api/start/upload`). A second error shape
 * would mean a second branch in every client.
 */

import { z } from "zod";
import { OWNER_ID } from "@/lib/supabase/config";
import { getServerClient, type ServerClient } from "@/lib/supabase/server";
import { take, type BucketName } from "./rate-limit";

export function refuse(reason: string, remedy: string, status: number, headers?: HeadersInit) {
  return Response.json({ ok: false, reason, remedy }, { status, headers });
}

export type Gate =
  /** `userId` is always OWNER_ID. It keys the rate limiter and the cache. */
  | { ok: true; userId: string; supabase: ServerClient }
  | { ok: false; response: Response };

/**
 * Not hammering, and pointed at a database that exists.
 *
 * It no longer asks who is calling, because there is no longer an answer:
 * see the note at the top of lib/supabase/client.ts. The rate limit stays,
 * and it stays because it guards model spend rather than a tenant boundary.
 * With one owner there is one bucket, keyed on OWNER_ID, which is the honest
 * key now that it is not keyed on a session.
 */
export async function gate(bucket: BucketName): Promise<Gate> {
  const supabase = await getServerClient();
  if (!supabase) {
    return {
      ok: false,
      response: refuse(
        "This deployment has no database configured.",
        "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart the server.",
        503,
      ),
    };
  }

  const limit = take(bucket, OWNER_ID);
  if (!limit.ok) {
    return {
      ok: false,
      response: refuse(
        "That is more requests than this app is allowed in a short window.",
        `Wait ${limit.retryAfterSeconds} seconds and try again.`,
        429,
        { "Retry-After": String(limit.retryAfterSeconds) },
      ),
    };
  }

  return { ok: true, userId: OWNER_ID, supabase };
}

export type BodyResult<T> = { ok: true; value: T } | { ok: false; response: Response };

/**
 * Read and validate a JSON body.
 *
 * A body that does not parse and a body of the wrong shape are both the
 * caller's problem, so both are 400s that say which field, never a 500 with
 * a Zod dump.
 */
export async function readJsonBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
  maxBytes = 2_000_000,
): Promise<BodyResult<z.infer<S>>> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, response: tooLarge(declared, maxBytes) };
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return {
      ok: false,
      response: refuse(
        "The request body was cut off before it finished.",
        "Check your connection and try again.",
        400,
      ),
    };
  }

  // Re-checked after reading: content-length is a claim, not a measurement,
  // and a chunked request does not send one at all.
  const size = Buffer.byteLength(raw, "utf8");
  if (size > maxBytes) return { ok: false, response: tooLarge(size, maxBytes) };

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      response: refuse(
        "The request body was not valid JSON.",
        "This is a bug in the page, not in what you typed. Reload and try again.",
        400,
      ),
    };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: refuse(
        `The request body was not the expected shape: ${issues}.`,
        "Reload the page so the editor and the server agree on the document.",
        400,
      ),
    };
  }

  return { ok: true, value: parsed.data };
}

export function tooLarge(size: number, maxBytes: number) {
  return refuse(
    `That payload is ${(size / 1_000_000).toFixed(1)}MB, over the ${(maxBytes / 1_000_000).toFixed(0)}MB limit.`,
    "Shorten the document, or remove embedded images from the template.",
    413,
  );
}

/** The document service. Internal, never routed from the public internet. */
export function docServiceUrl(): string {
  return process.env.DOCSVC_URL ?? process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";
}

export function docServiceHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...(extra ?? {}),
    ...(process.env.DOCSVC_TOKEN ? { Authorization: `Bearer ${process.env.DOCSVC_TOKEN}` } : {}),
  };
}
