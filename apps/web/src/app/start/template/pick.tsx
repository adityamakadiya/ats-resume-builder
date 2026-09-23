"use client";

/**
 * Step two: choose a template, create the resume, open the editor.
 *
 * The registry is read on the client because the picker renders the real
 * template components, and those have to be in the client bundle anyway for
 * the live preview to update without a round trip. The write that follows is
 * still a POST to /api/resumes.
 *
 * What is different from the generic version of this screen is `doc`. The
 * page above has already read the extraction for this upload and rebuilt the
 * candidate's own document from it, so the thumbnails and the large preview
 * are their resume in each layout rather than an invented person's. When
 * there is no upload, or nothing usable in it, `doc` is undefined and the
 * picker falls back to the fixture and labels it.
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
  const [error, setError] = useState<{ reason: string; remedy: string } | null>(null);

  async function confirm(templateId: string) {
    setError(null);
    setBusyStep("Creating your resume");

    let response: Response;
    try {
      response = await fetch("/api/resumes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // documentId travels in the body, not just the URL: the resume has
        // to record which upload it came from or the truth guard has no
        // text to check against. See migration 0007.
        body: JSON.stringify({ templateId, documentId }),
      });
    } catch {
      setBusyStep(null);
      setError({
        reason: "The request did not reach the server.",
        remedy: "Check your connection and press the button again.",
      });
      return;
    }

    let payload: { ok?: boolean; id?: string; reason?: string; remedy?: string };
    try {
      payload = await response.json();
    } catch {
      setBusyStep(null);
      setError({
        reason: `The server answered with ${response.status} and no explanation.`,
        remedy: "Try again. If it keeps happening, check the server logs.",
      });
      return;
    }

    if (!response.ok || !payload.ok || !payload.id) {
      setBusyStep(null);
      setError({
        reason: payload.reason ?? "The resume could not be created.",
        remedy: payload.remedy ?? "Try again in a moment.",
      });
      return;
    }

    setBusyStep("Opening the editor");
    const query = documentId ? `?document=${encodeURIComponent(documentId)}` : "";
    router.push(`/resume/${payload.id}${query}`);
  }

  return (
    <TemplatePicker
      templates={templateList()}
      defaultTemplateId={DEFAULT_TEMPLATE_ID}
      doc={doc}
      onConfirm={confirm}
      busyStep={busyStep}
      error={error}
    />
  );
}
