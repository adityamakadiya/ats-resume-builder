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
import { OWNER_ID } from "@/lib/supabase/config";
import { getServerClient } from "@/lib/supabase/server";
import { validateResumeFile } from "@/components/upload/validate";
import { IngestError, factRows, parseResumeFile } from "@/lib/editor/ingest";
import { describeDbError } from "@/lib/supabase/errors";

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
    Two segments, still. The policies in 0006_storage.sql that keyed the
    first one on the caller's uid were replaced in 0009 by a single rule over
    the whole bucket, so nothing rejects a flat path any more. The prefix is
    kept because the objects are easier to find, list and expire under one,
    and OWNER_ID is what the uid used to be.
  */
  const documentId = crypto.randomUUID();
  const storagePath = `${OWNER_ID}/${documentId}.${kind}`;

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
    /*
      Storage has its own policies, and after 0009 removed authentication
      the RLS refusal here means the same thing it means on a table: the
      migration has not been run. The raw message talks about security,
      which sends the reader looking for a permissions setting that does
      not exist.
    */
    const described = describeDbError(
      { code: /row-level security/i.test(upload.error.message) ? "42501" : "", message: upload.error.message },
      "Storing the file"
    );
    return refuse(described.reason, described.remedy, described.status);
  }

  const insert = await supabase
    .from("documents")
    .insert({
      id: documentId,
      // No user_id: migration 0009 defaults it to app.owner_id().
      storage_path: storagePath,
      kind,
    })
    .select("id")
    .single();

  if (insert.error) {
    // Do not leave the object behind with no row pointing at it.
    await supabase.storage.from(BUCKET).remove([storagePath]);
    const described = describeDbError(insert.error, "Recording the upload");
    return refuse(described.reason, described.remedy, described.status
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
    /*
      Two writes, not one, and the split is deliberate.

      The first carries raw_text, which the truth guard checks every
      rewritten line against and which therefore matters more than anything
      else here. The second carries facts_json, which migration 0008 adds.

      Combined, a database one migration behind fails the whole statement on
      the unknown column and loses the text as well, which is how a missing
      nicety turns into a resume that cannot be verified. Postgres has no
      partial update: one bad column rejects the row. So the important
      column goes on its own.
    */
    const { error: textError } = await supabase
      .from("documents")
      .update({
        raw_text: parsed.rawText,
        page_count: parsed.pageCount,
        style_json: parsed.style,
        notes: parsed.notes,
      })
      .eq("id", documentId);

    if (textError) {
      console.warn("[upload] could not store parsed text:", textError.message);
    }

    // The nested extraction, for rebuilding the candidate's own document.
    // The flattened facts rows below cannot do that without losing which
    // bullets belong to which role.
    const { error: factsJsonError } = await supabase
      .from("documents")
      .update({ facts_json: parsed.facts })
      .eq("id", documentId);

    if (factsJsonError) {
      console.warn(
        "[upload] could not store the extraction (migration 0008 may be missing):",
        factsJsonError.message
      );
    }

    // The ledger. origin 'document' marks these as things the uploaded file
    // actually says, which is the only kind of fact a rewrite may cite.
    const rows = factRows(parsed.facts, documentId);
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
