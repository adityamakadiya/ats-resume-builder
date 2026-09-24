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
import { describeDbError } from "@/lib/supabase/errors";

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
    user_id)`, so Postgres refuses an id that does not resolve, and a check in
    application code would be a second opinion that can drift from the one
    that is actually enforced.
  */
  const sourceDocumentId =
    typeof body.documentId === "string" && UUID.test(body.documentId)
      ? body.documentId
      : null;

  const { data, error } = await supabase
    .from("resumes")
    .insert({
      // No user_id. Migration 0009 defaults it to app.owner_id(), and a value
      // sent from here would be a second place for the owner to be decided.
      template_id: templateId,
      title,
      status: "draft",
      source_document_id: sourceDocumentId,
    })
    .select("id")
    .single();

  if (error) {
    const described = describeDbError(error, "Creating the resume");
    return refuse(described.reason, described.remedy, described.status);
  }

  return NextResponse.json({ ok: true, id: data.id });
}
