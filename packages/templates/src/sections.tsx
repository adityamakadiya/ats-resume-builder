/**
 * Section bodies, shared by all three templates.
 *
 * The three templates differ in layout and in how tightly they are set. They
 * must not differ in what a section says, or the same document would read as
 * two different resumes depending on which one the candidate picked. So the
 * markup lives here once and the templates decide only where it goes.
 */

import {
  Bullets,
  bareUrl,
  clean,
  dateRange,
  has,
  href,
  liveBullets,
} from "./shared";
import type { ResumeDoc, SectionKey } from "./types";

export function SummaryBody({ doc }: { doc: ResumeDoc }) {
  const text = clean(doc.summary?.text);
  if (!text) return null;
  return <p className="rz-summary">{text}</p>;
}

export function SkillsBody({ doc, stacked = false }: { doc: ResumeDoc; stacked?: boolean }) {
  const groups = (doc.skills ?? [])
    .map((g) => ({ category: clean(g.category), items: (g.items ?? []).map(clean).filter(Boolean) }))
    .filter((g) => g.category && g.items.length > 0);
  if (groups.length === 0) return null;

  return (
    <dl className={stacked ? "rz-skills rz-skills--stacked" : "rz-skills"}>
      {groups.map((g, i) => (
        <div className="rz-skill-row" key={i}>
          <dt>{g.category}</dt>
          <dd>{g.items.join(", ")}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ExperienceBody({ doc }: { doc: ResumeDoc }) {
  const roles = (doc.experience ?? []).filter((e) => has(e.company) || has(e.title));
  if (roles.length === 0) return null;

  return (
    <div className="rz-entries">
      {roles.map((role, i) => {
        const dates = dateRange(role.start_date, role.end_date);
        const company = clean(role.company);
        const title = clean(role.title);
        const location = clean(role.location);
        // Whichever of the two the document actually has leads the block, so
        // a role missing a company never renders a blank heading.
        const lead = company || title;
        const second = company && title ? title : "";

        return (
          <article className="rz-entry" key={role.source_id || i}>
            <div className="rz-entry-line">
              <h3 className="rz-entry-title">{lead}</h3>
              {dates ? <span className="rz-dates">{dates}</span> : null}
            </div>
            {second || location ? (
              <div className="rz-entry-line rz-entry-line--sub">
                {second ? <span className="rz-entry-org">{second}</span> : null}
                {location ? <span className="rz-dates">{location}</span> : null}
              </div>
            ) : null}
            <Bullets bullets={role.bullets ?? []} />
          </article>
        );
      })}
    </div>
  );
}

export function ProjectsBody({ doc }: { doc: ResumeDoc }) {
  const projects = (doc.projects ?? []).filter((p) => has(p.name));
  if (projects.length === 0) return null;

  return (
    <div className="rz-entries">
      {projects.map((project, i) => {
        const label = bareUrl(project.url);
        return (
          <article className="rz-entry" key={project.source_id || i}>
            <div className="rz-entry-line">
              <h3 className="rz-entry-title">{clean(project.name)}</h3>
              {label ? (
                <span className="rz-dates">
                  <a href={href(project.url)}>{label}</a>
                </span>
              ) : null}
            </div>
            <Bullets bullets={project.bullets ?? []} />
          </article>
        );
      })}
    </div>
  );
}

export function EducationBody({ doc }: { doc: ResumeDoc }) {
  const entries = (doc.education ?? []).filter((e) => has(e.institution) || has(e.degree));
  if (entries.length === 0) return null;

  return (
    <div className="rz-entries">
      {entries.map((edu, i) => {
        const institution = clean(edu.institution);
        const degree = clean(edu.degree);
        const dates = clean(edu.dates);
        const lead = institution || degree;
        const second = institution && degree ? degree : "";

        return (
          <article className="rz-entry" key={edu.source_id || i}>
            <div className="rz-entry-line">
              <h3 className="rz-entry-title">{lead}</h3>
              {dates ? <span className="rz-dates">{dates}</span> : null}
            </div>
            {second ? <p className="rz-edu-degree">{second}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

export function CertificationsBody({ doc }: { doc: ResumeDoc }) {
  const items = (doc.certifications ?? []).map((c) => clean(c.text)).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <ul className="rz-plain">
      {items.map((text, i) => (
        <li key={i}>{text}</li>
      ))}
    </ul>
  );
}

/** Publications, Open Source, Leadership: whatever the source resume carried. */
export function OtherSectionBody({ bullets }: { bullets: ResumeDoc["other_sections"][number]["bullets"] }) {
  const live = liveBullets(bullets);
  if (live.length === 0) return null;
  return (
    <ul className="rz-plain">
      {live.map((b, i) => (
        <li key={i}>{clean(b.text)}</li>
      ))}
    </ul>
  );
}

/** The body for one fixed section key, or null when there is nothing to show. */
export function SectionBody({
  doc,
  section,
  stackedSkills = false,
}: {
  doc: ResumeDoc;
  section: SectionKey;
  stackedSkills?: boolean;
}) {
  switch (section) {
    case "summary":
      return <SummaryBody doc={doc} />;
    case "skills":
      return <SkillsBody doc={doc} stacked={stackedSkills} />;
    case "experience":
      return <ExperienceBody doc={doc} />;
    case "projects":
      return <ProjectsBody doc={doc} />;
    case "education":
      return <EducationBody doc={doc} />;
    case "certifications":
      return <CertificationsBody doc={doc} />;
  }
}
