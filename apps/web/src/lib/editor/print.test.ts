/** @vitest-environment jsdom */

/**
 * The download button posted the document model to a route that has only
 * ever accepted `{ html, filename }`. Every click returned 400 for the life
 * of the feature and the UI said "The renderer answered 400."
 *
 * Nothing caught it because the two halves were tested separately: the route
 * was tested with valid bodies, and the client was tested by asserting it
 * called fetch. Neither asserted they agreed. These tests check the bytes
 * that actually go on the wire.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { PreviewMissingError, findSheet, printFilename, serializePreview } from "./print";

function mountPreview(density = "2"): void {
  document.body.innerHTML = `
    <div data-resume-sheet="">
      <article class="rz rz--standard" data-density="${density}" data-template="standard">
        <header class="rz-header"><h1 class="rz-name">ADITYA MAKADIYA</h1></header>
        <section class="rz-section"><p>Reindexed the ledger.</p></section>
      </article>
    </div>`;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("serializePreview", () => {
  it("produces a complete document, not a fragment", () => {
    mountPreview();
    const html = serializePreview("Aditya — resume");

    // The renderer is handed this verbatim. A fragment renders as a blank
    // page with the browser's default styles, which looks like a bad
    // template rather than a bad payload.
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("</html>");
    expect(html).toContain("<title>");
  });

  it("inlines the stylesheet, because the renderer has no network", () => {
    mountPreview();
    const html = serializePreview("r");

    expect(html).toContain("<style>");
    // A <link> would silently fall back to Times New Roman and the diff
    // would look fine.
    expect(html).not.toContain("<link");
    expect(html).toContain(".rz");
  });

  it("carries the candidate's own content", () => {
    mountPreview();
    const html = serializePreview("r");
    expect(html).toContain("ADITYA MAKADIYA");
    expect(html).toContain("Reindexed the ledger.");
  });

  it("keeps the density the fitter settled on", () => {
    mountPreview("3");
    const html = serializePreview("r");
    // Both places: the body for CSS written against it, and the article's
    // own attribute, which is what actually wins.
    expect(html).toContain('<body data-density="3">');
    expect(html).toContain('data-density="3"');
  });

  it("escapes the title rather than letting it close the tag", () => {
    mountPreview();
    const html = serializePreview('</title><script>x</script>');
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;/title&gt;");
  });

  it("says so when the preview is not mounted", () => {
    expect(() => serializePreview("r")).toThrow(PreviewMissingError);
  });

  it("does not mistake the editable form for the preview", () => {
    // The form panel renders the same content as inputs. Printing those
    // would put textboxes and remove buttons in the PDF.
    document.body.innerHTML = `
      <div class="rz"><input aria-label="Summary" value="typed" /></div>`;
    expect(findSheet()).toBeNull();
  });
});

describe("printFilename", () => {
  it("names the file after the candidate", () => {
    expect(printFilename("ADITYA MAKADIYA")).toBe("ADITYA-MAKADIYA.pdf");
  });

  it("survives punctuation a file manager would refuse", () => {
    expect(printFilename("Aditya / Makadiya: CV")).toBe("Aditya-Makadiya-CV.pdf");
  });

  it("keeps non-latin names rather than stripping them to nothing", () => {
    expect(printFilename("આદિત્ય")).toBe("આદિત્ય.pdf");
  });

  it("falls back when there is no name at all", () => {
    expect(printFilename("   ")).toBe("resume.pdf");
    expect(printFilename("!!!")).toBe("resume.pdf");
  });
});
