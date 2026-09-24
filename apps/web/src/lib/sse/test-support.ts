/**
 * Fixtures shared by the streaming routes' tests. Not imported by anything
 * that ships; it exists so three test files do not each grow their own
 * slightly different idea of what a resume looks like.
 */

import {
  JobSpecSchema,
  ResumeFactsSchema,
  TailoredResumeSchema,
  type JobSpec,
  type ResumeFacts,
  type TailoredResume,
  type TruthReport,
  type TruthViolation,
} from "@ats/core";

export const FACTS: ResumeFacts = ResumeFactsSchema.parse({
  contact: { name: "Rohan Iyer", email: "rohan@example.com" },
  headline: "Backend engineer",
  experience: [
    {
      id: "E1",
      company: "Northwind Logistics",
      title: "Senior Backend Engineer",
      start_date: "Jun 2021",
      end_date: "Present",
      bullets: [
        { id: "E1.B1", text: "Added a Redis cache in front of the pricing service." },
        { id: "E1.B2", text: "Moved reporting reads to a read replica." },
      ],
      tech: ["Python", "Redis", "PostgreSQL"],
    },
  ],
  skills: [{ id: "S1", category: "Backend", items: ["Python", "PostgreSQL", "Redis"] }],
  total_years_experience: 4,
});

export const TAILORED: TailoredResume = TailoredResumeSchema.parse({
  headline: "Senior Backend Engineer",
  summary: { text: "Backend engineer working on pricing and reporting.", source_ids: ["E1"] },
  skills: [{ category: "Backend", items: ["Python", "PostgreSQL", "Redis"], source_ids: ["S1"] }],
  experience: [
    {
      source_id: "E1",
      company: "Northwind Logistics",
      title: "Senior Backend Engineer",
      start_date: "Jun 2021",
      end_date: "Present",
      bullets: [
        {
          text: "Put a Redis cache in front of the pricing service.",
          source_ids: ["E1.B1"],
          keywords: ["Redis"],
        },
        {
          text: "Moved reporting reads onto a PostgreSQL read replica.",
          source_ids: ["E1.B2"],
          keywords: ["PostgreSQL"],
        },
      ],
    },
  ],
  section_order: ["summary", "skills", "experience"],
});

export const JOB: JobSpec = JobSpecSchema.parse({
  company: "Acme Payments",
  title: "Backend Engineer",
  requirements: [
    { term: "Python", category: "language", importance: "required", evidence: "Python required" },
    { term: "PostgreSQL", category: "database", importance: "required", evidence: "Postgres" },
  ],
  keywords: [
    { term: "Python", variants: ["Python3"], weight: 5 },
    { term: "PostgreSQL", variants: ["Postgres"], weight: 4 },
    { term: "Redis", variants: [], weight: 3 },
  ],
});

export function truthReport(violations: TruthViolation[] = []): TruthReport {
  const errors = violations.filter((v) => v.severity === "error").length;
  return {
    passed: errors === 0,
    error_count: errors,
    warning_count: violations.length - errors,
    violations,
  };
}

export function fabricatedMetric(location: string): TruthViolation {
  return {
    code: "UNSOURCED_METRIC",
    severity: "error",
    location,
    detail: "The figure 45% does not appear in the uploaded resume.",
    offending: "Cut checkout latency by 45%.",
  };
}

/** A successful `responses.create` reply carrying `payload` as JSON. */
export function modelJson(payload: unknown) {
  const text = JSON.stringify(payload);
  return {
    status: "completed",
    output_text: text,
    output: [{ content: [{ type: "output_text", text }] }],
    usage: { input_tokens: 100, output_tokens: 50 },
  };
}

/**
 * A Supabase client whose tables do not exist.
 *
 * That is the deployment as it actually stands: no schema applied. Every
 * route is expected to return its result anyway, so this is the default
 * fixture rather than a special case.
 *
 * It used to carry an `auth.getUser()` stub as well, and take a user to hand
 * back from it. Nothing calls auth any more, so there is nobody to fake.
 */
export function unmigratedSupabase() {
  const missing = { message: 'relation "public.resumes" does not exist' };

  const table = {
    insert: () => ({
      select: () => ({ single: async () => ({ data: null, error: missing }) }),
      then: undefined,
    }),
    update: () => ({ eq: async () => ({ error: missing }) }),
    upsert: async () => ({ error: missing }),
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: missing }) }) }),
  };

  return { from: () => table };
}
