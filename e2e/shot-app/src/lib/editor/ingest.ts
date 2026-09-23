/**
 * Turning an uploaded file into a document the editor can show.
 *
 * The chain is: bytes -> text -> facts -> a ResumeDoc. Each arrow is
 * somewhere different, for a reason.
 *
 *   bytes -> text    the Python document service. PyMuPDF, and more
 *                    importantly the column detector: a two-column resume
 *                    read naively interleaves the sidebar into the body and
 *                    every fact after that is nonsense. No JavaScript PDF
 *                    reader in this repo does that, so this hop is not
 *                    optional.
 *
 *   text -> facts    a model, through the same service, because that is
 *                    where the extraction prompt and its cache already live.
 *
 *   facts -> doc     here, and deterministically. No model writes the first
 *                    draft. Before anything is tailored, the document the
 *                    user sees IS their resume: the same bullets, in the
 *                    same order, with the ids that let every later rewrite
 *                    be traced back. Asking a model to "convert" facts into
 *                    a document would be inviting it to improve them, which
 *                    is precisely the thing this product refuses to do.
 *
 * The last step is the one worth being careful about. A user who uploads a
 * resume and sees something subtly different has been lied to on the first
 * screen, and nothing later recovers that.
 */

import type { ResumeFacts } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";

const DOCSVC = process.env.DOCSVC_URL ?? "http://localhost:8000";

export class IngestError extends Error {
  constructor(
    message: string,
    readonly remedy: string,
    readonly status: number = 502,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

export type ParsedResume = {
  rawText: string;
  pageCount: number;
  style: unknown | null;
  notes: string[];
  facts: ResumeFacts;
};

/**
 * Send the file to the document service and get back text plus facts.
 *
 * `/api/resume/parse` does both in one call and caches the extraction on a
 * hash of the text, so re-uploading the same resume costs nothing.
 */
export async function parseResumeFile(
  file: File,
  signal?: AbortSignal,
): Promise<ParsedResume> {
  const body = new FormData();
  body.set("resume", file, file.name);

  let response: Response;
  try {
    response = await fetch(`${DOCSVC}/api/resume/parse`, {
      method: "POST",
      body,
      signal,
      headers: process.env.DOCSVC_TOKEN
        ? { Authorization: `Bearer ${process.env.DOCSVC_TOKEN}` }
        : undefined,
    });
  } catch (error) {
    throw new IngestError(
      "The document service is not reachable.",
      "Start it with: cd backend && .venv/bin/python -m uvicorn atsresume.api:app --port 8000 --app-dir src",
      503,
    );
  }

  if (!response.ok) {
    // The service returns readable messages for the things a candidate can
    // act on: a scanned PDF, a password, a file that is really a .doc.
    let detail = `The document service returned ${response.status}.`;
    try {
      const payload = (await response.json()) as { detail?: unknown };
      if (typeof payload.detail === "string") detail = payload.detail;
    } catch {
      /* keep the status line */
    }
    throw new IngestError(detail, "Fix the file and upload it again, or paste the text instead.", 422);
  }

  const payload = (await response.json()) as {
    source?: { raw_text?: string; page_count?: number; style?: unknown; notes?: string[] };
    facts?: ResumeFacts;
  };

  if (!payload.facts || !payload.source?.raw_text) {
    throw new IngestError(
      "The document service answered with nothing usable.",
      "Check its logs. The file was stored, so nothing is lost.",
    );
  }

  return {
    rawText: payload.source.raw_text,
    pageCount: payload.source.page_count ?? 0,
    style: payload.source.style ?? null,
    notes: payload.source.notes ?? [],
    facts: payload.facts,
  };
}

/* ------------------------------------------------------------------------ */
/* facts -> document                                                         */
/* ------------------------------------------------------------------------ */

const SECTION_ORDER = [
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
  "certifications",
] as const;

/**
 * The candidate's own resume, in the shape the editor and the templates take.
 *
 * Every line cites the fact it came from, which is what makes the very first
 * document already traceable: the truth guard can run against it before a
 * single word has been rewritten, and the badge can honestly say nothing has
 * been invented, because nothing has been written.
 *
 * Nothing here paraphrases. Bullet text is copied through verbatim.
 */
export function factsToDocument(facts: ResumeFacts): ResumeDoc {
  return {
    // The templates print this, and it is the one part of a resume that
    // being wrong makes the whole document useless: an unreachable
    // candidate is the only parse failure that certainly costs the job.
    contact: {
      name: facts.contact?.name ?? "",
      email: facts.contact?.email ?? "",
      phone: facts.contact?.phone ?? "",
      location: facts.contact?.location ?? "",
      links: facts.contact?.links ?? [],
    },
    headline: facts.headline ?? "",
    summary: {
      text: facts.summary ?? "",
      // The summary cites itself: it is the candidate's own words, unedited.
      source_ids: facts.summary ? ["SUMMARY"] : [],
    },
    skills: (facts.skills ?? []).map((group) => ({
      category: group.category,
      items: group.items,
      source_ids: [group.id],
    })),
    experience: (facts.experience ?? []).map((role) => ({
      source_id: role.id,
      company: role.company,
      title: role.title,
      location: role.location ?? "",
      start_date: role.start_date,
      end_date: role.end_date,
      bullets: (role.bullets ?? []).map((bullet) => ({
        text: bullet.text,
        source_ids: [bullet.id],
        keywords: [],
      })),
    })),
    projects: (facts.projects ?? []).map((project) => ({
      source_id: project.id,
      name: project.name,
      url: project.url ?? "",
      bullets: (project.bullets ?? []).map((bullet) => ({
        text: bullet.text,
        source_ids: [bullet.id],
        keywords: [],
      })),
    })),
    education: (facts.education ?? []).map((entry) => ({
      source_id: entry.id,
      institution: entry.institution,
      degree: entry.degree,
      dates: entry.dates ?? "",
    })),
    certifications: (facts.certifications ?? []).map((cert) => ({
      source_id: cert.id,
      text: cert.text,
    })),
    other_sections: (facts.other_sections ?? []).map((section) => ({
      source_id: section.id,
      heading: section.heading,
      bullets: (section.bullets ?? []).map((bullet) => ({
        text: bullet.text,
        source_ids: [bullet.id],
        keywords: [],
      })),
    })),
    // Only sections that actually have content, in the conventional order.
    // A heading with nothing under it is worse than an absent one.
    section_order: SECTION_ORDER.filter((key) => {
      switch (key) {
        case "summary":
          return Boolean(facts.summary);
        case "skills":
          return (facts.skills ?? []).length > 0;
        case "experience":
          return (facts.experience ?? []).length > 0;
        case "projects":
          return (facts.projects ?? []).length > 0;
        case "education":
          return (facts.education ?? []).length > 0;
        case "certifications":
          return (facts.certifications ?? []).length > 0;
      }
    }),
    rewrite_notes: [],
  };
}

/**
 * The ledger rows for an extracted document.
 *
 * `origin: 'document'` is the whole point: these came off the uploaded file
 * and can be cited by a rewrite. Facts the candidate later tells us in chat
 * arrive as `attested`, and the difference is what lets the guard accept a
 * number the resume never printed without accepting one nobody ever said.
 */
export function factRows(
  facts: ResumeFacts,
  userId: string,
  documentId: string,
): Array<{
  user_id: string;
  document_id: string;
  fact_key: string;
  text: string;
  origin: "document";
  entities_json: { technologies: string[] };
}> {
  const rows: ReturnType<typeof factRows> = [];
  const push = (key: string, text: string, technologies: string[] = []) => {
    if (!key || !text.trim()) return;
    rows.push({
      user_id: userId,
      document_id: documentId,
      fact_key: key,
      text,
      origin: "document",
      entities_json: { technologies },
    });
  };

  if (facts.summary) push("SUMMARY", facts.summary);
  if (facts.headline) push("HEADLINE", facts.headline);

  for (const role of facts.experience ?? []) {
    push(
      role.id,
      [role.company, role.title, role.location, role.start_date, role.end_date]
        .filter(Boolean)
        .join(" "),
      role.tech ?? [],
    );
    for (const bullet of role.bullets ?? []) push(bullet.id, bullet.text, role.tech ?? []);
  }
  for (const project of facts.projects ?? []) {
    push(project.id, [project.name, project.description].filter(Boolean).join(" "), project.tech ?? []);
    for (const bullet of project.bullets ?? []) push(bullet.id, bullet.text, project.tech ?? []);
  }
  for (const entry of facts.education ?? []) {
    push(entry.id, [entry.institution, entry.degree, entry.dates, entry.details].filter(Boolean).join(" "));
  }
  for (const group of facts.skills ?? []) {
    push(group.id, [group.category, ...group.items].join(" "), group.items);
  }
  for (const cert of facts.certifications ?? []) push(cert.id, cert.text);
  for (const section of facts.other_sections ?? []) {
    push(section.id, section.heading);
    for (const bullet of section.bullets ?? []) push(bullet.id, bullet.text);
  }

  return rows;
}
