/**
 * jsdom does no layout, so scrollHeight is always 0 and a real measurement is
 * impossible here. What is testable, and what actually matters, is the policy:
 * take the roomiest rung that fits, walk down only as far as needed, and when
 * the bottom rung still overflows say so instead of pretending.
 *
 * So the element's height is stubbed as a function of the rung applied to it,
 * using the capacity figures the backend measured for its own ladder.
 */

import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { DENSITY_RUNGS, TIGHTEST_RUNG, fitToPages } from "../src/fit";
import { long, rich, sparse } from "../src/fixtures";
import { Standard } from "../src/templates/Standard";
import type { ResumeDoc } from "../src/types";

afterEach(cleanup);

/** A4 at 96dpi, matching fit.ts's fallback when no computed style exists. */
const PAGE = 1122.52;

/** How much more text each rung holds than rung 0. From density.py. */
const CAPACITY = [1.0, 1.2, 1.32, 1.47, 1.7];

/**
 * An element whose height shrinks as the rung tightens, the way a real one
 * would. `contentHeight` is the height at rung 0.
 */
function stubbed(contentHeight: number): HTMLElement {
  const el = document.createElement("div");
  const applied: number[] = [];

  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get() {
      const rung = Number(el.getAttribute("data-density") ?? 0);
      applied.push(rung);
      return contentHeight / (CAPACITY[rung] ?? 1);
    },
  });
  Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 0 });
  Object.defineProperty(el, "_measuredAt", { configurable: true, get: () => applied });

  document.body.appendChild(el);
  return el;
}

function measuredAt(el: HTMLElement): number[] {
  return (el as unknown as { _measuredAt: number[] })._measuredAt;
}

describe("fitToPages", () => {
  it("leaves a short resume at rung 0", () => {
    const el = stubbed(PAGE * 0.55);
    const result = fitToPages(el);

    expect(result).toEqual({ density: 0, fits: true, pages: 1 });
    expect(el.getAttribute("data-density")).toBe("0");
    // Rung 0 fitting means rung 1 is never even measured.
    expect(measuredAt(el)).toEqual([0]);
  });

  it("walks down to a tighter rung when the content overflows", () => {
    // Overflows at rung 0 by two fifths, which a middle rung absorbs.
    const el = stubbed(PAGE * 1.4);
    const result = fitToPages(el);

    expect(result.fits).toBe(true);
    expect(result.density).toBeGreaterThan(0);
    expect(result.pages).toBe(1);
    expect(el.getAttribute("data-density")).toBe(String(result.density));
    // It takes the loosest rung that works, not the tightest available.
    expect(result.density).toBeLessThan(TIGHTEST_RUNG);
    expect(measuredAt(el)).toEqual(DENSITY_RUNGS.slice(0, result.density + 1).map((r) => r));
  });

  it("reports failure rather than cutting content", () => {
    const el = stubbed(PAGE * 3);
    const result = fitToPages(el);

    expect(result.fits).toBe(false);
    expect(result.density).toBe(TIGHTEST_RUNG);
    expect(result.pages).toBeGreaterThan(1);
    // Every rung was tried before giving up.
    expect(measuredAt(el)).toEqual([0, 1, 2, 3, 4]);
  });

  it("honours a two page budget", () => {
    const el = stubbed(PAGE * 1.8);
    expect(fitToPages(el, 2)).toEqual({ density: 0, fits: true, pages: 2 });
  });

  it("never goes past the bottom rung", () => {
    const el = stubbed(PAGE * 50);
    expect(fitToPages(el).density).toBe(TIGHTEST_RUNG);
    expect(DENSITY_RUNGS).toHaveLength(5);
    expect(TIGHTEST_RUNG).toBe(4);
  });
});

/* ------------------------------------------------------- against fixtures -- */

/**
 * A real render, measured by the only proxy jsdom can offer: how much text is
 * on the page. Roughly what a one-page resume holds at rung 0, which is the
 * same assumption the backend's calibration measures properly.
 */
const CHARS_PER_PAGE = 2600;

function measuredFixture(doc: ResumeDoc): HTMLElement {
  const { container } = render(createElement(Standard, { doc }));
  const el = container.querySelector<HTMLElement>(".rz") as HTMLElement;
  const chars = (el.textContent ?? "").length;

  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get() {
      const rung = Number(el.getAttribute("data-density") ?? 0);
      return ((chars / CHARS_PER_PAGE) * PAGE) / (CAPACITY[rung] ?? 1);
    },
  });
  Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => 0 });
  return el;
}

describe("fitToPages against the fixtures", () => {
  it("gives the sparse fixture rung 0", () => {
    const result = fitToPages(measuredFixture(sparse));
    expect(result.density).toBe(0);
    expect(result.fits).toBe(true);
  });

  it("gives the long fixture a tighter rung than the sparse one", () => {
    const sparseRung = fitToPages(measuredFixture(sparse)).density;
    cleanup();
    const longResult = fitToPages(measuredFixture(long));

    expect(longResult.density).toBeGreaterThan(sparseRung);
    expect(longResult.density).toBeGreaterThan(0);
    // It runs to more than two pages at rung 0, so the ladder cannot save it.
    // The right answer is to say so, and the caller has to pass that on.
    expect(longResult.density).toBe(TIGHTEST_RUNG);
    expect(longResult.fits).toBe(false);
    expect(longResult.pages).toBeGreaterThan(1);
  });

  it("ranks the three fixtures in the order their length implies", () => {
    const rungs = [sparse, rich, long].map((doc) => {
      const r = fitToPages(measuredFixture(doc)).density;
      cleanup();
      return r;
    });
    expect(rungs[0]).toBeLessThanOrEqual(rungs[1] as number);
    expect(rungs[1]).toBeLessThanOrEqual(rungs[2] as number);
  });
});
