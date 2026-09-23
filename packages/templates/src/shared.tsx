/**
 * The pieces every template shares.
 *
 * Templates differ in layout and in how tightly they are set. They must not
 * differ in what they consider present: one empty-field rule, applied here,
 * is what stops a sparse resume rendering a dangling separator in one
 * template and a bare heading in another.
 *
 * Nothing in this file holds state, reads the DOM, or touches a browser-only
 * API. A template must render byte-identically in React DOM and in headless
 * Chromium, so every decision is a pure function of the document.
 */

import type { ReactNode } from "react";
import { SECTION_KEYS, type ResumeDoc, type SectionKey, type TailoredBullet } from "./types";

/* ------------------------------------------------------------- presence -- */

/** Absent means the empty string in this domain, never null. Whitespace too. */
export function has(value: string | undefined | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function clean(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Bullets carrying no text are dropped before anything counts them. */
export function liveBullets(bullets: TailoredBullet[] | undefined): TailoredBullet[] {
  return (bullets ?? []).filter((b) => has(b?.text));
}

/* -------------------------------------------------------------- content -- */

/**
 * Whether a section has anything worth a heading.
 *
 * A heading over nothing is the single most common way a generated resume
 * looks broken, so emptiness is decided here and the templates only ask.
 */
export function sectionHasContent(doc: ResumeDoc, key: SectionKey): boolean {
  switch (key) {
    case "summary":
      return has(doc.summary?.text);
    case "skills":
      return (doc.skills ?? []).some((g) => has(g.category) && (g.items ?? []).some(has));
    case "experience":
      return (doc.experience ?? []).some((e) => has(e.company) || has(e.title));
    case "projects":
      return (doc.projects ?? []).some((p) => has(p.name));
    case "education":
      return (doc.education ?? []).some((e) => has(e.institution) || has(e.degree));
    case "certifications":
      return (doc.certifications ?? []).some((c) => has(c.text));
  }
}

/**
 * The sections to render, in order.
 *
 * `section_order` is the tailoring model's judgement about what this employer
 * should read first, so it wins. Anything it forgot is appended in the default
 * sequence rather than dropped, unknown keys are ignored, and duplicates
 * collapse. Empty sections never reach a template.
 */
export function orderedSections(doc: ResumeDoc): SectionKey[] {
  const known = new Set<string>(SECTION_KEYS);
  const seen = new Set<SectionKey>();
  const out: SectionKey[] = [];

  for (const raw of doc.section_order ?? []) {
    const key = clean(raw).toLowerCase() as SectionKey;
    if (!known.has(key) || seen.has(key)) continue;
    seen.add(key);
    if (sectionHasContent(doc, key)) out.push(key);
  }
  for (const key of SECTION_KEYS) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (sectionHasContent(doc, key)) out.push(key);
  }
  return out;
}

/** Sections carried through from the source resume that the fixed fields miss. */
export function extraSections(doc: ResumeDoc) {
  return (doc.other_sections ?? [])
    .map((s) => ({ ...s, bullets: liveBullets(s.bullets) }))
    .filter((s) => has(s.heading) && s.bullets.length > 0);
}

export const SECTION_TITLES: Record<SectionKey, string> = {
  summary: "Summary",
  skills: "Skills",
  experience: "Experience",
  projects: "Projects",
  education: "Education",
  certifications: "Certifications",
};

/* ------------------------------------------------------------ fragments -- */

/**
 * A date range, with the separator omitted when only one end is known.
 * "Jun 2023 - Present", "Jun 2023", "Present", or nothing at all.
 */
export function dateRange(start: string, end: string): string {
  const a = clean(start);
  const b = clean(end);
  if (a && b) return `${a} - ${b}`;
  return a || b;
}

/** Strips the scheme and any www. so a printed URL reads as a label. */
export function bareUrl(url: string): string {
  return clean(url).replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

/** A link is only a link if it has somewhere to go. */
export function href(url: string): string {
  const u = clean(url);
  if (!u) return "";
  return /^(https?:|mailto:|tel:)/i.test(u) ? u : `https://${u}`;
}

export function SectionHeading({ children }: { children: string }) {
  return <h2 className="rz-h2">{children}</h2>;
}

/**
 * A section wrapper that refuses to render its heading over nothing.
 * `children` is only consulted after the caller has already established there
 * is content, but the title guard costs nothing and removes a whole class of
 * bug.
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  if (!has(title)) return null;
  return (
    <section className="rz-section">
      <SectionHeading>{title}</SectionHeading>
      {children}
    </section>
  );
}

/** An unordered list of bullet text. Markers come from CSS, never from text. */
export function Bullets({ bullets }: { bullets: TailoredBullet[] }) {
  const live = liveBullets(bullets);
  if (live.length === 0) return null;
  return (
    <ul className="rz-bullets">
      {live.map((b, i) => (
        <li key={i}>{clean(b.text)}</li>
      ))}
    </ul>
  );
}

/**
 * The contact line.
 *
 * Separators are drawn by CSS on `li + li`, so there can never be a leading or
 * trailing one, and the text content stays ASCII for the ATS reading the DOM.
 */
export function ContactLine({ doc, className = "" }: { doc: ResumeDoc; className?: string }) {
  const c = doc.contact;
  const items: ReactNode[] = [];

  if (has(c?.location)) items.push(<li key="loc">{clean(c.location)}</li>);
  if (has(c?.email))
    items.push(
      <li key="email">
        <a href={`mailto:${clean(c.email)}`}>{clean(c.email)}</a>
      </li>,
    );
  if (has(c?.phone))
    items.push(
      <li key="phone">
        <a href={`tel:${clean(c.phone).replace(/[^\d+]/g, "")}`}>{clean(c.phone)}</a>
      </li>,
    );
  for (const [i, link] of (c?.links ?? []).entries()) {
    if (!has(link?.url)) continue;
    const label = has(link.label) ? clean(link.label) : bareUrl(link.url);
    if (!label) continue;
    items.push(
      <li key={`link-${i}`}>
        <a href={href(link.url)}>{label}</a>
      </li>,
    );
  }

  if (items.length === 0) return null;
  return <ul className={`rz-contact ${className}`.trim()}>{items}</ul>;
}
