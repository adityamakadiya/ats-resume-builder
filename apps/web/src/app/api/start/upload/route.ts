/**
 * POST /api/start/upload
 *
 * Intake only. This handler puts the bytes somewhere durable and records
 * that they exist; it does not parse, extract or score. Extraction is the
 * backend pipeline's job, and the `documents` row it needs is what this
 * creates.
 *
 * It is a route handler and not a browser call for the reason stated in
 * lib/supabase/client.ts: writes have invariants the database cannot state
 * on its own. Here, that the Storage object and the `documents` row either
 * both exist or neither does. If the insert fails, the object is removed
 * again, because an orphaned object is a bill nobody can trace and a GDPR
 * erasure that will silently miss.
 *
 * Client-side validation is repeated here in full. The browser check exists
 * so a 14MB file fails in 2ms; this one exists because the browser check can
 * be skipped entirely with one curl.
 */

import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";
import { validateResumeFile } from "@/components/upload/validate";
import { IngestError, factRows, parseResumeFile } from "@/lib/editor/ingest";

const BUCKET = "resumes";

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
      "Sign in again and re-upload. The file was not stored.",
      401
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return refuse(
      "The upload was cut off before it finished.",
      "Check your connection and try again.",
      400
    );
  }

  const candidate = form.get("file");
  if (!(candidate instanceof File)) {
    return refuse(
      "No file was attached to the request.",
      "Choose a PDF or DOCX and try again.",
      400
    );
  }

  const validation = validateResumeFile(candidate);
  if (!validation.ok) {
    return refuse(validation.reason, validation.remedy, 415);
  }

  const { file, kind } = validation;

  /*
    The path must start with the owner's uid. The Storage policies in
    0006_storage.sql key on (storage.foldername(name))[1], so a path that
    does not begin with the uid is rejected by Postgres, not by this code.
  */
  const documentId = crypto.randomUUID();
  const storagePath = `${user.id}/${documentId}.${kind}`;

  const upload = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    contentType: kind === "pdf" ? "application/pdf" : file.type || undefined,
    upsert: false,
  });

  if (upload.error) {
    const message = upload.error.message.toLowerCase();
    if (message.includes("bucket") && message.includes("not found")) {
      return refuse(
        "The storage bucket does not exist yet.",
        // `db reset` is the LOCAL command and it drops the database. Naming
        // it to someone pointed at a hosted project is at best wrong and at
        // worst destructive, so say which command belongs to which setup.
        "Apply the migrations first: `supabase db push` for a hosted project, " +
          "or `supabase db reset` against a local one. 0006_storage.sql is what " +
          "creates the resumes bucket.",
        500
      );
    }
    return refuse(
      "The file could not be stored.",
      `${upload.error.message}. Try again in a moment.`,
      502
    );
  }

  const insert = await supabase
    .from("documents")
    .insert({
      id: documentId,
      user_id: user.id,
      storage_path: storagePath,
      kind,
    })
    .select("id")
    .single();

  if (insert.error) {
    // Do not leave the object behind with no row pointing at it.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    return refuse(
      "The file uploaded but could not be recorded.",
      `${insert.error.message}. Nothing was kept, so it is safe to try again.`,
      502
    );
  }

  /*
    Read the file now, while the bytes are in hand.

    This used to be deferred on the grounds that intake should only record
    that a file exists. The cost of that was the editor opening on a sample
    document: the user uploads their resume, picks a template, and is shown
    somebody else's CV. Parsing here is what makes the next screen theirs.

    Parsing is allowed to fail without failing the upload. The file is stored
    and the row is written; a document service that is down is an operator
    problem, not a reason to make someone upload again. The response says
    which happened, and the editor reads `parsed` to decide whether it is
    showing a real document or asking for one.
  */
  let parsed: Awaited<ReturnType<typeof parseResumeFile>> | null = null;
  let parseProblem: { reason: string; remedy: string } | null = null;

  try {
    parsed = await parseResumeFile(file, request.signal);
  } catch (error) {
    if (error instanceof IngestError) {
      parseProblem = { reason: error.message, remedy: error.remedy };
    } else {
      parseProblem = {
        reason: "The resume was stored but could not be read.",
        remedy: "Open it in the editor and paste the text, or try uploading again.",
      };
    }
    console.warn("[upload] parse failed:", parseProblem.reason);
  }

  if (parsed) {
    // Text first. The truth guard reads documents.raw_text, so this column
    // is what every later verification is checked against.
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        raw_text: parsed.rawText,
        page_count: parsed.pageCount,
        style_json: parsed.style,
        notes: parsed.notes,
        // The nested extraction, for rebuilding the candidate's own
        // document. The flattened facts rows below cannot do that
        // without losing which bullets belong to which role.
        facts_json: parsed.facts,
      })
      .eq("id", documentId);

    if (updateError) {
      console.warn("[upload] could not store parsed text:", updateError.message);
    }

    // The ledger. origin 'document' marks these as things the uploaded file
    // actually says, which is the only kind of fact a rewrite may cite.
    const rows = factRows(parsed.facts, user.id, documentId);
    if (rows.length > 0) {
      const { error: factsError } = await supabase.from("facts").insert(rows);
      if (factsError) {
        console.warn("[upload] could not store facts:", factsError.message);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    documentId: insert.data.id,
    filename: file.name,
    parsed: Boolean(parsed),
    pageCount: parsed?.pageCount ?? 0,
    notes: parsed?.notes ?? [],
    parseProblem,
  });
}
