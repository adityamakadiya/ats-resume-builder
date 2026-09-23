/**
 * The nine pre-rendered pages, in a real browser.
 *
 * `packages/templates/test/fixtures/html/*.html` is the emitted output of
 * every template crossed with every document shape, and it is what headless
 * Chromium turns into a PDF. The package's own vitest suite reads those files
 * as strings; nothing until now has laid one out and looked at the result.
 *
 * Four checks, each locking a failure that has actually happened or would not
 * be visible anywhere else:
 *
 *   overflow     content wider than the A4 page box is content the PDF cuts
 *                off, and a string check cannot see it.
 *   one h1       the candidate's name, once. Two is an outline an ATS reads
 *                as two documents; zero is a document with no name.
 *   separators   a line that begins or ends with "|", a bullet or a dash is
 *                a join where one side came back empty.
 *   ASCII only   a middle dot from generated content reached a PDF once. Some
 *                ATS parsers mangle it and some fonts do not have the glyph,
 *                so the rule is that the page is plain ASCII and any
 *                exception is a deliberate one added below.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test, expect } from "../support/fixtures";

const FIXTURE_DIR = join(
  __dirname,
  "..",
  "..",
  "packages",
  "templates",
  "test",
  "fixtures",
  "html"
);

const FIXTURES = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith(".html"))
  .sort();

/** 210mm at 96dpi, the width `.rz` sets from `--page-w`. */
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

/**
 * Characters that are only ever a join between two things.
 *
 * A line that starts or ends with one of these means the thing on the other
 * side rendered empty: "Pune, India · " is a contact line missing its email.
 */
const SEPARATORS = ["|", "·", "•", "-", "–", "—", "/", ",", ";", ":", "•", "·"];

/**
 * Non-ASCII that is allowed through, and why.
 *
 * Empty. The fixtures are ASCII today and the point of this list is to make
 * the next addition a decision somebody wrote down, rather than a character
 * that slipped into a PDF.
 */
const ALLOWED_NON_ASCII: { char: string; why: string }[] = [];

const allowed = new Set(ALLOWED_NON_ASCII.map((entry) => entry.char));

test.use({ viewport: { width: A4_WIDTH, height: A4_HEIGHT } });

test("there are nine fixtures, three templates by three shapes", () => {
  expect(FIXTURES).toHaveLength(9);
});

for (const name of FIXTURES) {
  const url = pathToFileURL(join(FIXTURE_DIR, name)).href;

  test.describe(name, () => {
    test("does not overflow the A4 page box", async ({ page }) => {
      await page.goto(url);

      /*
        Print media, because that is the contract these files exist under:
        headless Chromium prints them, and the stylesheet's own "print fix"
        block is where `html, body { margin: 0 }` lives.

        Measured on screen instead, every one of the nine is 802px wide at an
        A4 viewport: the UA's default 8px body margin is only cancelled
        inside `@media print`. That is harmless in the PDF and visible as a
        horizontal scrollbar in the on-screen preview, which is a packages/
        templates decision rather than something this suite should assert
        away. If the reset is ever moved out of the print block, this comment
        is the thing to delete.
      */
      await page.emulateMedia({ media: "print" });

      const measured = await page.evaluate(() => {
        const root = document.documentElement;
        const article = document.querySelector<HTMLElement>(".rz");
        if (!article) return null;

        const page_ = article.getBoundingClientRect();
        const style = getComputedStyle(article);
        const padLeft = parseFloat(style.paddingLeft);
        const padRight = parseFloat(style.paddingRight);
        const inner = { left: page_.left + padLeft, right: page_.right - padRight };

        const spilling: string[] = [];
        for (const el of Array.from(article.querySelectorAll<HTMLElement>("*"))) {
          const box = el.getBoundingClientRect();
          if (box.width === 0 && box.height === 0) continue;
          if (getComputedStyle(el).position === "absolute") continue;
          if (box.right > inner.right + 1 || box.left < inner.left - 1) {
            spilling.push(
              `${el.tagName.toLowerCase()}.${el.className || "(no class)"} → ${box.left.toFixed(1)}..${box.right.toFixed(1)} outside ${inner.left.toFixed(1)}..${inner.right.toFixed(1)}`
            );
          }
        }

        return {
          documentScrollWidth: root.scrollWidth,
          documentClientWidth: root.clientWidth,
          pageWidth: page_.width,
          spilling: spilling.slice(0, 10),
        };
      });

      expect(measured, "no .rz page element in the fixture").not.toBeNull();

      expect(
        Math.round(measured!.pageWidth),
        "the page box is not A4 wide"
      ).toBeLessThanOrEqual(A4_WIDTH);

      expect(
        measured!.documentScrollWidth,
        "the document scrolls sideways, which is content the PDF will clip"
      ).toBeLessThanOrEqual(measured!.documentClientWidth + 1);

      expect(measured!.spilling, "content outside the page's own margins").toEqual([]);
    });

    test("has exactly one h1", async ({ page }) => {
      await page.goto(url);
      const headings = await page.locator("h1").allTextContents();
      expect(headings, `h1s found: ${JSON.stringify(headings)}`).toHaveLength(1);
      expect(headings[0].trim().length, "the one h1 is empty").toBeGreaterThan(0);
    });

    test("has no text beginning or ending with a separator", async ({ page }) => {
      await page.goto(url);

      const offenders = await page.evaluate((separators: string[]) => {
        const out: string[] = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
        let node = walker.nextNode() as HTMLElement | null;

        while (node) {
          const el = node;
          node = walker.nextNode() as HTMLElement | null;

          // Leaves only. A container's text is the concatenation of its
          // children's, and judging that would flag every wrapper.
          if (el.children.length > 0) continue;

          const text = (el.textContent ?? "").trim();
          if (!text) continue;

          const first = text[0];
          const last = text[text.length - 1];
          if (separators.includes(first) || separators.includes(last)) {
            out.push(`${el.tagName.toLowerCase()}.${el.className || "(no class)"}: ${JSON.stringify(text.slice(0, 60))}`);
          }
        }
        return out;
      }, SEPARATORS);

      expect(
        offenders,
        "a dangling separator means one side of a join rendered empty"
      ).toEqual([]);
    });

    test("renders nothing but ASCII", async ({ page }) => {
      await page.goto(url);

      const found = await page.evaluate(() => {
        const text = document.body.textContent ?? "";
        const seen = new Map<string, number>();
        for (const char of text) {
          if (char.codePointAt(0)! > 127) seen.set(char, (seen.get(char) ?? 0) + 1);
        }
        return Array.from(seen.entries());
      });

      const unexpected = found
        .filter(([char]) => !allowed.has(char))
        .map(([char, count]) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")} ${JSON.stringify(char)} x${count}`);

      expect(
        unexpected,
        "a middle dot in generated content reached a PDF once; ASCII only unless it is written down in ALLOWED_NON_ASCII"
      ).toEqual([]);
    });
  });
}
