/**
 * TEMPORARY. A screenshot harness for the template picker.
 *
 * Deleted before this work is handed over. It exists only so the two states
 * of the preview, the candidate's own resume and the labelled fixture, can be
 * captured without standing up a database and a session.
 */

import { factsToDocument } from "@/lib/editor/ingest";
import { SAMPLE_FACTS } from "@/lib/editor/fixtures";
import { PickTemplateForDocument } from "../pick";

export const dynamic = "force-dynamic";

export default async function ShotPage(props: PageProps<"/start/template/shot">) {
  const params = await props.searchParams;
  const sample = params.sample === "1";
  const doc = sample ? undefined : factsToDocument(SAMPLE_FACTS);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mt-4 max-w-2xl">
        <p className="label">Step 2 of 2</p>
        <h1 className="mt-2.5 font-display text-4xl leading-[1.05] font-semibold text-ink sm:text-5xl">
          Choose how it should look
        </h1>
        <p className="mt-3.5 text-[0.9375rem] leading-relaxed text-ink-muted">
          {doc
            ? "Every preview below is your own resume, poured into that layout. Pick the one that holds it best."
            : "Pick a layout to start from. The pages below show sample content."}
        </p>
      </header>
      <div className="mt-9">
        <PickTemplateForDocument doc={doc} />
      </div>
    </div>
  );
}
