/**
 * /start/template
 *
 * Step two of two.
 *
 * `?document=<uuid>` carries the upload from step one, and it is read here
 * rather than only forwarded. The extraction stored on `documents.facts_json`
 * by migration 0008 is rebuilt into a document with the same deterministic
 * function the editor uses, and that is what every preview on this page
 * renders. Choosing a layout means seeing how it copes with your six roles
 * and your forty-word bullets; showing an invented person's resume instead
 * makes the whole screen a decoration.
 *
 * An invented uuid still costs nothing. A document id that resolves to no
 * row is one more kind of miss, and every flavour of miss lands on the same
 * branch: the fixture, labelled.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SetupNotice } from "@/components/setup-notice";
import { loadPreviewDoc } from "@/lib/editor/preview-doc";
import { supabaseConfig } from "@/lib/supabase/config";
import { PickTemplateForDocument } from "./pick";

export const metadata: Metadata = {
  title: "Choose a template | Tailor",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TemplatePage(props: PageProps<"/start/template">) {
  // Next 16: searchParams is a Promise on every page.
  const params = await props.searchParams;
  const raw = params.document;
  const documentId = typeof raw === "string" && UUID.test(raw) ? raw : undefined;

  const config = supabaseConfig();
  const doc = config.ok ? await loadPreviewDoc(documentId) : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href="/start"
        className="inline-flex items-center gap-1.5 rounded-xs text-[0.8125rem] text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        Back
      </Link>

      <header className="mt-4 max-w-2xl">
        <p className="label">Step 2 of 2</p>
        <h1 className="mt-2.5 font-display text-4xl leading-[1.05] text-ink sm:text-5xl">
          Choose how it should look
        </h1>
        <p className="mt-3.5 text-[0.9375rem] leading-relaxed text-ink-muted">
          {doc
            ? "Every preview below is your own resume, poured into that layout. Pick the one that holds it best. You can change this later without redoing any work."
            : documentId
              ? "Your upload is stored, but we could not rebuild it into a preview yet, so the pages below show sample content. Pick a layout and we will pour your resume in next."
              : "Pick a layout to start from. The pages below show sample content. You can change it later without redoing any work."}
        </p>
      </header>

      <div className="mt-9">
        {config.ok ? (
          <PickTemplateForDocument documentId={documentId} doc={doc ?? undefined} />
        ) : (
          <SetupNotice missing={config.missing} context="Creating a resume" />
        )}
      </div>
    </div>
  );
}
