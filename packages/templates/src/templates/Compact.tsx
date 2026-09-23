/**
 * Compact: the same skeleton as Standard, set tighter.
 *
 * Deliberately not a different design. Someone with nine years and four
 * employers should not have to change how their resume looks to fit it on one
 * page, only how much air it carries. The metrics that tighten are the ones
 * density.py spends first: the gaps between blocks and the space around the
 * header, never the body type, which the density ladder alone is allowed to
 * touch and never takes below 9pt.
 */

import { ContactLine, Section, SECTION_TITLES, clean, extraSections, has, orderedSections } from "../shared";
import { OtherSectionBody, SectionBody } from "../sections";
import type { TemplateProps } from "../types";

export function Compact({ doc, density = 0 }: TemplateProps) {
  const sections = orderedSections(doc);
  const extras = extraSections(doc);
  const name = clean(doc.contact?.name);
  const headline = clean(doc.headline);

  return (
    <article className="rz rz--compact" data-density={density} data-template="compact">
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

export default Compact;
