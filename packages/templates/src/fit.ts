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
 */

export const DENSITY_RUNGS = [0, 1, 2, 3, 4] as const;
export const TIGHTEST_RUNG = 4;

/** A4 at 96 CSS pixels to the inch. Overridden by --page-h when it is set. */
const A4_HEIGHT_PX = 1122.52;

export type FitResult = {
  /** The rung left applied to the element. */
  density: number;
  /** False means the content overflows even at the tightest rung. Say so. */
  fits: boolean;
  /** Pages the content occupies at the returned rung. */
  pages: number;
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

/**
 * Walks the density ladder and leaves the element on the first rung that fits.
 *
 * The element is mutated deliberately: the rung that fits is the rung the page
 * should be printed at, so returning it without applying it would just mean
 * the caller had to apply it again and re-measure.
 */
export function fitToPages(el: HTMLElement, maxPages = 1): FitResult {
  const pageHeight = pageHeightPx(el);
  const budget = Math.max(1, maxPages) * pageHeight;
  // Sub-pixel rounding should not cost a rung.
  const tolerance = 1;

  let pages = 1;

  for (const rung of DENSITY_RUNGS) {
    el.setAttribute("data-density", String(rung));
    // Reading a layout property forces the reflow the next measurement needs.
    void el.offsetHeight;

    const height = el.scrollHeight;
    pages = Math.max(1, Math.ceil((height - tolerance) / pageHeight));

    if (height <= budget + tolerance) {
      return { density: rung, fits: true, pages };
    }
  }

  // Still over at 9pt type and 0.45in margins. That is a content problem, and
  // the caller owns telling the candidate so.
  return { density: TIGHTEST_RUNG, fits: false, pages };
}
