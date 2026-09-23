/**
 * What these tests are actually defending.
 *
 * Not "the component renders". Three specific ways a resume generator
 * embarrasses the person using it: a heading over an empty section, a
 * separator left dangling by a field that was not there, and a character no
 * ATS and no printer agrees on. All three ship silently, and all three are
 * cheap to assert.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FIXTURES, rich, sparse } from "../src/fixtures";
import { TEMPLATES } from "../src/registry";
import type { ResumeDoc, TemplateMeta } from "../src/types";

afterEach(cleanup);

const templates: TemplateMeta[] = Object.values(TEMPLATES);
const fixtureNames = Object.keys(FIXTURES) as (keyof typeof FIXTURES)[];

function draw(meta: TemplateMeta, doc: ResumeDoc, density: 0 | 1 | 2 | 3 | 4 = 0): HTMLElement {
  const Component = meta.component;
  const { container } = render(<Component doc={doc} density={density} />);
  const root = container.querySelector<HTMLElement>(".rz");
  expect(root, `${meta.id} must render a .rz root`).not.toBeNull();
  return root as HTMLElement;
}

function headingTexts(root: HTMLElement): string[] {
  return Array.from(root.querySelectorAll("h2")).map((h) => (h.textContent ?? "").trim());
}

/* ------------------------------------------------------------ smoke test -- */

describe("every template renders every fixture", () => {
  for (const meta of templates) {
    for (const name of fixtureNames) {
      it(`${meta.id} renders ${name}`, () => {
        const root = draw(meta, FIXTURES[name]);
        expect(root.getAttribute("data-template")).toBe(meta.id);
        expect((root.textContent ?? "").trim().length).toBeGreaterThan(0);
      });
    }
  }

  it("renders at every rung of the ladder", () => {
    for (const meta of templates) {
      for (const density of [0, 1, 2, 3, 4] as const) {
        const root = draw(meta, rich, density);
        expect(root.getAttribute("data-density")).toBe(String(density));
        cleanup();
      }
    }
  });

  it("survives a document with nothing in it", () => {
    const empty: ResumeDoc = {
      contact: { name: "", email: "", phone: "", location: "", links: [] },
      headline: "",
      summary: { text: "", source_ids: [] },
      skills: [],
      experience: [],
      projects: [],
      education: [],
      certifications: [],
      other_sections: [],
      section_order: [],
      rewrite_notes: [],
    };
    for (const meta of templates) {
      const root = draw(meta, empty);
      expect(root.querySelectorAll("h1, h2, h3")).toHaveLength(0);
      cleanup();
    }
  });
});

/* -------------------------------------------------- nothing left dangling -- */

describe("the sparse fixture leaves nothing dangling", () => {
  for (const meta of templates) {
    describe(meta.id, () => {
      it("renders no empty heading", () => {
        const root = draw(meta, sparse);
        for (const h of Array.from(root.querySelectorAll("h1, h2, h3"))) {
          expect((h.textContent ?? "").trim(), `empty ${h.tagName} in ${meta.id}`).not.toBe("");
        }
      });

      it("renders no heading for a section it has no content for", () => {
        const root = draw(meta, sparse);
        const headings = headingTexts(root);
        expect(headings).not.toContain("Projects");
        expect(headings).not.toContain("Certifications");
        expect(headings).not.toContain("Summary");
        expect(headings).toContain("Experience");
      });

      it("renders no empty list item and no bullet without text", () => {
        const root = draw(meta, sparse);
        for (const li of Array.from(root.querySelectorAll("li"))) {
          expect((li.textContent ?? "").trim(), `empty li in ${meta.id}`).not.toBe("");
        }
        // The volunteer role carries no bullets, so no list may exist for it.
        for (const list of Array.from(root.querySelectorAll("ul, dl"))) {
          expect(list.children.length, `empty list in ${meta.id}`).toBeGreaterThan(0);
        }
      });

      it("renders no orphan separator", () => {
        const root = draw(meta, sparse);
        // Checked per element, because concatenated textContent cannot tell a
        // real date range from a hyphen left behind by a missing end date.
        for (const el of Array.from(root.querySelectorAll("li, dt, dd, p, span, h1, h2, h3"))) {
          const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
          if (text === "") continue;
          expect(text, `dangling separator in ${meta.id}: ${JSON.stringify(text)}`).not.toMatch(
            /^[-,;|]|[-,;|]$/,
          );
          expect(text).not.toMatch(/,\s*,/);
          expect(text).not.toMatch(/\|\s*\|/);
        }
      });

      it("renders no link without a destination or a label", () => {
        const root = draw(meta, sparse);
        for (const a of Array.from(root.querySelectorAll("a"))) {
          expect(a.getAttribute("href")?.trim()).toBeTruthy();
          expect((a.textContent ?? "").trim()).not.toBe("");
        }
      });
    });
  }
});

/* ------------------------------------------------------------ real links -- */

describe("links survive into the document", () => {
  for (const meta of templates) {
    it(`${meta.id} renders contact and project links as anchors`, () => {
      const root = draw(meta, rich);
      const hrefs = Array.from(root.querySelectorAll("a")).map((a) => a.getAttribute("href") ?? "");
      expect(hrefs).toContain("mailto:rohan.iyer@example.com");
      expect(hrefs.some((h) => h.startsWith("https://github.com/rohaniyer"))).toBe(true);
      for (const h of hrefs) {
        expect(h).toMatch(/^(https?:|mailto:|tel:)/);
      }
    });
  }
});

/* ---------------------------------------------------------- section order -- */

describe("section_order is honoured", () => {
  const reordered: ResumeDoc = {
    ...rich,
    // Unknown keys must be ignored; omitted keys must be appended, not dropped.
    section_order: ["education", "summary", "hobbies", "experience"],
  };

  const asideKeys = new Set(["Skills", "Education", "Certifications"]);

  for (const meta of templates) {
    it(`${meta.id} follows the document's order`, () => {
      const root = draw(meta, reordered);
      const headings = headingTexts(root);

      if (meta.columns === 1) {
        expect(headings.slice(0, 3)).toEqual(["Education", "Summary", "Experience"]);
        // Everything else is appended in the default sequence, never lost.
        expect(headings).toContain("Skills");
        expect(headings).toContain("Projects");
        expect(headings).toContain("Certifications");
        expect(headings).toContain("Publications");
      } else {
        // A sidebar decides the column, the document still decides the order
        // within it.
        const main = headings.filter((h) => !asideKeys.has(h));
        expect(main.slice(0, 2)).toEqual(["Summary", "Experience"]);
        expect(main).toContain("Projects");
        const side = headings.filter((h) => asideKeys.has(h));
        expect(side[0]).toBe("Education");
        expect(side).toContain("Skills");
      }
    });
  }

  it("falls back to the default sequence when the order is empty", () => {
    const root = draw(TEMPLATES.standard as TemplateMeta, { ...rich, section_order: [] });
    expect(headingTexts(root).slice(0, 6)).toEqual([
      "Summary",
      "Skills",
      "Experience",
      "Projects",
      "Education",
      "Certifications",
    ]);
  });
});

/* ----------------------------------------------------------------- ASCII -- */

describe("output is ASCII only", () => {
  // The em-dash rule, enforced where it cannot be argued with. Anything a
  // template writes into the DOM is read by a parser, and the separator and
  // bullet glyphs belong in CSS, not in text.
  const nonAscii = /[^\x20-\x7E\n\t]/;

  for (const meta of templates) {
    for (const name of fixtureNames) {
      it(`${meta.id} on ${name}`, () => {
        const root = draw(meta, FIXTURES[name]);
        const text = root.textContent ?? "";
        const offender = text.match(nonAscii);
        expect(
          offender,
          offender ? `non-ASCII ${JSON.stringify(offender[0])} in ${meta.id}/${name}` : "",
        ).toBeNull();
      });
    }
  }
});

/* ------------------------------------------------------ heading hierarchy -- */

describe("heading hierarchy is valid", () => {
  for (const meta of templates) {
    for (const name of fixtureNames) {
      it(`${meta.id} on ${name}`, () => {
        const root = draw(meta, FIXTURES[name]);
        const levels = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((h) =>
          Number(h.tagName.slice(1)),
        );

        expect(levels.filter((l) => l === 1)).toHaveLength(1);
        expect(levels[0]).toBe(1);

        let previous = levels[0] as number;
        for (const level of levels.slice(1)) {
          expect(level, `${meta.id}/${name} skips a level`).toBeLessThanOrEqual(previous + 1);
          previous = level;
        }
      });
    }
  }
});

/* -------------------------------------------------------------- semantics -- */

describe("the DOM an ATS reads", () => {
  for (const meta of templates) {
    it(`${meta.id} uses landmarks and lists`, () => {
      const root = draw(meta, rich);
      expect(root.querySelector("header")).not.toBeNull();
      expect(root.querySelectorAll("section").length).toBeGreaterThan(0);
      expect(root.querySelectorAll("ul li").length).toBeGreaterThan(0);
      expect(root.querySelector("table"), "tables break parsers").toBeNull();
    });
  }

  it("marks the two-column template honestly", () => {
    const modern = TEMPLATES.modern as TemplateMeta;
    expect(modern.atsSafe).toBe(false);
    expect(modern.warning).toBeTruthy();
    for (const id of ["standard", "compact"]) {
      expect((TEMPLATES[id] as TemplateMeta).atsSafe).toBe(true);
    }
  });
});
