/**
 * The fifteen pre-rendered pages, in a real browser.
 *
 * `packages/templates/test/fixtures/html/*.html` is the emitted output of
 * every template crossed with every document shape, and it is what headless
 * Chromium turns into a PDF. The package's own vitest suite reads those files
 * as strings; nothing until now has laid one out and looked at the result.
 *
 * Four per-page checks, each locking a failure that has actually happened or
 * would not be visible anywhere else:
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
 *
 * Then the break-quality block at the bottom, which is about what happens
 * where the paper runs out. Everything above this comment was written against
 * single page output and says nothing about page two. Standard printed
 * standard--long with SKILLS at the foot of page two carrying one group,
 * "Languages: Go, Rust, Python, TypeScript, SQL, Bash", and the other three
 * groups overleaf, and every assertion in this file passed.
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

test("there are fifteen fixtures, three templates by five shapes", () => {
  expect(FIXTURES).toHaveLength(15);
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

/* =========================================================================
   Break quality.

   Everything above asks what one page looks like. This asks what the page
   turn looks like, which until now nothing did: e2e/tier3 measured the A4
   box on fixtures that happened to be one page, and
   backend/tests/test_template_pdf.py checked only that page two of the long
   fixture was not blank. A heading stranded at the foot of a page with one
   line of its section under it satisfied both, and that is exactly what
   Standard was shipping.

   ---------------------------------------------------------------------
   How the page boundaries are found, and why it is not page.pdf()

   Playwright can print a PDF, but nothing in this repository can read one
   back in JavaScript, and adding a PDF parser to apps/web to run four
   assertions is the wrong trade. Nor can the boundaries simply be computed
   from scrollTop: Chromium only fragments when it paginates, so an element's
   position in the ordinary flow says nothing about which page it lands on
   once `break-inside: avoid` has moved things around. Measuring an
   unfragmented document and dividing by the page height would report the
   defect as still present the moment the stylesheet fixed it.

   So the document is fragmented for real, in the same engine, using the
   other fragmentation context Chromium offers: multi-column layout. `.rz` is
   given a fixed height of one A4 page, a column width of one page's content
   width and `column-fill: auto`, which makes Chromium lay it out as a run of
   page-sized fragments side by side. Column fragmentation and page
   fragmentation are the same code path in LayoutNG and honour the same
   `break-*` properties, so a column boundary is a page boundary and the
   horizontal offset of an element's client rect says which page it is on.

   The one difference that matters is padding. `.rz` carries the page margin
   as its own padding, and a fragmented box paints padding-top only on its
   first fragment: that is why page two of a printed resume starts at 0.5pt
   from the top edge of the paper, which is a real defect and a separate
   piece of work. Reproducing it here matters because it changes where the
   breaks fall. The model therefore strips the padding, sets the fragment
   height to the full 1123px page, and puts a spacer of exactly padding-top
   at the head of the flow.

   With that, the model was checked against the real thing. All three
   templates were printed through the Python PDF service and their per-page
   text extracted with pymupdf; the model agreed with Chromium's own
   pagination on the page count and on the first and last line of every page,
   for standard, compact and modern. It is a model, so if it ever stops
   agreeing, believe the PDF.
   ========================================================================= */

/** The document shapes that exist to be multi page, and are tuned to fill. */
const MULTIPAGE = ["twopage", "threepage"];

/** What each of those is meant to print, in every template. */
const EXPECTED_PAGES: Record<string, number> = { twopage: 2, threepage: 3 };

/**
 * A page with less than this fraction of its height used is a page the
 * reader turns to for nothing.
 *
 * Only applied to the fixtures in MULTIPAGE. `rich` and `long` spill onto a
 * final page with a tenth of it used, and no stylesheet can fix that: a
 * document that is 1.1 pages long is 1.1 pages long, and compressing it is
 * the density ladder's job in fit.ts, not the break rules'. Asserting it
 * here would either fail forever or force the threshold down to where it
 * catches nothing.
 */
const MIN_PAGE_FILL = 0.3;

/**
 * Slack when comparing a gap against a block height.
 *
 * Sub-pixel layout, a border drawn at 0.6pt and the last line's descender all
 * put a point or two between "the bottom of the last glyph" and "the bottom
 * of the content". Two pixels, not twenty: this number is the difference
 * between the fit check catching a wasted third of a page and waving it
 * through.
 */
const FIT_TOLERANCE_PX = 2;

type Fragment = { page: number; top: number; bottom: number; left: number };
type Unit = { kind: string; label: string; frags: Fragment[]; marginTop: number };

type Paginated = {
  pageHeight: number;
  lineHeight: number;
  pageCount: number;
  /** Deepest text-bearing elements, in flow order. */
  leaves: Unit[];
  /** Blocks a break is allowed to fall between. */
  blocks: Unit[];
  headings: { label: string; page: number; bottom: number }[];
  /** One per .rz-h2: the section's own content, excluding the heading. */
  sections: { label: string; page: number; bodyFrags: Fragment[]; unitCount: number }[];
  entries: {
    label: string;
    headPage: number | null;
    subPage: number | null;
    firstBulletPage: number | null;
  }[];
  /** Anything that must never straddle a boundary. */
  atomic: { kind: string; label: string; pages: number[] }[];
  /** Used height per page, as a fraction of the sheet. */
  fill: number[];
};

/**
 * Fragment the document into page-sized columns and report where everything
 * landed. Runs inside the browser; see the block comment above for why.
 */
function paginate(pageWidth: number, pageHeight: number): Paginated {
  const GAP = 60;
  const rz = document.querySelector<HTMLElement>(".rz")!;
  const style = getComputedStyle(rz);
  const padTop = parseFloat(style.paddingTop);
  const contentWidth = pageWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const lineHeight = parseFloat(style.lineHeight) || 16;

  rz.style.padding = "0";
  rz.style.margin = "0";
  rz.style.width = `${contentWidth}px`;
  rz.style.minHeight = "0";
  rz.style.height = `${pageHeight}px`;
  rz.style.columnWidth = `${contentWidth}px`;
  rz.style.columnGap = `${GAP}px`;
  rz.style.columnFill = "auto";

  const spacer = document.createElement("div");
  spacer.style.height = `${padTop}px`;
  spacer.setAttribute("data-page-spacer", "");
  rz.prepend(spacer);

  // The columns run off to the right; nothing may clip them or wrap them.
  document.documentElement.style.width = "400000px";
  document.body.style.width = "400000px";
  void rz.offsetWidth;

  const box = rz.getBoundingClientRect();
  const stride = contentWidth + GAP;

  const fragments = (el: Element): Fragment[] => {
    const out: Fragment[] = [];
    for (const rect of Array.from(el.getClientRects())) {
      if (rect.width === 0 && rect.height === 0) continue;
      out.push({
        // +5 keeps a rect that starts exactly on the boundary in its own
        // column rather than rounding it back into the previous one.
        page: Math.floor((rect.left - box.left + 5) / stride),
        top: rect.top - box.top,
        bottom: rect.bottom - box.top,
        left: rect.left,
      });
    }
    return out;
  };

  const label = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const describe = (kind: string, el: Element): Unit => ({
    kind,
    label: label(el),
    frags: fragments(el),
    // A block does not fit in the gap left on a page unless its own top
    // margin fits too, and these margins are in em, so they are never round
    // numbers. Ignoring them made the fit check fail by 8px on
    // standard--long, which is one --gap-entry.
    marginTop: parseFloat(getComputedStyle(el).marginTop) || 0,
  });

  const inFlowOrder = (units: Unit[]) =>
    units
      .filter((u) => u.frags.length > 0)
      .sort(
        (a, b) =>
          a.frags[0].page - b.frags[0].page ||
          a.frags[0].top - b.frags[0].top ||
          a.frags[0].left - b.frags[0].left
      );

  const leafEls: Element[] = [];
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (child.hasAttribute("data-page-spacer")) continue;
      if (child.children.length === 0) leafEls.push(child);
      else walk(child);
    }
  };
  walk(rz);

  const leaves = inFlowOrder(leafEls.map((el) => describe("leaf", el)));
  const everyFragment = leaves.flatMap((u) => u.frags);
  const pageCount = Math.max(0, ...everyFragment.map((f) => f.page)) + 1;

  const fill: number[] = [];
  for (let page = 0; page < pageCount; page++) {
    const here = everyFragment.filter((f) => f.page === page);
    fill.push(here.length ? Math.max(...here.map((f) => f.bottom)) / pageHeight : 0);
  }

  const blockSelector =
    ".rz-section, .rz-entry, .rz-skills, .rz-summary, .rz-h2, .rz-bullets > li, .rz-plain > li";
  const blocks = inFlowOrder(
    Array.from(rz.querySelectorAll(blockSelector)).map((el) => describe(el.className || el.tagName, el))
  );

  const headings = Array.from(rz.querySelectorAll(".rz-h2"))
    .map((el) => {
      const frags = fragments(el);
      return frags.length ? { label: label(el), page: frags[0].page, bottom: frags[0].bottom } : null;
    })
    .filter((h): h is { label: string; page: number; bottom: number } => h !== null);

  const sections = Array.from(rz.querySelectorAll(".rz-section"))
    .map((section) => {
      const heading = section.querySelector(".rz-h2");
      if (!heading) return null;
      const headFrags = fragments(heading);
      if (!headFrags.length) return null;
      const bodyEls = Array.from(section.children).filter((child) => child !== heading);
      const units = bodyEls.flatMap((body) => {
        const found = Array.from(
          body.querySelectorAll(".rz-entry, .rz-skill-row, .rz-plain > li")
        );
        return found.length ? found : [body];
      });
      return {
        label: label(heading),
        page: headFrags[0].page,
        bodyFrags: bodyEls.flatMap(fragments),
        unitCount: units.length,
      };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const entries = Array.from(rz.querySelectorAll(".rz-entry")).map((entry) => {
    const head = entry.querySelector(".rz-entry-line");
    const sub = entry.querySelector(".rz-entry-line--sub");
    const bullet = entry.querySelector(".rz-bullets > li");
    const pageOf = (el: Element | null) => {
      if (!el) return null;
      const frags = fragments(el);
      return frags.length ? frags[0].page : null;
    };
    return {
      label: label(entry.querySelector(".rz-entry-title") ?? entry),
      headPage: pageOf(head),
      subPage: pageOf(sub),
      firstBulletPage: pageOf(bullet),
    };
  });

  const atomic: { kind: string; label: string; pages: number[] }[] = [];
  const collect = (kind: string, selector: string) => {
    for (const el of Array.from(rz.querySelectorAll(selector))) {
      const pages = Array.from(new Set(fragments(el).map((f) => f.page)));
      if (pages.length) atomic.push({ kind, label: label(el), pages });
    }
  };
  collect("bullet", ".rz-bullets > li");
  collect("list item", ".rz-plain > li");
  collect("skill label", ".rz-skills dt");
  collect("skill values", ".rz-skills dd");
  collect("heading", ".rz-h2");

  return { pageHeight, lineHeight, pageCount, leaves, blocks, headings, sections, entries, atomic, fill };
}

/**
 * How much of its own section a heading must drag onto its page before the
 * heading is worth printing there at all.
 *
 * Three lines. "SKILLS" plus one skill group is one line and was the defect;
 * "EXPERIENCE" plus a role is a dozen and is obviously fine. Anything that
 * sits between those two is a judgement call and three lines is where the
 * call was made.
 */
const MIN_SECTION_LINES_WITH_HEADING = 3;

for (const name of FIXTURES) {
  const url = pathToFileURL(join(FIXTURE_DIR, name)).href;
  const shape = name.replace(/\.html$/, "").split("--")[1];

  test.describe(`${name} page breaks`, () => {
    /**
     * One pagination per fixture, shared by the assertions below. Each one
     * mutates the document, so they cannot run against the same page object
     * twice.
     */
    async function measure(page: import("@playwright/test").Page): Promise<Paginated> {
      await page.goto(url);
      await page.emulateMedia({ media: "print" });
      return page.evaluate(
        ([w, h]) => (window as unknown as { __paginate: typeof paginate }).__paginate(w, h),
        [A4_WIDTH, A4_HEIGHT] as const
      );
    }

    test.beforeEach(async ({ page }) => {
      await page.addInitScript(`window.__paginate = ${paginate.toString()}`);
    });

    test("no section heading is the last thing on a page", async ({ page }) => {
      const layout = await measure(page);

      const stranded: string[] = [];
      for (let i = 0; i < layout.leaves.length - 1; i++) {
        const leaf = layout.leaves[i];
        if (!/\brz-h2\b/.test(leaf.kind)) continue;
        const next = layout.leaves[i + 1];
        if (next.frags[0].page !== leaf.frags[0].page) {
          stranded.push(`"${leaf.label}" ends page ${leaf.frags[0].page + 1}`);
        }
      }

      expect(
        stranded,
        "a heading alone at the foot of a page is a promise the page does not keep"
      ).toEqual([]);
    });

    test("a section heading brings at least three lines of its section with it", async ({ page }) => {
      const layout = await measure(page);

      const thin: string[] = [];
      for (const section of layout.sections) {
        const onHeadingPage = section.bodyFrags.filter((f) => f.page === section.page);
        if (onHeadingPage.length === 0) continue; // caught by the test above
        const wholeSectionFits = section.bodyFrags.every((f) => f.page === section.page);
        if (wholeSectionFits) continue;
        const used = Math.max(...onHeadingPage.map((f) => f.bottom)) - Math.min(...onHeadingPage.map((f) => f.top));
        const lines = used / layout.lineHeight;
        if (lines < MIN_SECTION_LINES_WITH_HEADING) {
          thin.push(
            `"${section.label}" on page ${section.page + 1} carries ${lines.toFixed(1)} lines ` +
              `of ${section.unitCount} units; the rest is overleaf`
          );
        }
      }

      expect(
        thin,
        'this is the standard--long defect: "SKILLS" printed at the foot of page two with ' +
          '"Languages: Go, Rust, Python, TypeScript, SQL, Bash" under it and three groups overleaf'
      ).toEqual([]);
    });

    test("a role or project heading is never parted from its first bullet", async ({ page }) => {
      const layout = await measure(page);

      const orphaned: string[] = [];
      for (const entry of layout.entries) {
        if (entry.headPage === null) continue;
        if (entry.subPage !== null && entry.subPage !== entry.headPage) {
          orphaned.push(`"${entry.label}": employer on page ${entry.headPage + 1}, dates line on ${entry.subPage + 1}`);
        }
        if (entry.firstBulletPage !== null && entry.firstBulletPage !== entry.headPage) {
          orphaned.push(
            `"${entry.label}": heading on page ${entry.headPage + 1}, first bullet on page ${entry.firstBulletPage + 1}`
          );
        }
      }

      expect(
        orphaned,
        "a job title at the foot of a page with its achievements overleaf reads as a job with nothing to show for it"
      ).toEqual([]);
    });

    test("nothing atomic is split across a page boundary", async ({ page }) => {
      const layout = await measure(page);

      const split = layout.atomic
        .filter((item) => item.pages.length > 1)
        .map((item) => `${item.kind} "${item.label}" spans pages ${item.pages.map((p) => p + 1).join(" and ")}`);

      expect(
        split,
        "half a sentence at the foot of one page and half at the top of the next"
      ).toEqual([]);
    });

    test("a page ends early only because the next block would not fit", async ({ page }) => {
      const layout = await measure(page);

      const wasteful: string[] = [];
      for (let p = 0; p < layout.pageCount - 1; p++) {
        const here = layout.leaves.flatMap((u) => u.frags).filter((f) => f.page === p);
        if (!here.length) continue;
        const unused = layout.pageHeight - Math.max(...here.map((f) => f.bottom));

        // The outermost block that begins the next page is the thing that
        // did not fit. Outermost, because a section that moved wholesale
        // moved because of its own height, not its first bullet's.
        const next = layout.blocks.find((b) => b.frags[0].page === p + 1);
        if (!next) continue;
        const height =
          next.marginTop + next.frags.reduce((sum, f) => sum + (f.bottom - f.top), 0);

        if (unused > height + FIT_TOLERANCE_PX) {
          wasteful.push(
            `page ${p + 1} leaves ${unused.toFixed(0)}px empty, and "${next.label}" needs only ` +
              `${height.toFixed(0)}px including its top margin, so it would have fitted`
          );
        }
      }

      expect(
        wasteful,
        "an avoid rule that pushes more than it has to spends the candidate's page on nothing"
      ).toEqual([]);
    });

    if (MULTIPAGE.includes(shape)) {
      test(`prints ${EXPECTED_PAGES[shape]} pages with no nearly empty page`, async ({ page }) => {
        const layout = await measure(page);

        expect(
          layout.pageCount,
          `${shape} is tuned to be a ${EXPECTED_PAGES[shape]} page document in every template; ` +
            "if this moved, retune the fixture rather than the expectation"
        ).toBe(EXPECTED_PAGES[shape]);

        const empty = layout.fill
          .map((used, index) => ({ used, page: index + 1 }))
          .filter((entry) => entry.used < MIN_PAGE_FILL)
          .map((entry) => `page ${entry.page} is ${(entry.used * 100).toFixed(0)}% full`);

        expect(
          empty,
          "the page two with three lines on it case: a page turn has to be worth making"
        ).toEqual([]);
      });
    }
  });
}
