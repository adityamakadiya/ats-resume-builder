/**
 * A real template, rendered small.
 *
 * Not a screenshot and not a grey-bar mock. The actual component from
 * `@ats/templates` renders at its true A4 width against the `rich` fixture
 * and is scaled with a CSS transform, so what the grid shows is what the PDF
 * will be: the same line breaks, the same widow on page one, the same
 * two-column sidebar that some parsers will read out of order.
 *
 * A transform does not affect layout, so the outer frame is given the scaled
 * box explicitly and the inner sheet is absolutely positioned inside it.
 *
 * `aria-hidden` on the sheet is deliberate. The resume text is a fixture
 * about a person who does not exist; announcing 400 words of it before the
 * template's own name would bury the only thing a screen reader user needs
 * here, which is "Standard, one column, safe for any parser".
 */

import type { ResumeDoc, TemplateMeta } from "@ats/templates";
import "@ats/templates/print.css";

/** A4 at 96dpi. The same numbers print.css works in. */
const PAGE_W = 794;
const PAGE_H = 1123;

export type TemplateThumbnailProps = {
  template: TemplateMeta;
  doc: ResumeDoc;
  /** Rendered width in px. Height follows the A4 ratio. */
  width: number;
  /** How much of the page to show. 1 is the whole sheet. */
  reveal?: number;
  className?: string;
};

export function TemplateThumbnail({
  template,
  doc,
  width,
  reveal = 1,
  className,
}: TemplateThumbnailProps) {
  const scale = width / PAGE_W;
  const Component = template.component;

  return (
    <div
      className={`thumb-frame ${className ?? ""}`}
      style={{ width, height: PAGE_H * scale * reveal }}
      aria-hidden="true"
    >
      <div className="thumb-scale" style={{ transform: `scale(${scale})` }}>
        <Component doc={doc} density={0} />
      </div>
    </div>
  );
}
