/**
 * The canonical document a template renders.
 *
 * It is the backend's `TailoredResume` (backend/src/atsresume/models.py) with
 * one addition: `contact`. Contact details live on `ResumeFacts` in the
 * pipeline, because they are claimed facts rather than tailored copy, but a
 * template cannot draw a header without them. Joining the two at the render
 * boundary keeps the pipeline's separation intact and still gives the template
 * exactly one prop.
 *
 * Field names stay snake_case so a payload can go from the API straight into a
 * component with no mapping layer to keep in sync.
 */

import type { ComponentType } from "react";

export type Link = { label: string; url: string };

export type Contact = {
  name: string;
  /** Empty string when absent. The backend never sends null. */
  email: string;
  phone: string;
  location: string;
  links: Link[];
};

export type TailoredBullet = {
  text: string;
  source_ids: string[];
  keywords: string[];
};

export type TailoredSummary = {
  text: string;
  source_ids: string[];
};

export type TailoredSkillGroup = {
  category: string;
  items: string[];
  source_ids: string[];
};

export type TailoredExperience = {
  source_id: string;
  company: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string;
  bullets: TailoredBullet[];
};

export type TailoredProject = {
  source_id: string;
  name: string;
  url: string;
  bullets: TailoredBullet[];
};

export type TailoredEducation = {
  source_id: string;
  institution: string;
  degree: string;
  dates: string;
};

export type TailoredCertification = {
  source_id: string;
  text: string;
};

export type TailoredOtherSection = {
  source_id: string;
  heading: string;
  bullets: TailoredBullet[];
};

/** The section keys `section_order` may contain, in the default sequence. */
export const SECTION_KEYS = [
  "summary",
  "skills",
  "experience",
  "projects",
  "education",
  "certifications",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export type ResumeDoc = {
  contact: Contact;
  headline: string;
  summary: TailoredSummary;
  skills: TailoredSkillGroup[];
  experience: TailoredExperience[];
  projects: TailoredProject[];
  education: TailoredEducation[];
  certifications: TailoredCertification[];
  other_sections: TailoredOtherSection[];
  /** Section keys in render order, most JD-relevant first. May be empty. */
  section_order: string[];
  rewrite_notes: string[];
};

/**
 * 0 is the roomiest rung of the density ladder, 4 the tightest. The rungs are
 * defined once in print.css and ported from the backend's density.py, which
 * spends the shrink budget on margins, then block gaps, then leading, and only
 * then on body type.
 */
export type Density = 0 | 1 | 2 | 3 | 4;

export type TemplateProps = {
  doc: ResumeDoc;
  density?: Density;
};

export type TemplateComponent = ComponentType<TemplateProps>;

export type TemplateCategory = "ats" | "simple" | "two-column";

/** What the picker needs to describe a template honestly. */
export type Template = {
  id: string;
  name: string;
  blurb: string;
  categories: TemplateCategory[];
  columns: 1 | 2;
  /** False means real parsers are known to mis-read it. Say so, do not hide it. */
  atsSafe: boolean;
  component: TemplateComponent;
  /** Shown whenever `atsSafe` is false. */
  warning?: string;
};

/** Alias kept because the registry reads better as a map of metadata. */
export type TemplateMeta = Template;
