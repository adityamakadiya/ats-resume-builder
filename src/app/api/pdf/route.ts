import { NextResponse } from "next/server";
import { renderResumePdf } from "@/lib/pdf/resume-pdf";
import { ResumeFactsSchema, TailoredResumeSchema } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const tailored = TailoredResumeSchema.parse(body.tailored);
    const facts = ResumeFactsSchema.parse(body.facts);
    // A JD that never names the employer yields a placeholder; keep it out of
    // the filename rather than shipping "Resume-Unspecified.pdf" to a recruiter.
    const rawCompany = String(body.company ?? "").trim();
    const isPlaceholder = /^(unspecified|not specified|unknown|n\/a|none)$/i.test(rawCompany);
    const company = isPlaceholder
      ? ""
      : rawCompany.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const pdf = await renderResumePdf(tailored, facts);
    const name = facts.contact.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const filename = [name, "Resume", company].filter(Boolean).join("-") + ".pdf";

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not render the PDF.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
