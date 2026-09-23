/**
 * /start/template
 *
 * Step two of two.
 *
 * `?document=<uuid>` carries the upload from step one. It is only ever used
 * to build the next URL, so an invented value costs nothing here: the editor
 * loads the document under RLS, where a uuid belonging to somebody else
 * simply does not exist.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PickTemplate } from "@/components/start/pick-template";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfig } from "@/lib/supabase/config";

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
          {documentId
            ? "Your upload is stored. Pick a layout and we will pour it in. You can change this later without redoing any work."
            : "Pick a layout to start from. You can change it later without redoing any work."}
        </p>
      </header>

      <div className="mt-9">
        {config.ok ? (
          <PickTemplate documentId={documentId} />
        ) : (
          <SetupNotice missing={config.missing} context="Creating a resume" />
        )}
      </div>
    </div>
  );
}
