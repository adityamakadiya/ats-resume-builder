import { NextResponse } from "next/server";
import { ingestResume, type SourceDocument } from "@/lib/ingest";
import { fetchJd } from "@/lib/ingest/jd-fetch";
import {
  analyzeGaps,
  extractJobSpec,
  extractResumeFacts,
  scoreAndStrategize,
  tailorResume,
} from "@/lib/pipeline";

export const runtime = "nodejs";

/**
 * Vercel caps a serverless function at 300s (Pro); Hobby is lower still. A full
 * run measured ~207s on a one-page resume, so a long resume against a long JD
 * can exceed this. Reliable hosting needs the pipeline moved behind a job queue
 * with the client polling — this ceiling is the honest limit until then, and it
 * fails loudly rather than appearing to hang.
 */
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("resume");
    const resumeText = String(form.get("resumeText") ?? "").trim();
    const jdUrl = String(form.get("jdUrl") ?? "").trim();
    const jdTextInput = String(form.get("jdText") ?? "").trim();

    /* ---- resume in ---- */
    let source: SourceDocument;
    if (file instanceof File && file.size > 0) {
      source = await ingestResume({
        filename: file.name,
        mimeType: file.type,
        bytes: Buffer.from(await file.arrayBuffer()),
      });
    } else if (resumeText.length > 200) {
      source = await ingestResume({
        filename: "pasted.txt",
        mimeType: "text/plain",
        bytes: Buffer.from(resumeText, "utf8"),
      });
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
      extractResumeFacts(source.rawText),
    ]);

    const gaps = await analyzeGaps(job, facts);
    const { tailored, truth, repairAttempted } = await tailorResume(
      job,
      facts,
      gaps,
      source.rawText,
    );
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
      rawResumeText: source.rawText,
      // The layout itself cannot cross the JSON boundary (it holds an open zip
      // handle for DOCX), so the client re-sends the original file when it asks
      // for a render. Everything needed to choose a mode travels here.
      source: {
        kind: source.kind,
        preservable: source.preservable,
        pageCount: source.pageCount,
        notes: source.notes,
        style: source.style,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unexpected error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
