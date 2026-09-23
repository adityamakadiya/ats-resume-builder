/**
 * Modern: sidebar left, main column right.
 *
 * The sidebar carries the things a reader looks up rather than reads: who you
 * are, how to reach you, what you know, where you studied. The main column
 * carries the argument: summary, experience, projects.
 *
 * Two decisions worth stating.
 *
 * The DOM order is sidebar then main, matching what the eye sees. A parser
 * reading straight down therefore meets the name first and the experience
 * after the skills, which is a real cost and is why the registry marks this
 * template atsSafe:false and says so to the candidate instead of burying it.
 *
 * `section_order` still decides sequence, but only within a column: the
 * document's judgement about what matters most is respected, while the layout
 * decides which column a section belongs to. A two-column resume that shuffled
 * education into the main column because the model happened to rank it second
 * would not be a layout at all.
 */

import { ContactLine, Section, SECTION_TITLES, clean, extraSections, has, orderedSections } from "../shared";
import { OtherSectionBody, SectionBody } from "../sections";
import type { SectionKey, TemplateProps } from "../types";

const ASIDE: ReadonlySet<SectionKey> = new Set<SectionKey>(["skills", "education", "certifications"]);

export function Modern({ doc, density = 0 }: TemplateProps) {
  const sections = orderedSections(doc);
  const aside = sections.filter((key) => ASIDE.has(key));
  const main = sections.filter((key) => !ASIDE.has(key));
  const extras = extraSections(doc);
  const name = clean(doc.contact?.name);
  const headline = clean(doc.headline);

  return (
    <article className="rz rz--modern" data-density={density} data-template="modern">
      <div className="rz-cols">
        <aside className="rz-aside">
          <header className="rz-header">
            {has(name) ? <h1 className="rz-name">{name}</h1> : null}
            {has(headline) ? <p className="rz-headline">{headline}</p> : null}
            <ContactLine doc={doc} className="rz-contact--stacked" />
          </header>

          {aside.map((key) => (
            <Section key={key} title={SECTION_TITLES[key]}>
              <SectionBody doc={doc} section={key} stackedSkills />
            </Section>
          ))}
        </aside>

        <div className="rz-main">
          {main.map((key) => (
            <Section key={key} title={SECTION_TITLES[key]}>
              <SectionBody doc={doc} section={key} />
            </Section>
          ))}

          {extras.map((section) => (
            <Section key={section.source_id || section.heading} title={clean(section.heading)}>
              <OtherSectionBody bullets={section.bullets} />
            </Section>
          ))}
        </div>
      </div>
    </article>
  );
}

export default Modern;
