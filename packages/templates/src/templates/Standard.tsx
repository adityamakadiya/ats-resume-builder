/**
 * Standard: one column, roomy, conservative.
 *
 * The safest thing to put in front of a parser and the default for anyone who
 * has not formed an opinion. Name set large but not loud, a rule under the
 * header, a hairline rule under every section heading, and dates right
 * aligned on the employer's own line so the eye can read the career as a
 * column of dates without reading the prose.
 */

import { ContactLine, Section, SECTION_TITLES, clean, extraSections, has, orderedSections } from "../shared";
import { OtherSectionBody, SectionBody } from "../sections";
import type { TemplateProps } from "../types";

export function Standard({ doc, density = 0 }: TemplateProps) {
  const sections = orderedSections(doc);
  const extras = extraSections(doc);
  const name = clean(doc.contact?.name);
  const headline = clean(doc.headline);

  return (
    <article className="rz rz--standard" data-density={density} data-template="standard">
      <header className="rz-header">
        {has(name) ? <h1 className="rz-name">{name}</h1> : null}
        {has(headline) ? <p className="rz-headline">{headline}</p> : null}
        <ContactLine doc={doc} />
      </header>

      {sections.map((key) => (
        <Section key={key} title={SECTION_TITLES[key]}>
          <SectionBody doc={doc} section={key} />
        </Section>
      ))}

      {extras.map((section) => (
        <Section key={section.source_id || section.heading} title={clean(section.heading)}>
          <OtherSectionBody bullets={section.bullets} />
        </Section>
      ))}
    </article>
  );
}

export default Standard;
