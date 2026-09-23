/**
 * POST /api/resumes
 *
 * Creates the resume the user is about to edit.
 *
 * The template id is checked against the registry rather than trusted.
 * `resumes.template_id` is plain text in Postgres, so an unknown value would
 * be stored happily and then fail at render time, in the editor, after the
 * user has done the work. Better to refuse it here.
 */

import { NextResponse } from "next/server";
import { DEFAULT_TEMPLATE_ID, TEMPLATES } from "@ats/templates";
import { getServerClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refuse(reason: string, remedy: string, status: number) {
  return NextResponse.json({ ok: false, reason, remedy }, { status });
}

export async function POST(request: Request) {
  const supabase = await getServerClient();
  if (!supabase) {
    return refuse(
      "This deployment has no database configured.",
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart the server.",
      503
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return refuse(
      "Your session has expired.",
      "Sign in again. Your template choice will be remembered in the address bar.",
      401
    );
  }

  let body: { templateId?: unknown; title?: unknown; documentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return refuse(
      "The request body was not readable.",
      "Reload the page and try again.",
      400
    );
  }

  const templateId =
    typeof body.templateId === "string" ? body.templateId : DEFAULT_TEMPLATE_ID;

  if (!(templateId in TEMPLATES)) {
    return refuse(
      `There is no template called "${templateId}".`,
      `Choose one of: ${Object.keys(TEMPLATES).join(", ")}.`,
      400
    );
  }

  const title =
    typeof body.title === "string" && body.title.trim() !== ""
      ? body.title.trim().slice(0, 120)
      : "Untitled resume";

  /*
    The upload this resume is being created from.

    It used to be carried only in the query string, read to build the next
    URL, and then dropped. That looked harmless and was not: the truth guard
    checks every rewritten line against `documents.raw_text`, so a resume that
    cannot name its source document has no corpus to be checked against. The
    failure would have presented as the guard passing everything, which is the
    worst shape a bug in this product can take, because it looks like success.

    Not validated against the documents table here. The composite foreign key
    added in 0007 is `(source_document_id, user_id) references documents (id,
    user_id)`, so Postgres refuses a document belonging to anyone else, and a
    check in application code would be a second opinion that can drift from
    the one that is actually enforced.
  */
  const sourceDocumentId =
    typeof body.documentId === "string" && UUID.test(body.documentId)
      ? body.documentId
      : null;

  const { data, error } = await supabase
    .from("resumes")
    .insert({
      user_id: user.id,
      template_id: templateId,
      title,
      status: "draft",
      source_document_id: sourceDocumentId,
    })
    .select("id")
    .single();

  if (error) {
    // 23503 is a foreign key violation, which here means the document id does
    // not resolve for this user: deleted, or never theirs. Retrying will not
    // help, so say what to do instead of inviting another attempt.
    if (error.code === "23503") {
      return refuse(
        "That upload could not be found.",
        "It may have been deleted. Upload the resume again, or start from scratch.",
        422
      );
    }
    return refuse(
      "The resume could not be created.",
      `${error.message}. Nothing was saved, so it is safe to try again.`,
      502
    );
  }

  return NextResponse.json({ ok: true, id: data.id });
}
