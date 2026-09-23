/**
 * The document as the text a parser would have read.
 *
 * The tailoring route takes either a stored upload or raw resume text. From
 * inside the editor the honest input is the document as it stands right now,
 * including whatever the user has typed since it was loaded, so this walks the
 * live document and writes it out the way the original resume was laid out.
 *
 * Deterministic, and nothing is invented: every line here already exists on
 * the page. If a section is empty it is omitted rather than given a heading
 * with nothing under it, because an empty heading in the text the extractor
 * reads becomes an empty section in the facts.
 */

import type { ResumeDoc } from "@ats/templates";

function heading(title: string, body: string[]): string[] {
  const lines = body.filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  return ["", title.toUpperCase(), ...lines];
}

export function docToPlainText(doc: ResumeDoc): string {
  const out: string[] = [];

  if (doc.contact.name) out.push(doc.contact.name);
  const contact = [doc.contact.email, doc.contact.phone, doc.contact.location]
    .filter(Boolean)
    .join(" | ");
  if (contact) out.push(contact);
  for (const link of doc.contact.links ?? []) {
    if (link?.url) out.push(link.label ? `${link.label}: ${link.url}` : link.url);
  }
  if (doc.headline) out.push(doc.headline);

  out.push(...heading("Summary", [doc.summary.text]));

  out.push(
    ...heading(
      "Skills",
      doc.skills.map((group) =>
        group.category ? `${group.category}: ${group.items.join(", ")}` : group.items.join(", "),
      ),
    ),
  );

  const experience: string[] = [];
  for (const exp of doc.experience) {
    const dates = [exp.start_date, exp.end_date].filter(Boolean).join(" - ");
    experience.push(
      [exp.title, exp.company, exp.location, dates].filter(Boolean).join(" | "),
    );
    for (const bullet of exp.bullets) {
      if (bullet.text.trim()) experience.push(`- ${bullet.text}`);
    }
  }
  out.push(...heading("Experience", experience));

  const projects: string[] = [];
  for (const proj of doc.projects) {
    projects.push([proj.name, proj.url].filter(Boolean).join(" | "));
    for (const bullet of proj.bullets) {
      if (bullet.text.trim()) projects.push(`- ${bullet.text}`);
    }
  }
  out.push(...heading("Projects", projects));

  out.push(
    ...heading(
      "Education",
      doc.education.map((edu) =>
        [edu.degree, edu.institution, edu.dates].filter(Boolean).join(" | "),
      ),
    ),
  );

  out.push(...heading("Certifications", doc.certifications.map((cert) => cert.text)));

  for (const section of doc.other_sections) {
    out.push(
      ...heading(
        section.heading || "Other",
        section.bullets.map((bullet) => `- ${bullet.text}`),
      ),
    );
  }

  return out.join("\n").trim();
}
