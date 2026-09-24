/**
 * /start/job
 *
 * Step three of three, and the one that was in the wrong place.
 *
 * The posting used to be reachable only from a button in the editor's
 * toolbar, which meant the first thing anyone saw of the product was the
 * product with its main feature switched off: no score, no keyword panel,
 * two panels of empty state and a drawer they had not been told about. Every
 * panel that matters is a comparison against a posting, so the posting is
 * asked for before the editor opens rather than after.
 *
 * It is skippable, and the skip says what it costs. A resume with no posting
 * is a legitimate thing to want, and somebody who has just uploaded a file
 * and wants to fix a typo should not be held at a wall. What they must not
 * be is surprised, so the link names both things that will be missing.
 *
 * Next 16: `searchParams` is a Promise with no synchronous shim, and
 * `PageProps` is a global type rather than an import.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfig } from "@/lib/supabase/config";
import { AddPosting } from "./add-posting";

export const metadata: Metadata = {
  title: "Add the job posting | Tailor",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function JobPage(props: PageProps<"/start/job">) {
  const params = await props.searchParams;

  const rawDocument = params.document;
  const documentId =
    typeof rawDocument === "string" && UUID.test(rawDocument) ? rawDocument : undefined;

  // The layout chosen in step two. Validated in `POST /api/resumes` against
  // the registry, so an edited query string is refused there rather than
  // stored and failed at render time.
  const rawTemplate = params.template;
  const templateId = typeof rawTemplate === "string" ? rawTemplate : undefined;

  const config = supabaseConfig();
  const back = `/start/template${documentId ? `?document=${encodeURIComponent(documentId)}` : ""}`;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <Link
        href={back}
        className="inline-flex items-center gap-1.5 rounded-xs text-[0.8125rem] text-ink-muted hover:text-ink"
      >
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        Back
      </Link>

      <header className="mt-4 max-w-2xl">
        <p className="label">Step 3 of 3</p>
        <h1 className="mt-2.5 font-display text-4xl leading-[1.05] text-ink sm:text-5xl">
          What are you aiming at?
        </h1>
        <p className="mt-3.5 text-[0.9375rem] leading-relaxed text-ink-muted">
          The score, the gaps and every suggested keyword are comparisons
          against one posting, so the editor needs one to do anything but hold
          your text. Paste it, or give us the link.
        </p>
      </header>

      <div className="mt-8">
        {config.ok ? (
          <AddPosting documentId={documentId} templateId={templateId} />
        ) : (
          <SetupNotice missing={config.missing} context="Creating a resume" />
        )}
      </div>
    </div>
  );
}
