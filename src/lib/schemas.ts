import { z } from "zod";

/**
 * Two constraints shape these schemas, both from Anthropic's strict
 * JSON-schema mode:
 *
 *  - Every property must be present in `required`, so "optional" is modelled as
 *    a present-but-empty field rather than `.optional()`.
 *  - The compiled grammar has a size ceiling. `ResumeFacts` is the widest
 *    object in the pipeline, so it pays for absence with the empty string
 *    instead of a nullable union — fifteen `anyOf` branches was enough to push
 *    it over. Schemas that clear the ceiling comfortably still use
 *    `.nullable()`, which reads better.
 */

/** Absent values arrive as "" rather than null; both are falsy at the render layer. */
const absentAsEmpty = (what: string) => `${what}. Empty string if the resume does not state it.`;

/* ------------------------------------------------------------------ *
 * Layer 1 — ResumeFacts: what the candidate actually claims.
 * Extracted verbatim-anchored from the uploaded resume. Every atom gets a
 * stable id so downstream rewrites can cite their source.
 * ------------------------------------------------------------------ */

export const BulletSchema = z.object({
  id: z.string().describe("Stable id, e.g. 'E1.B2' for experience 1 bullet 2"),
  text: z.string().describe("The bullet copied from the resume, verbatim"),
});

export const ExperienceFactSchema = z.object({
  id: z.string().describe("Stable id, e.g. 'E1'"),
  company: z.string(),
  title: z.string(),
  location: z.string().describe(absentAsEmpty("Role location")),
  startDate: z.string().describe("As written on the resume, e.g. 'Jun 2023'"),
  endDate: z.string().describe("As written, e.g. 'Present'"),
  bullets: z.array(BulletSchema),
  tech: z.array(z.string()).describe("Technologies named in this role only"),
});

export const ProjectFactSchema = z.object({
  id: z.string().describe("Stable id, e.g. 'P1'"),
  name: z.string(),
  description: z.string().describe(absentAsEmpty("One-line project description")),
  url: z.string().describe(absentAsEmpty("Project URL")),
  bullets: z.array(BulletSchema),
  tech: z.array(z.string()),
});

export const EducationFactSchema = z.object({
  id: z.string(),
  institution: z.string(),
  degree: z.string().describe("Degree and field as written, e.g. 'B.E. Computer Engineering'"),
  dates: z.string().describe(absentAsEmpty("Dates as written, e.g. '2019 - 2023'")),
  details: z.string().describe(absentAsEmpty("Honours, GPA or coursework")),
});

export const SkillGroupSchema = z.object({
  id: z.string(),
  category: z.string().describe("e.g. 'Languages', 'Frameworks', 'Cloud & DevOps'"),
  items: z.array(z.string()),
});

export const CertificationSchema = z.object({
  id: z.string(),
  text: z.string().describe("The certification line as written, including issuer and date"),
});

export const OtherSectionSchema = z.object({
  id: z.string(),
  heading: z.string(),
  bullets: z.array(BulletSchema),
});

export const ResumeFactsSchema = z.object({
  contact: z.object({
    name: z.string(),
    email: z.string().describe(absentAsEmpty("Email address")),
    phone: z.string().describe(absentAsEmpty("Phone number")),
    location: z.string().describe(absentAsEmpty("City and country")),
    links: z.array(z.object({ label: z.string(), url: z.string() })),
  }),
  headline: z.string().describe(absentAsEmpty("Current professional title line")),
  summary: z.string().describe(absentAsEmpty("Existing summary or objective text, verbatim")),
  experience: z.array(ExperienceFactSchema),
  projects: z.array(ProjectFactSchema),
  education: z.array(EducationFactSchema),
  skills: z.array(SkillGroupSchema),
  certifications: z.array(CertificationSchema),
  otherSections: z.array(OtherSectionSchema),
  totalYearsExperience: z
    .number()
    .describe("Derived from employment dates only. 0 if it cannot be computed from the resume."),
});

export type ResumeFacts = z.infer<typeof ResumeFactsSchema>;
export type ExperienceFact = z.infer<typeof ExperienceFactSchema>;

/* ------------------------------------------------------------------ *
 * Layer 2 — JobSpec: the JD, decomposed.
 * ------------------------------------------------------------------ */

export const RequirementCategory = z.enum([
  "language",
  "framework",
  "database",
  "cloud_devops",
  "system_design",
  "architecture",
  "ai_ml",
  "testing",
  "security",
  "domain",
  "soft_skill",
  "tooling",
  "other",
]);

export const RequirementSchema = z.object({
  term: z.string().describe("The skill exactly as the JD names it"),
  category: RequirementCategory,
  importance: z.enum(["required", "preferred"]),
  evidence: z.string().describe("The JD phrase this was taken from"),
});

export const KeywordSchema = z.object({
  term: z.string(),
  variants: z.array(z.string()).describe("Synonyms/abbreviations an ATS may also match, e.g. 'PostgreSQL' -> 'Postgres'"),
  weight: z.number().describe("1-5, how heavily an ATS or recruiter is likely to weight this"),
});

export const JobSpecSchema = z.object({
  company: z.string(),
  title: z.string(),
  location: z.string().nullable(),
  workMode: z.enum(["onsite", "hybrid", "remote", "unspecified"]),
  employmentType: z.string().nullable(),
  experienceYears: z.object({
    min: z.number().nullable(),
    max: z.number().nullable(),
    raw: z.string().nullable().describe("As written, e.g. '2-4 years'"),
  }),
  requirements: z.array(RequirementSchema),
  responsibilities: z.array(z.string()),
  keywords: z.array(KeywordSchema),
  implicitRequirements: z
    .array(z.object({ requirement: z.string(), rationale: z.string() }))
    .describe("Not stated outright, but a recruiter or ATS will screen on it"),
  compensation: z.string().nullable(),
  extractionConfidence: z
    .enum(["high", "medium", "low"])
    .describe("low when the page looked like a login wall, search page, or stub"),
  extractionNotes: z.string().nullable(),
});

export type JobSpec = z.infer<typeof JobSpecSchema>;

/* ------------------------------------------------------------------ *
 * Layer 3 — GapAnalysis
 * ------------------------------------------------------------------ */

export const GapAnalysisSchema = z.object({
  strongMatches: z.array(
    z.object({
      jdTerm: z.string(),
      sourceIds: z.array(z.string()),
      note: z.string(),
    }),
  ),
  partialMatches: z.array(
    z.object({
      jdTerm: z.string(),
      sourceIds: z.array(z.string()),
      gapNote: z.string(),
    }),
  ),
  missing: z.array(
    z.object({
      jdTerm: z.string(),
      severity: z.enum(["blocking", "significant", "minor"]),
      note: z.string(),
    }),
  ),
  transferable: z.array(
    z.object({
      jdTerm: z.string(),
      sourceIds: z.array(z.string()),
      rationale: z.string(),
    }),
  ),
  missingKeywords: z.array(z.string()).describe("Truthfully unclaimable keywords — reported, never inserted"),
  recoverableKeywords: z
    .array(z.string())
    .describe("Present in the resume but under-surfaced; safe to foreground"),
  emphasize: z.array(z.object({ sourceId: z.string(), reason: z.string() })),
  deemphasize: z.array(z.object({ sourceId: z.string(), reason: z.string() })),
  recruiterConcerns: z.array(z.string()),
  atsRejectionRisks: z.array(z.string()),
});

export type GapAnalysis = z.infer<typeof GapAnalysisSchema>;

/* ------------------------------------------------------------------ *
 * Layer 4 — TailoredResume. Every rewritten line cites the fact ids it
 * was derived from; the truth guard verifies those citations mechanically.
 * ------------------------------------------------------------------ */

export const TailoredBulletSchema = z.object({
  text: z.string(),
  sourceIds: z.array(z.string()).describe("Ids from ResumeFacts this line is derived from. Never empty."),
  keywords: z.array(z.string()).describe("JD keywords this line legitimately carries"),
});

export const TailoredResumeSchema = z.object({
  headline: z.string().describe("Target-role-aligned title line, truthful to current level"),
  summary: z.object({
    text: z.string().describe("2-4 lines: who, specialisation, stack, level, fit for this role"),
    sourceIds: z.array(z.string()),
  }),
  skills: z.array(
    z.object({
      category: z.string(),
      items: z.array(z.string()),
      sourceIds: z.array(z.string()),
    }),
  ),
  experience: z.array(
    z.object({
      sourceId: z.string().describe("The ExperienceFact id this block maps to"),
      company: z.string(),
      title: z.string(),
      location: z.string().nullable(),
      startDate: z.string(),
      endDate: z.string(),
      bullets: z.array(TailoredBulletSchema),
    }),
  ),
  projects: z.array(
    z.object({
      sourceId: z.string(),
      name: z.string(),
      url: z.string().nullable(),
      bullets: z.array(TailoredBulletSchema),
    }),
  ),
  education: z.array(
    z.object({
      sourceId: z.string(),
      institution: z.string(),
      degree: z.string(),
      dates: z.string().nullable(),
    }),
  ),
  certifications: z.array(z.object({ sourceId: z.string(), text: z.string() })),
  sectionOrder: z
    .array(z.string())
    .describe("Section keys in render order, most JD-relevant first"),
  rewriteNotes: z.array(z.string()).describe("What was emphasised, reordered, or cut, and why"),
});

export type TailoredResume = z.infer<typeof TailoredResumeSchema>;

/* ------------------------------------------------------------------ *
 * Layer 5 — ATS report and application strategy
 * ------------------------------------------------------------------ */

export const AtsReportSchema = z.object({
  atsScore: z.number().describe("0-100, expert estimate — not a commercial ATS reading"),
  keywordMatchPct: z.number(),
  technicalSkillMatch: z.number(),
  experienceMatch: z.number(),
  responsibilityMatch: z.number(),
  recruiterAppeal: z.number(),
  missingKeywords: z.array(z.string()),
  atsRisks: z.array(z.string()),
  topImprovements: z.array(z.object({ change: z.string(), impact: z.string() })),
});

export const StrategySchema = z.object({
  shouldApply: z.enum(["yes", "yes_with_caveats", "probably_not"]),
  fitEstimate: z.string(),
  biggestStrength: z.string(),
  biggestGap: z.string(),
  interviewEmphasis: z.array(z.string()),
  coverLetterWorthwhile: z.boolean(),
  coverLetterRationale: z.string(),
  outreachAngle: z.string(),
});

export const AtsReportWithStrategySchema = z.object({
  report: AtsReportSchema,
  strategy: StrategySchema,
});

export type AtsReport = z.infer<typeof AtsReportSchema>;
export type Strategy = z.infer<typeof StrategySchema>;

/* ------------------------------------------------------------------ *
 * Truth guard output (produced deterministically, not by the model)
 * ------------------------------------------------------------------ */

export type TruthViolation = {
  code:
    | "UNSOURCED_LINE"
    | "UNKNOWN_SOURCE_ID"
    | "UNSOURCED_METRIC"
    | "UNSOURCED_TECH"
    | "ALTERED_EMPLOYER_FACT";
  severity: "error" | "warning";
  location: string;
  detail: string;
  offending: string;
};

export type TruthReport = {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  violations: TruthViolation[];
};
