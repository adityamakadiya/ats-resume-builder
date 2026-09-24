/**
 * The candidate's own document, for a screen that only wants to show it.
 *
 * The template picker renders eight live previews before any resume row
 * exists, so it cannot go through `loadRun`: there is nothing to load and
 * nothing to write back. All it needs is the extraction stored beside the
 * upload, poured through the same deterministic `factsToDocument` the editor
 * uses, so the preview and the editor cannot disagree about what the upload
 * said.
 *
 * NOTHING HERE THROWS, and every miss is the same miss.
 *
 *   - no document id in the URL
 *   - no Supabase configured
 *   - there is no row with that id
 *   - `documents.facts_json` is missing because migration 0008 has not been
 *     applied on this database, which makes the select itself error
 *   - the column is there and null, because parsing failed
 *   - the extraction is there and empty, which is a parse that failed
 *     without saying so
 *
 * All six return null, the caller shows the fixture, and the fixture is
 * labelled. A preview that quietly shows a stranger's resume is worse than
 * one that admits it has nothing of yours yet.
 */

import type { ResumeFacts } from "@ats/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResumeDoc } from "@ats/templates";
import { getServerClient } from "@/lib/supabase/server";
import { factsToDocument } from "./ingest";

/*
  One line per resolution, because this decides whether a candidate is shown
  their own resume or a stranger's, and getting it wrong is silent: the page
  renders perfectly either way and only the name gives it away. When someone
  reports "it is showing the sample", this says which of the six misses it
  was without needing a debugger against a live session.
*/
function report(documentId: string, outcome: string): void {
  console.info(`[preview] ${documentId}: ${outcome}`);
}

export async function loadPreviewDoc(documentId?: string): Promise<ResumeDoc | null> {
  if (!documentId) return null;

  try {
    const typed = await getServerClient();
    if (!typed) return null;

    /*
      `lib/supabase/types.ts` declares only the tables another screen reads,
      and it belongs to a different agent. Rather than widen someone else's
      type from here, this one column is read through an untyped handle and
      validated below, which a jsonb column would need anyway.
    */
    const db = typed as unknown as SupabaseClient;

    const { data, error } = await db
      .from("documents")
      .select("facts_json")
      .eq("id", documentId)
      .maybeSingle();

    // 42703 (undefined column) and 42P01 (undefined table) both land here
    // when the migrations are not applied. Neither is the user's problem.
    if (error || !data) {
      report(documentId, error ? `select failed: ${error.message}` : "no such document");
      return null;
    }

    const factsJson = (data as Record<string, unknown>).facts_json;
    if (!factsJson || typeof factsJson !== "object") {
      report(documentId, "facts_json is null; the upload was never parsed");
      return null;
    }

    const facts = factsJson as ResumeFacts;

    // An extraction with no name and no history did not work, whatever the
    // service reported. The sample is at least honest about being a sample.
    if (!facts.contact?.name && (facts.experience ?? []).length === 0) {
      report(documentId, "the extraction has neither a name nor any history");
      return null;
    }

    report(
      documentId,
      `resolved to "${facts.contact?.name || "(no name)"}", ` +
        `${(facts.experience ?? []).length} roles`
    );
    return factsToDocument(facts);
  } catch (error) {
    console.warn("[preview] could not read the extraction:", error);
    return null;
  }
}
