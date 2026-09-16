/**
 * Typed client for the Python backend.
 *
 * The flow is deliberately split across four calls rather than the single
 * `/api/run` convenience endpoint. Tailoring takes minutes, and a client that
 * makes one request can only render a spinner; four real steps means the
 * progress shown is progress that actually happened.
 *
 * Field names are snake_case because they mirror the Pydantic models exactly.
 * Renaming them at the boundary would mean a second place to keep in sync, and
 * the payloads are sent straight back to the API for rendering.
 */

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

/* ---------------------------------------------------------------- types -- */

export type Bullet = { id: string; text: string };
export type Link = { label: string; url: string };

export type Contact = {
  name: string;
  email: string;
  phone: string;
  location: string;
  links: Link[];
};

export type ExperienceFact = {
  id: string;
  company: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string;
  bullets: Bullet[];
  tech: string[];
};

export type ResumeFacts = {
  contact: Contact;
  headline: string;
  summary: string;
  experience: ExperienceFact[];
  projects: { id: string; name: string; description: string; url: string; bullets: Bullet[]; tech: string[] }[];
  education: { id: string; institution: string; degree: string; dates: string; details: string }[];
  skills: { id: string; category: string; items: string[] }[];
  certifications: { id: string; text: string }[];
  other_sections: { id: string; heading: string; bullets: Bullet[] }[];
  total_years_experience: number;
};

export type StyleProfile = {
  page_width: number;
  page_height: number;
  column_count: number;
  font_sizes: { name: number; heading: number; body: number; small: number };
  accent_color: string;
  serif: boolean;
  bullet_glyph: string;
  fonts: string[];
};

export type SourceDocument = {
  kind: "pdf" | "docx" | "text";
  raw_text: string;
  page_count: number;
  style: StyleProfile | null;
  notes: string[];
};

export type JobSpec = {
  company: string;
  title: string;
  location: string;
  work_mode: string;
  experience_years: { min: number; max: number; raw: string };
  requirements: { term: string; category: string; importance: "required" | "preferred"; evidence: string }[];
  responsibilities: string[];
  keywords: { term: string; variants: string[]; weight: number }[];
  implicit_requirements: { requirement: string; rationale: string }[];
  extraction_confidence: "high" | "medium" | "low";
  extraction_notes: string;
};

export type GapAnalysis = {
  strong_matches: { jd_term: string; source_ids: string[]; note: string }[];
  partial_matches: { jd_term: string; source_ids: string[]; note: string }[];
  transferable: { jd_term: string; source_ids: string[]; note: string }[];
  missing: { jd_term: string; severity: "blocking" | "significant" | "minor"; note: string }[];
  missing_keywords: string[];
  recoverable_keywords: string[];
  recruiter_concerns: string[];
  ats_rejection_risks: string[];
};

export type TailoredBullet = { text: string; source_ids: string[]; keywords: string[] };

export type TailoredResume = {
  headline: string;
  summary: { text: string; source_ids: string[] };
  skills: { category: string; items: string[]; source_ids: string[] }[];
  experience: {
    source_id: string;
    company: string;
    title: string;
    location: string;
    start_date: string;
    end_date: string;
    bullets: TailoredBullet[];
  }[];
  projects: { source_id: string; name: string; url: string; bullets: TailoredBullet[] }[];
  education: { source_id: string; institution: string; degree: string; dates: string }[];
  certifications: { source_id: string; text: string }[];
  other_sections: { source_id: string; heading: string; bullets: TailoredBullet[] }[];
  section_order: string[];
  rewrite_notes: string[];
};

export type TruthViolation = {
  code: string;
  severity: string;
  location: string;
  detail: string;
  offending: string;
};

export type TruthReport = {
  passed: boolean;
  error_count: number;
  warning_count: number;
  violations: TruthViolation[];
};

export type AtsReport = {
  overall: number;
  sub_scores: {
    keyword_match: number;
    skills_coverage: number;
    section_completeness: number;
    experience_match: number;
  };
  matched_keywords: string[];
  missing_keywords: string[];
  recoverable_keywords: string[];
  recommendations: string[];
};

export type Strategy = {
  should_apply: "yes" | "yes_with_caveats" | "probably_not";
  fit_estimate: string;
  biggest_strength: string;
  biggest_gap: string;
  interview_emphasis: string[];
  cover_letter_worthwhile: boolean;
  cover_letter_rationale: string;
  outreach_angle: string;
  top_improvements: string[];
};

export type ParseResponse = { source: SourceDocument; facts: ResumeFacts };

export type JdResponse = {
  text: string;
  portal: string;
  method: string;
  source_note: string;
  blocked: boolean;
  block_reason: string;
};

export type TailorResponse = {
  job: JobSpec;
  gaps: GapAnalysis;
  tailored: TailoredResume;
  truth: TruthReport;
  report: AtsReport;
  strategy: Strategy;
  repair_attempted: boolean;
};

/* --------------------------------------------------------------- errors -- */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Present when a portal blocked the fetch and the fix is to paste instead. */
    readonly needsJdPaste = false,
    readonly hint = "",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * FastAPI reports validation failures and handled errors in `detail`, which is
 * a string for our own raised errors and an object for the blocked-portal case.
 * Unwrapping it here keeps every call site from re-deriving the shape.
 */
async function unwrap<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;

  let detail: unknown;
  try {
    detail = (await response.json())?.detail;
  } catch {
    detail = null;
  }

  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    throw new ApiError(
      String(d.error ?? "The request failed."),
      response.status,
      Boolean(d.needs_jd_paste),
      String(d.hint ?? ""),
    );
  }
  if (Array.isArray(detail)) {
    throw new ApiError("The server rejected that payload.", response.status);
  }
  throw new ApiError(
    typeof detail === "string" && detail ? detail : `Request failed (${response.status}).`,
    response.status,
  );
}

/* ----------------------------------------------------------------- calls -- */

export type ThemeList = { default: string; themes: Record<string, string> };

/** Only themes that pass the backend's ATS checks are listed. */
export async function listThemes(): Promise<ThemeList> {
  return unwrap(await fetch(`${BASE}/api/themes`, { cache: "no-store" }));
}

export async function checkHealth(): Promise<{
  status: string;
  model: string;
  api_key_configured: boolean;
}> {
  const response = await fetch(`${BASE}/health`, { cache: "no-store" });
  return unwrap(response);
}

export async function parseResume(input: File | string): Promise<ParseResponse> {
  const body = new FormData();
  if (typeof input === "string") body.set("resume_text", input);
  else body.set("resume", input);
  return unwrap(await fetch(`${BASE}/api/resume/parse`, { method: "POST", body }));
}

export async function fetchJd(input: { url?: string; text?: string }): Promise<JdResponse> {
  const body = new FormData();
  if (input.url) body.set("url", input.url);
  if (input.text) body.set("text", input.text);
  return unwrap(await fetch(`${BASE}/api/jd/fetch`, { method: "POST", body }));
}

export async function tailor(
  facts: ResumeFacts,
  jdText: string,
  sourceNote: string,
): Promise<TailorResponse> {
  return unwrap(
    await fetch(`${BASE}/api/tailor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facts, jd_text: jdText, source_note: sourceNote }),
    }),
  );
}

export type RenderedPdf = { blob: Blob; filename: string; warnings: string[] };

export async function renderPdf(
  tailored: TailoredResume,
  facts: ResumeFacts,
  company: string,
  theme = "",
): Promise<RenderedPdf> {
  const response = await fetch(`${BASE}/api/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tailored, facts, company, theme }),
  });
  if (!response.ok) await unwrap(response);

  const disposition = response.headers.get("content-disposition") ?? "";
  const warnings = response.headers.get("x-render-warnings") ?? "";
  return {
    blob: await response.blob(),
    filename: disposition.match(/filename="(.+?)"/)?.[1] ?? "resume.pdf",
    warnings: warnings ? warnings.split(" | ").filter(Boolean) : [],
  };
}
