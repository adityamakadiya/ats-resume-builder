/**
 * Fitting a rendered template onto a page count.
 *
 * The same idea as the backend's density.py, done in the browser where the
 * measurement is free: walk the ladder from the roomiest rung down, and stop
 * at the first one that fits. Rung 0 is not a fallback, it is the answer for
 * anyone whose resume already fits, and a short resume should be given room
 * rather than have room taken away from it.
 *
 * What this function will not do is make the page count look right by force.
 * There is no rung below 4, no scale transform, nothing clipped and nothing
 * hidden. When the content still overflows at the bottom rung it returns
 * `fits: false`, and the caller has to tell the candidate that their resume
 * is too long and roughly by how much. Silently cutting a bullet is the one
 * unacceptable outcome: they would send it without knowing.
 *
 * WHAT WENT WRONG BEFORE. The preview called `fitToPages(sheet, 1)`, so the
 * budget was one page for everybody. A principal engineer with six roles and
 * twelve years was walked down all five rungs, printed at 9pt with 0.45in
 * margins, and then told in red that their resume did not fit and that they
 * should cut a bullet. Two pages is the correct answer for that candidate,
 * the tailor prompt has always said "aim for one to two pages", and the
 * renderer was the only part of the product that disagreed. So the budget is
 * now derived from the document (`targetPagesFor`) and the ladder is walked
 * by `fitToTarget`, which will spend a second page before it will spend the
 * bottom two rungs. A cramped one pager reads as a cramped one pager; a
 * comfortable two pager reads as a senior resume.
 */

import type { ResumeDoc } from "./types";

export const DENSITY_RUNGS = [0, 1, 2, 3, 4] as const;
export const TIGHTEST_RUNG = 4;

/**
 * The tightest rung still worth calling comfortable.
 *
 * Rungs 0 to 2 spend the shrink budget on margins and block gaps, which a
 * reader does not consciously notice. Rungs 3 and 4 start taking leading and
 * then body type, which is where a page begins to look like it is hiding
 * from its own length. So rung 2 is the line: above it, add a page instead.
 */
export const COMFORTABLE_RUNG = 2;

/** A4 at 96 CSS pixels to the inch. Overridden by --page-h when it is set. */
const A4_HEIGHT_PX = 1122.52;

export type FitResult = {
  /** The rung left applied to the element. */
  density: number;
  /**
   * False means the content is over its page target even at the tightest
   * rung. It does NOT mean "needed more than one page": a two page resume
   * aimed at two pages fits, and so does a two page resume that could have
   * been squeezed onto one but was given the room instead.
   */
  fits: boolean;
  /** Pages the content occupies at the returned rung. */
  pages: number;
  /** The page count this document was aimed at. */
  target: number;
  /** True when `pages` came out above `target`, whatever the reason. */
  overTarget: boolean;
  /** True when the rung is one a reader would not notice. */
  comfortable: boolean;
};

/**
 * Resolves one page's height in CSS pixels.
 *
 * The stylesheet owns the page size, so it is read back from the element
 * rather than duplicated here. A length in mm has to be converted, and a
 * computed style may be missing entirely in a non-layout environment such as
 * a test runner, which is why there is a constant to fall back to.
 */
function pageHeightPx(el: HTMLElement): number {
  const view = el.ownerDocument?.defaultView;
  if (!view?.getComputedStyle) return A4_HEIGHT_PX;

  let raw = "";
  try {
    raw = view.getComputedStyle(el).getPropertyValue("--page-h").trim();
  } catch {
    return A4_HEIGHT_PX;
  }
  if (!raw) return A4_HEIGHT_PX;

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return A4_HEIGHT_PX;
  if (raw.endsWith("mm")) return (value / 25.4) * 96;
  if (raw.endsWith("cm")) return (value / 2.54) * 96;
  if (raw.endsWith("in")) return value * 96;
  if (raw.endsWith("pt")) return (value / 72) * 96;
  return value;
}

/* ------------------------------------------------------ the page target -- */

/** Years mentioned in a date string, as numbers. Free text, so be generous. */
function yearsIn(text: string): number[] {
  const found = text.match(/\b(?:19|20)\d{2}\b/g);
  return found ? found.map(Number) : [];
}

const OPEN_ENDED = /\b(present|current|now|ongoing|date)\b/i;

/**
 * Roughly how many years of work the document describes.
 *
 * Dates arrive as whatever the candidate wrote, "Mar 2023", "2019", "Present"
 * or nothing at all, so this reads years out of the text rather than parsing
 * it. Career span rather than the sum of the roles: overlapping contracts and
 * a gap year both stop a sum from meaning anything, and the recruiter reading
 * the page is doing the same subtraction.
 *
 * Returns 0 when no year is written down anywhere, which is a real case for a
 * fresher, and one the role count then decides on its own.
 */
export function careerYears(doc: Pick<ResumeDoc, "experience">): number {
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  const thisYear = new Date().getFullYear();

  for (const role of doc.experience ?? []) {
    const start = yearsIn(role.start_date ?? "");
    const end = yearsIn(role.end_date ?? "");
    for (const year of [...start, ...end]) {
      if (year < earliest) earliest = year;
      if (year > latest) latest = year;
    }
    // "Present" carries no year but it is the strongest date on the page.
    if (OPEN_ENDED.test(role.end_date ?? "") || (start.length > 0 && !(role.end_date ?? "").trim())) {
      if (thisYear > latest) latest = thisYear;
    }
  }

  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return 0;
  return Math.max(0, latest - earliest);
}

/**
 * How many pages this candidate's resume should be aimed at.
 *
 * THE THRESHOLD: two pages once the document shows ten years of career span
 * or four separate roles, one page below that. It is the convention every
 * recruiter guide states in some form, and both halves are needed. Ten years
 * in two long roles is still a two page career, and four roles inside six
 * years is four sets of bullets that a single page can only hold by
 * shrinking. Three roles is the last count that comfortably fits, so four is
 * where the second page is granted.
 *
 * Capped at two. Three pages is not a target anyone is given on purpose; it
 * is only ever an outcome the caller has to report.
 */
export function targetPagesFor(doc: Pick<ResumeDoc, "experience">): 1 | 2 {
  const roles = (doc.experience ?? []).length;
  if (roles >= 4) return 2;
  return careerYears(doc) >= 10 ? 2 : 1;
}

/* ------------------------------------------------------------ the ladder -- */

type Measured = { pages: number; height: number };

/** Applies a rung and measures at it. Reading a layout property reflows. */
function measureAt(el: HTMLElement, rung: number, pageHeight: number, tolerance: number): Measured {
  el.setAttribute("data-density", String(rung));
  void el.offsetHeight;
  const height = el.scrollHeight;
  return { height, pages: Math.max(1, Math.ceil((height - tolerance) / pageHeight)) };
}

/**
 * Walks the density ladder and leaves the element on the first rung that fits.
 *
 * The element is mutated deliberately: the rung that fits is the rung the page
 * should be printed at, so returning it without applying it would just mean
 * the caller had to apply it again and re-measure.
 *
 * This is the strict version, kept because it is what a hard budget means:
 * tighten as far as the ladder goes before admitting the budget is blown. The
 * preview does not want that, it wants `fitToTarget`.
 */
export function fitToPages(el: HTMLElement, maxPages = 1): FitResult {
  const pageHeight = pageHeightPx(el);
  const target = Math.max(1, maxPages);
  const budget = target * pageHeight;
  // Sub-pixel rounding should not cost a rung.
  const tolerance = 1;

  let pages = 1;

  for (const rung of DENSITY_RUNGS) {
    const measured = measureAt(el, rung, pageHeight, tolerance);
    pages = measured.pages;

    if (measured.height <= budget + tolerance) {
      return {
        density: rung,
        fits: true,
        pages,
        target,
        overTarget: false,
        comfortable: rung <= COMFORTABLE_RUNG,
      };
    }
  }

  // Still over at 9pt type and 0.45in margins. That is a content problem, and
  // the caller owns telling the candidate so.
  return {
    density: TIGHTEST_RUNG,
    fits: false,
    pages,
    target,
    overTarget: true,
    comfortable: false,
  };
}

export type FitToTargetOptions = {
  /**
   * The most pages this document may spread to before tightening beats room.
   * Defaults to one more than the target, so a one page candidate may be
   * given two, and a two page candidate three, rather than be crushed.
   */
  maxPages?: number;
};

/**
 * Fits a document to a page target, preferring room over a smaller page count.
 *
 * The order of preference, and why:
 *
 *  1. The roomiest comfortable rung that reaches the target. The ordinary
 *     case, and the same answer the old strict walk gave.
 *  2. Failing that, the fewest pages a comfortable rung can reach, provided
 *     that is within `maxPages`. This is the rule the old code did not have:
 *     a resume that only reaches one page at 9pt is a two page resume, and
 *     printing it as one is the product lying to the candidate about what a
 *     recruiter will see.
 *  3. Failing that, the loosest tight rung that reaches the target. Once the
 *     alternative is a third page, tightening the type is the lesser harm.
 *  4. Failing everything, the bottom rung, `fits: false`, and the caller says
 *     plainly that the document is over its target.
 *
 * `fits` is decided against the tightest rung, not against the rung chosen:
 * it answers "is this document too long", not "did we choose to spend a
 * page". Case 2 therefore reports `fits: true` with `overTarget: true`, which
 * is a note, not an error.
 */
export function fitToTarget(el: HTMLElement, target = 1, options: FitToTargetOptions = {}): FitResult {
  const pageHeight = pageHeightPx(el);
  const want = Math.max(1, target);
  const maxPages = Math.max(want, options.maxPages ?? want + 1);
  const tolerance = 1;

  const pagesByRung = new Map<number, number>();
  const measure = (rung: number): number => {
    const cached = pagesByRung.get(rung);
    if (cached !== undefined) {
      // Re-apply, because the caller is promised the element carries the rung.
      el.setAttribute("data-density", String(rung));
      void el.offsetHeight;
      return cached;
    }
    const pages = measureAt(el, rung, pageHeight, tolerance).pages;
    pagesByRung.set(rung, pages);
    return pages;
  };

  // 1. A comfortable rung that reaches the target, loosest first.
  let bestComfortable = 0;
  let bestComfortablePages = Number.POSITIVE_INFINITY;
  for (const rung of DENSITY_RUNGS) {
    if (rung > COMFORTABLE_RUNG) break;
    const pages = measure(rung);
    if (pages <= want) {
      return { density: rung, fits: true, pages, target: want, overTarget: false, comfortable: true };
    }
    if (pages < bestComfortablePages) {
      bestComfortablePages = pages;
      bestComfortable = rung;
    }
  }

  // 2. Spend a page rather than the bottom of the ladder.
  if (bestComfortablePages <= maxPages) {
    // Asked honestly: would the tightest rung have got this to target? The
    // answer is what `fits` reports, and it costs one extra reflow in a case
    // that only happens when the document is genuinely borderline.
    const tightestPages = measure(TIGHTEST_RUNG);
    const pages = measure(bestComfortable);
    return {
      density: bestComfortable,
      fits: tightestPages <= want,
      pages,
      target: want,
      overTarget: true,
      comfortable: true,
    };
  }

  // 3. The page count now matters more than the leading does.
  for (const rung of DENSITY_RUNGS) {
    if (rung <= COMFORTABLE_RUNG) continue;
    const pages = measure(rung);
    if (pages <= want) {
      return { density: rung, fits: true, pages, target: want, overTarget: false, comfortable: false };
    }
  }

  // 4. Over target at 9pt type and 0.45in margins. A content problem, and the
  // caller owns telling the candidate so rather than cutting anything here.
  const pages = measure(TIGHTEST_RUNG);
  return {
    density: TIGHTEST_RUNG,
    fits: false,
    pages,
    target: want,
    overTarget: true,
    comfortable: false,
  };
}
