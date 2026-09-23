/**
 * Zod mirrors of `backend/src/atsresume/models.py`.
 *
 * Two conventions are carried over verbatim from that file and must not drift:
 *
 * 1. Absent means the empty string, never `null`. Anthropic's strict JSON
 *    schema mode requires every property in `required`, so "optional" has to
 *    mean present-but-empty. There are no nullable unions here on purpose.
 * 2. Every field has a default, so `Schema.parse({})`-shaped input from a
 *    partial document still yields a complete object. The one exception is
 *    `SourceDocument.style`, which models.py declares as `StyleProfile | None`.
 *
 * NESTED OBJECT DEFAULTS USE `.prefault({})`, NOT `.default({})`.
 *
 * Zod 3 parsed the value handed to `.default()`, so `.default({})` on an
 * object schema filled in that object's own defaults. Zod 4 returns the
 * value as given. Under `.default({})` on Zod 4, `facts.contact` comes back
 * as `{}` while TypeScript still types it as a full Contact, so
 * `facts.contact.name.trim()` typechecks and throws at runtime on exactly
 * the documents where a field was missing, which is to say the ones the
 * defaults existed for. `.prefault()` is Zod 4's parse-the-default, and it
 * restores the behaviour models.py has always had.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Layer 1 — ResumeFacts                                              */
/* ------------------------------------------------------------------ */

const str = (d = '') => z.string().default(d);

export const LinkSchema = z.object({
  label: str(),
  url: str(),
});

export const ContactSchema = z.object({
  name: str(),
  email: str(),
  phone: str(),
  location: str(),
  links: z.array(LinkSchema).default([]),
});

export const BulletSchema = z.object({
  id: str(),
  text: str(),
});
const BulletItemSchema = BulletSchema;

export const ExperienceFactSchema = z.object({
  id: str(),
  company: str(),
  title: str(),
  location: str(),
  start_date: str(),
  end_date: str(),
  bullets: z.array(BulletItemSchema).default([]),
  tech: z.array(z.string()).default([]),
});

export const ProjectFactSchema = z.object({
  id: str(),
  name: str(),
  description: str(),
  url: str(),
  bullets: z.array(BulletItemSchema).default([]),
  tech: z.array(z.string()).default([]),
});

export const EducationFactSchema = z.object({
  id: str(),
  institution: str(),
  degree: str(),
  dates: str(),
  details: str(),
});

export const SkillGroupSchema = z.object({
  id: str(),
  category: str(),
  items: z.array(z.string()).default([]),
});

export const CertificationSchema = z.object({
  id: str(),
  text: str(),
});

export const OtherSectionSchema = z.object({
  id: str(),
  heading: str(),
  bullets: z.array(BulletItemSchema).default([]),
});

export const ResumeFactsSchema = z.object({
  contact: ContactSchema.prefault({}),
  headline: str(),
  summary: str(),
  experience: z.array(ExperienceFactSchema).default([]),
  projects: z.array(ProjectFactSchema).default([]),
  education: z.array(EducationFactSchema).default([]),
  skills: z.array(SkillGroupSchema).default([]),
  certifications: z.array(CertificationSchema).default([]),
  other_sections: z.array(OtherSectionSchema).default([]),
  total_years_experience: z.number().default(0),
});

/* ------------------------------------------------------------------ */
/* Layer 2 — JobSpec                                                  */
/* ------------------------------------------------------------------ */

export const RequirementCategoryValues = [
  'language',
  'framework',
  'database',
  'cloud_devops',
  'system_design',
  'architecture',
  'ai_ml',
  'testing',
  'security',
  'domain',
  'soft_skill',
  'tooling',
  'other',
] as const;

export const RequirementCategorySchema = z.enum(RequirementCategoryValues).default('other');

export const ImportanceValues = ['required', 'preferred'] as const;
export const ImportanceSchema = z.enum(ImportanceValues).default('required');
export const Importance = { REQUIRED: 'required', PREFERRED: 'preferred' } as const;

export const RequirementSchema = z.object({
  term: str(),
  category: RequirementCategorySchema,
  importance: ImportanceSchema,
  evidence: str(),
});

export const KeywordSchema = z.object({
  term: str(),
  variants: z.array(z.string()).default([]),
  weight: z.number().int().default(1),
});

export const ExperienceYearsSchema = z.object({
  min: z.number().default(0),
  max: z.number().default(0),
  raw: str(),
});

export const WorkModeValues = ['onsite', 'hybrid', 'remote', 'unspecified'] as const;
export const WorkModeSchema = z.enum(WorkModeValues).default('unspecified');

export const ConfidenceValues = ['high', 'medium', 'low'] as const;
export const ConfidenceSchema = z.enum(ConfidenceValues).default('high');

export const ImplicitRequirementSchema = z.object({
  requirement: str(),
  rationale: str(),
});

export const JobSpecSchema = z.object({
  company: str(),
  title: str(),
  location: str(),
  work_mode: WorkModeSchema,
  employment_type: str(),
  experience_years: ExperienceYearsSchema.prefault({}),
  requirements: z.array(RequirementSchema).default([]),
  responsibilities: z.array(z.string()).default([]),
  keywords: z.array(KeywordSchema).default([]),
  implicit_requirements: z.array(ImplicitRequirementSchema).default([]),
  compensation: str(),
  extraction_confidence: ConfidenceSchema,
  extraction_notes: str(),
});

/** Every term this JD will be matched on, including keyword variants. */
export function allTerms(job: JobSpec): string[] {
  const terms = job.requirements.map((r) => r.term);
  for (const kw of job.keywords) {
    terms.push(kw.term);
    terms.push(...kw.variants);
  }
  return terms;
}

/* ------------------------------------------------------------------ */
/* Layer 3 — Gap analysis                                             */
/* ------------------------------------------------------------------ */

export const SeverityValues = ['blocking', 'significant', 'minor'] as const;
export const SeveritySchema = z.enum(SeverityValues).default('minor');

export const MatchSchema = z.object({
  jd_term: str(),
  source_ids: z.array(z.string()).default([]),
  note: str(),
});

export const MissingItemSchema = z.object({
  jd_term: str(),
  severity: SeveritySchema,
  note: str(),
});

export const EmphasisSchema = z.object({
  source_id: str(),
  reason: str(),
});

export const GapAnalysisSchema = z.object({
  strong_matches: z.array(MatchSchema).default([]),
  partial_matches: z.array(MatchSchema).default([]),
  transferable: z.array(MatchSchema).default([]),
  missing: z.array(MissingItemSchema).default([]),
  missing_keywords: z.array(z.string()).default([]),
  recoverable_keywords: z.array(z.string()).default([]),
  emphasize: z.array(EmphasisSchema).default([]),
  deemphasize: z.array(EmphasisSchema).default([]),
  recruiter_concerns: z.array(z.string()).default([]),
  ats_rejection_risks: z.array(z.string()).default([]),
});

/* ------------------------------------------------------------------ */
/* Layer 4 — TailoredResume                                           */
/* ------------------------------------------------------------------ */

export const TailoredBulletSchema = z.object({
  text: str(),
  source_ids: z.array(z.string()).default([]),
  keywords: z.array(z.string()).default([]),
});

export const TailoredSummarySchema = z.object({
  text: str(),
  source_ids: z.array(z.string()).default([]),
});

export const TailoredSkillGroupSchema = z.object({
  category: str(),
  items: z.array(z.string()).default([]),
  source_ids: z.array(z.string()).default([]),
});

export const TailoredExperienceSchema = z.object({
  source_id: str(),
  company: str(),
  title: str(),
  location: str(),
  start_date: str(),
  end_date: str(),
  bullets: z.array(TailoredBulletSchema).default([]),
});

export const TailoredProjectSchema = z.object({
  source_id: str(),
  name: str(),
  url: str(),
  bullets: z.array(TailoredBulletSchema).default([]),
});

export const TailoredEducationSchema = z.object({
  source_id: str(),
  institution: str(),
  degree: str(),
  dates: str(),
});

export const TailoredCertificationSchema = z.object({
  source_id: str(),
  text: str(),
});

export const TailoredOtherSectionSchema = z.object({
  source_id: str(),
  heading: str(),
  bullets: z.array(TailoredBulletSchema).default([]),
});

export const TailoredResumeSchema = z.object({
  headline: str(),
  summary: TailoredSummarySchema.prefault({}),
  skills: z.array(TailoredSkillGroupSchema).default([]),
  experience: z.array(TailoredExperienceSchema).default([]),
  projects: z.array(TailoredProjectSchema).default([]),
  education: z.array(TailoredEducationSchema).default([]),
  certifications: z.array(TailoredCertificationSchema).default([]),
  other_sections: z.array(TailoredOtherSectionSchema).default([]),
  section_order: z.array(z.string()).default([]),
  rewrite_notes: z.array(z.string()).default([]),
});

/** `(location, text, source_ids)` for every rewritten line. Used by the guard. */
export function allLines(doc: TailoredResume): Array<[string, string, string[]]> {
  const out: Array<[string, string, string[]]> = [];
  if (doc.summary.text) out.push(['Summary', doc.summary.text, doc.summary.source_ids]);
  for (const g of doc.skills) {
    out.push([`Skills / ${g.category}`, g.items.join(', '), g.source_ids]);
  }
  for (const exp of doc.experience) {
    exp.bullets.forEach((b, i) => {
      out.push([`Experience / ${exp.company} / bullet ${i + 1}`, b.text, b.source_ids]);
    });
  }
  for (const proj of doc.projects) {
    proj.bullets.forEach((b, i) => {
      out.push([`Project / ${proj.name} / bullet ${i + 1}`, b.text, b.source_ids]);
    });
  }
  for (const sec of doc.other_sections) {
    sec.bullets.forEach((b, i) => {
      out.push([`${sec.heading} / bullet ${i + 1}`, b.text, b.source_ids]);
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Layer 5 — Scoring and strategy                                     */
/* ------------------------------------------------------------------ */

export const SubScoresSchema = z.object({
  keyword_match: z.number().default(0),
  skills_coverage: z.number().default(0),
  section_completeness: z.number().default(0),
  experience_match: z.number().default(0),
  evidence_density: z.number().default(0),
  specificity: z.number().default(0),
  relevance_gate: z.number().default(1),
  penalty: z.number().default(0),
});

export const AtsReportSchema = z.object({
  overall: z.number().default(0),
  sub_scores: SubScoresSchema.prefault({}),
  matched_keywords: z.array(z.string()).default([]),
  missing_keywords: z.array(z.string()).default([]),
  recoverable_keywords: z.array(z.string()).default([]),
  recommendations: z.array(z.string()).default([]),
});

export const ApplyVerdictValues = ['yes', 'yes_with_caveats', 'probably_not'] as const;
export const ApplyVerdictSchema = z.enum(ApplyVerdictValues).default('yes_with_caveats');

export const StrategySchema = z.object({
  should_apply: ApplyVerdictSchema,
  fit_estimate: str(),
  biggest_strength: str(),
  biggest_gap: str(),
  interview_emphasis: z.array(z.string()).default([]),
  cover_letter_worthwhile: z.boolean().default(false),
  cover_letter_rationale: str(),
  outreach_angle: str(),
  top_improvements: z.array(z.string()).default([]),
});

/* ------------------------------------------------------------------ */
/* Truth guard                                                        */
/* ------------------------------------------------------------------ */

export const ViolationCodeValues = [
  'UNSOURCED_LINE',
  'UNKNOWN_SOURCE_ID',
  'UNSOURCED_METRIC',
  'UNSOURCED_TECH',
  'ALTERED_EMPLOYER_FACT',
  'DUPLICATED_METRIC',
  'UNSUPPORTED_CLAIM',
] as const;
export const ViolationCodeSchema = z.enum(ViolationCodeValues).default('UNSOURCED_LINE');

export const TruthViolationSchema = z.object({
  code: ViolationCodeSchema,
  severity: str('error'),
  location: str(),
  detail: str(),
  offending: str(),
});

export const TruthReportSchema = z.object({
  passed: z.boolean().default(false),
  error_count: z.number().int().default(0),
  warning_count: z.number().int().default(0),
  violations: z.array(TruthViolationSchema).default([]),
});

/* ------------------------------------------------------------------ */
/* Ingest                                                             */
/* ------------------------------------------------------------------ */

export const MarginsSchema = z.object({
  top: z.number().default(0),
  right: z.number().default(0),
  bottom: z.number().default(0),
  left: z.number().default(0),
});

export const FontSizesSchema = z.object({
  name: z.number().default(0),
  heading: z.number().default(0),
  body: z.number().default(0),
  small: z.number().default(0),
});

export const ColumnBandSchema = z.object({
  start: z.number().default(0),
  end: z.number().default(0),
});

export const StyleProfileSchema = z.object({
  page_width: z.number().default(0),
  page_height: z.number().default(0),
  margins: MarginsSchema.prefault({}),
  column_count: z.number().int().default(1),
  column_bands: z.array(ColumnBandSchema).default([]),
  font_sizes: FontSizesSchema.prefault({}),
  body_line_height: z.number().default(0),
  bullet_glyph: str('•'),
  accent_color: str(),
  serif: z.boolean().default(false),
  fonts: z.array(z.string()).default([]),
});

export const SourceKindValues = ['pdf', 'docx', 'text'] as const;
export const SourceKindSchema = z.enum(SourceKindValues).default('text');

export const SourceDocumentSchema = z.object({
  kind: SourceKindSchema,
  raw_text: str(),
  page_count: z.number().int().default(0),
  // models.py declares `StyleProfile | None`; this is the one nullable field.
  style: StyleProfileSchema.nullable().default(null),
  notes: z.array(z.string()).default([]),
});

/* ------------------------------------------------------------------ */
/* Inferred types                                                     */
/* ------------------------------------------------------------------ */

export type Bullet = z.infer<typeof BulletItemSchema>;
export type Link = z.infer<typeof LinkSchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type ExperienceFact = z.infer<typeof ExperienceFactSchema>;
export type ProjectFact = z.infer<typeof ProjectFactSchema>;
export type EducationFact = z.infer<typeof EducationFactSchema>;
export type SkillGroup = z.infer<typeof SkillGroupSchema>;
export type Certification = z.infer<typeof CertificationSchema>;
export type OtherSection = z.infer<typeof OtherSectionSchema>;
export type ResumeFacts = z.infer<typeof ResumeFactsSchema>;

export type RequirementCategory = (typeof RequirementCategoryValues)[number];
export type ImportanceValue = (typeof ImportanceValues)[number];
export type Requirement = z.infer<typeof RequirementSchema>;
export type Keyword = z.infer<typeof KeywordSchema>;
export type ExperienceYears = z.infer<typeof ExperienceYearsSchema>;
export type WorkMode = (typeof WorkModeValues)[number];
export type Confidence = (typeof ConfidenceValues)[number];
export type ImplicitRequirement = z.infer<typeof ImplicitRequirementSchema>;
export type JobSpec = z.infer<typeof JobSpecSchema>;

export type Severity = (typeof SeverityValues)[number];
export type Match = z.infer<typeof MatchSchema>;
export type MissingItem = z.infer<typeof MissingItemSchema>;
export type Emphasis = z.infer<typeof EmphasisSchema>;
export type GapAnalysis = z.infer<typeof GapAnalysisSchema>;

export type TailoredBullet = z.infer<typeof TailoredBulletSchema>;
export type TailoredSummary = z.infer<typeof TailoredSummarySchema>;
export type TailoredSkillGroup = z.infer<typeof TailoredSkillGroupSchema>;
export type TailoredExperience = z.infer<typeof TailoredExperienceSchema>;
export type TailoredProject = z.infer<typeof TailoredProjectSchema>;
export type TailoredEducation = z.infer<typeof TailoredEducationSchema>;
export type TailoredCertification = z.infer<typeof TailoredCertificationSchema>;
export type TailoredOtherSection = z.infer<typeof TailoredOtherSectionSchema>;
export type TailoredResume = z.infer<typeof TailoredResumeSchema>;

export type SubScores = z.infer<typeof SubScoresSchema>;
export type AtsReport = z.infer<typeof AtsReportSchema>;
export type ApplyVerdict = (typeof ApplyVerdictValues)[number];
export type Strategy = z.infer<typeof StrategySchema>;

export type ViolationCode = (typeof ViolationCodeValues)[number];
export type TruthViolation = z.infer<typeof TruthViolationSchema>;
export type TruthReport = z.infer<typeof TruthReportSchema>;

export type Margins = z.infer<typeof MarginsSchema>;
export type FontSizes = z.infer<typeof FontSizesSchema>;
export type ColumnBand = z.infer<typeof ColumnBandSchema>;
export type StyleProfile = z.infer<typeof StyleProfileSchema>;
export type SourceKind = (typeof SourceKindValues)[number];
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;

export { toJsonSchema, strictSchema } from './json-schema.js';
export type { JsonSchema } from './json-schema.js';
