import { NextResponse } from "next/server";
import { docxToLayout } from "@/lib/ingest/docx-layout";
import { pdfToLayout } from "@/lib/ingest/layout";
import { renderResumePdf } from "@/lib/pdf/resume-pdf";
import { renderStyledPdf } from "@/lib/pdf/styled-pdf";
import { docxToPdf, renderPreservedDocx } from "@/lib/render/preserve-docx";
import { ResumeFactsSchema, TailoredResumeSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Three render modes:
 *   optimize — the ATS-first layout, ignoring the original design
 *   preserve — DOCX: the candidate's own file, text swapped in place
 *              PDF:  a rebuild from the measured style (a visual match only)
 *
 * The original file is re-sent rather than cached server-side: the DOCX layout
 * holds an open zip handle that cannot be serialised, and a stateless route is
 * a better trade than a session store for a single-shot render.
 */

function safe(part: string) {
  return part.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const PLACEHOLDER = /^(unspecified|not specified|unknown|n\/a|none)$/i;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const payloadRaw = String(form.get("payload") ?? "");
    if (!payloadRaw) {
      return NextResponse.json({ error: "Missing render payload." }, { status: 400 });
    }
    const payload = JSON.parse(payloadRaw);

    const tailored = TailoredResumeSchema.parse(payload.tailored);
    const facts = ResumeFactsSchema.parse(payload.facts);
    const mode: "preserve" | "optimize" = payload.mode === "preserve" ? "preserve" : "optimize";

    const rawCompany = String(payload.company ?? "").trim();
    const company = PLACEHOLDER.test(rawCompany) ? "" : safe(rawCompany);
    const stem = [safe(facts.contact.name), "Resume", company].filter(Boolean).join("-");

    const file = form.get("resume");
    const upload =
      file instanceof File && file.size > 0
        ? { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) }
        : null;

    const send = (body: Buffer, type: string, filename: string, extra: Record<string, string> = {}) =>
      new NextResponse(new Uint8Array(body), {
        headers: {
          "Content-Type": type,
          "Content-Disposition": `attachment; filename="${filename}"`,
          ...extra,
        },
      });

    if (mode === "optimize" || !upload) {
      const pdf = await renderResumePdf(tailored, facts);
      return send(pdf, "application/pdf", `${stem}-ATS.pdf`, { "X-Render-Mode": "optimize" });
    }

    const ext = upload.name.toLowerCase().split(".").pop() ?? "";

    if (ext === "docx") {
      const layout = await docxToLayout(upload.bytes);
      const { bytes, applied, skipped, plan, mappedCount } = await renderPreservedDocx(
        layout,
        tailored,
        facts,
      );

      // Report fidelity in headers so the UI can be honest about what happened
      // without a second round trip.
      const fidelity = {
        "X-Render-Mode": "preserve-exact",
        "X-Paragraphs-Mapped": String(mappedCount),
        "X-Paragraphs-Rewritten": String(applied),
        "X-Paragraphs-Skipped": String(skipped.length),
        "X-Lines-Unplaced": String(plan.unplaced.length),
      };

      const converted = await docxToPdf(bytes);
      if (converted.ok) {
        return send(converted.pdf, "application/pdf", `${stem}.pdf`, fidelity);
      }
      // No LibreOffice: the edited .docx is still the more useful artefact.
      return send(
        bytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        `${stem}.docx`,
        { ...fidelity, "X-Convert-Warning": converted.reason },
      );
    }

    if (ext === "pdf") {
      const layout = await pdfToLayout(upload.bytes);
      const pdf = await renderStyledPdf(tailored, facts, layout.style);
      return send(pdf, "application/pdf", `${stem}.pdf`, {
        "X-Render-Mode": "preserve-visual",
        "X-Columns": String(layout.style.columnCount),
      });
    }

    // Plain text had no format to preserve.
    const pdf = await renderResumePdf(tailored, facts);
    return send(pdf, "application/pdf", `${stem}-ATS.pdf`, { "X-Render-Mode": "optimize" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not render the resume.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
