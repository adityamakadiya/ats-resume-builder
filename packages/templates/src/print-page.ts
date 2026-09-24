/**
 * The one page shell a resume is printed from.
 *
 * Two things produce a printable page and they must produce the same bytes:
 *
 *   scripts/emit-html.mjs   freezes fixtures that backend/tests/test_template_pdf.py
 *                           and e2e/tier3 then print and inspect
 *   the Download button     sends the live preview to the PDF service
 *
 * If those drift, every PDF test is checking a page nobody downloads. They
 * used to be able to: the emitter had its own template literal and the
 * download did not build a page at all, because it posted the document model
 * to a route that wanted HTML and got a 400 every single time. One shell,
 * used by both, is what stops the tests and the product disagreeing again.
 *
 * Self-contained literally: the renderer runs with no network and no
 * JavaScript, so the CSS is inlined. A <link> would silently fall back to
 * Times New Roman and the diff would look fine.
 */

import { PRINT_CSS } from "./print-css.generated";

export { PRINT_CSS };

/**
 * Wrap rendered template markup in a complete, standalone HTML document.
 *
 * `density` goes on the body to match the emitter. The template's own
 * `.rz` article carries its own `data-density`, which wins where the two
 * disagree; body is the fallback for CSS that is written against it.
 */
export function printDocument(title: string, body: string, density = 0): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${PRINT_CSS}
</style>
</head>
<body data-density="${density}">
${body}
</body>
</html>
`;
}

/** Titles come from user data, and this string is not parsed again by us. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
