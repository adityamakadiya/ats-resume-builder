"use client";

/**
 * Step two: choose a template, then go and get the posting.
 *
 * The registry is read on the client because the picker renders the real
 * template components, and those have to be in the client bundle anyway for
 * the live preview to update without a round trip.
 *
 * What is different from the generic version of this screen is `doc`. The
 * page above has already read the extraction for this upload and rebuilt the
 * candidate's own document from it, so the thumbnails and the large preview
 * are their resume in each layout rather than an invented person's. When
 * there is no upload, or nothing usable in it, `doc` is undefined and the
 * picker falls back to the fixture and labels it.
 *
 * THE WRITE MOVED. This screen used to `POST /api/resumes` and open the
 * editor. The resume is now created one screen later, by `/start/job`, for
 * one reason: a resume row created here and then abandoned on the posting
 * step is a row nobody asked for, and the posting step is where the run that
 * fills the row actually begins. Both choices travel in the query string,
 * which is also what makes Back from step three lossless.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DEFAULT_TEMPLATE_ID, templateList, type ResumeDoc } from "@ats/templates";
import { TemplatePicker } from "@/components/templates/picker";

export function PickTemplateForDocument({
  documentId,
  doc,
}: {
  documentId?: string;
  doc?: ResumeDoc;
}) {
  const router = useRouter();
  const [busyStep, setBusyStep] = useState<string | null>(null);

  function confirm(templateId: string) {
    // Named, like every other wait in this product. "Loading" would say
    // nothing; this says which screen is coming.
    setBusyStep("Opening the last step");

    const query = new URLSearchParams();
    if (documentId) query.set("document", documentId);
    query.set("template", templateId);

    router.push(`/start/job?${query.toString()}`);
  }

  return (
    <TemplatePicker
      templates={templateList()}
      defaultTemplateId={DEFAULT_TEMPLATE_ID}
      doc={doc}
      onConfirm={confirm}
      busyStep={busyStep}
      error={null}
    />
  );
}
