import { NextResponse } from "next/server";
import { fetchJd } from "@/lib/ingest/jd-fetch";
import { resumeToText } from "@/lib/ingest/resume-text";
import {
  analyzeGaps,
  extractJobSpec,
  extractResumeFacts,
  scoreAndStrategize,
  tailorResume,
} from "@/lib/pipeline";

export const runtime = "nodejs";
export const maxDuration = 800;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("resume");
    const resumeText = String(form.get("resumeText") ?? "").trim();
    const jdUrl = String(form.get("jdUrl") ?? "").trim();
    const jdTextInput = String(form.get("jdText") ?? "").trim();

    /* ---- resume in ---- */
    let rawResumeText: string;
    if (file instanceof File && file.size > 0) {
      rawResumeText = await resumeToText({
        filename: file.name,
        mimeType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
      });
    } else if (resumeText.length > 200) {
      rawResumeText = resumeText;
    } else {
      return NextResponse.json(
        { error: "Upload a resume file, or paste at least a few hundred characters of resume text." },
        { status: 400 },
      );
    }

    /* ---- job description in ---- */
    let jdText = jdTextInput;
    let sourceNote = "pasted by the candidate";

    if (!jdText && jdUrl) {
      const fetched = await fetchJd(jdUrl);
      if (fetched.blocked) {
        return NextResponse.json(
          {
            error: fetched.blockReason,
            needsJdPaste: true,
            portal: fetched.portal,
            hint:
              "Open the posting in your browser, copy the full job description, and paste it instead. " +
              "Job portals that require a sign-in cannot be read from the server.",
          },
          { status: 422 },
        );
      }
      jdText = fetched.text;
      sourceNote = `${fetched.portal} — ${fetched.url}`;
    }

    if (!jdText || jdText.length < 400) {
      return NextResponse.json(
        { error: "Provide a job description URL, or paste the full job description text." },
        { status: 400 },
      );
    }

    /* ---- pipeline ---- */
    const [job, facts] = await Promise.all([
      extractJobSpec(jdText, sourceNote),
      extractResumeFacts(rawResumeText),
    ]);

    const gaps = await analyzeGaps(job, facts);
    const { tailored, truth, repairAttempted } = await tailorResume(job, facts, gaps, rawResumeText);
    const { report, strategy } = await scoreAndStrategize(job, gaps, tailored);

    return NextResponse.json({
      job,
      facts,
      gaps,
      tailored,
      truth,
      repairAttempted,
      report,
      strategy,
      rawResumeText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
