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

import {
  COMFORTABLE_RUNG,
  DENSITY_RUNGS,
  TIGHTEST_RUNG,
  careerYears,
  fitToPages,
  fitToTarget,
  targetPagesFor,
} from "../src/fit";
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

    expect(result).toMatchObject({ density: 0, fits: true, pages: 1 });
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
    expect(fitToPages(el, 2)).toMatchObject({ density: 0, fits: true, pages: 2 });
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

/* --------------------------------------------------------- the target -- */

/**
 * The bug these cover: the preview asked for one page for everybody, so a
 * twelve year career was walked to 9pt type and then told to cut a bullet.
 * The target has to come from the career on the page.
 */

function withRoles(dates: Array<[string, string]>): Pick<ResumeDoc, "experience"> {
  return {
    experience: dates.map(([start, end], index) => ({
      source_id: `E${index}`,
      company: `Company ${index}`,
      title: "Engineer",
      location: "Ahmedabad, India",
      start_date: start,
      end_date: end,
      bullets: [],
    })),
  };
}

describe("targetPagesFor", () => {
  it("aims a short career with two roles at one page", () => {
    const doc = withRoles([
      ["Mar 2023", "Present"],
      ["Jul 2021", "Feb 2023"],
    ]);
    expect(targetPagesFor(doc)).toBe(1);
  });

  it("aims a twelve year career at two pages even in only two roles", () => {
    // The case the old hardcoded budget mutilated: long tenure, few employers.
    const doc = withRoles([
      ["Jan 2014", "Dec 2019"],
      ["Jan 2020", "Dec 2026"],
    ]);
    expect(careerYears(doc)).toBeGreaterThanOrEqual(10);
    expect(targetPagesFor(doc)).toBe(2);
  });

  it("aims four roles at two pages even inside six years", () => {
    const doc = withRoles([
      ["2021", "2026"],
      ["2020", "2021"],
      ["2021", "2022"],
      ["2022", "2023"],
    ]);
    expect(careerYears(doc)).toBeLessThan(10);
    expect(targetPagesFor(doc)).toBe(2);
  });

  it("counts an open ended role up to today rather than ignoring it", () => {
    const doc = withRoles([["Jan 2012", "Present"]]);
    expect(careerYears(doc)).toBeGreaterThanOrEqual(new Date().getFullYear() - 2012);
    expect(targetPagesFor(doc)).toBe(2);
  });

  it("falls back to the role count when nothing is dated", () => {
    expect(careerYears(withRoles([["", ""]]))).toBe(0);
    expect(targetPagesFor(withRoles([["", ""], ["", ""]]))).toBe(1);
    expect(targetPagesFor(withRoles([["", ""], ["", ""], ["", ""], ["", ""]]))).toBe(2);
  });

  it("reads the fixtures the way a recruiter would", () => {
    expect(targetPagesFor(sparse)).toBe(1);
    expect(targetPagesFor(long)).toBe(2);
  });

  it("never asks for three pages", () => {
    const many = withRoles(Array.from({ length: 12 }, () => ["2005", "2026"] as [string, string]));
    expect(targetPagesFor(many)).toBe(2);
  });
});

/* ------------------------------------------------------- room over rungs -- */

describe("fitToTarget", () => {
  it("leaves a document that already fits its target alone", () => {
    const el = stubbed(PAGE * 1.8);
    const result = fitToTarget(el, 2);

    expect(result).toMatchObject({ density: 0, fits: true, pages: 2, overTarget: false });
    expect(el.getAttribute("data-density")).toBe("0");
  });

  it("spends a second page rather than the bottom of the ladder", () => {
    // Overflows one page at every comfortable rung, and only the type
    // shrinking rungs would get it back. The old strict walk did exactly
    // that and called the result a one page resume.
    const el = stubbed(PAGE * 1.45);
    expect(fitToPages(el, 1).density).toBeGreaterThan(COMFORTABLE_RUNG);

    const result = fitToTarget(el, 1);
    expect(result.pages).toBe(2);
    expect(result.density).toBeLessThanOrEqual(COMFORTABLE_RUNG);
    expect(result.comfortable).toBe(true);
    expect(result.overTarget).toBe(true);
    // Over the target by choice is not a failure, and must not be shown as one.
    expect(result.fits).toBe(true);
    expect(el.getAttribute("data-density")).toBe(String(result.density));
  });

  it("tightens when the caller refuses to pay for the extra page", () => {
    const el = stubbed(PAGE * 1.45);
    const result = fitToTarget(el, 1, { maxPages: 1 });

    expect(result.pages).toBe(1);
    expect(result.fits).toBe(true);
    expect(result.overTarget).toBe(false);
    expect(result.density).toBeGreaterThan(COMFORTABLE_RUNG);
  });

  it("does not call a two page senior resume a failure", () => {
    const el = stubbed(PAGE * 1.9);
    const result = fitToTarget(el, 2);

    expect(result.fits).toBe(true);
    expect(result.pages).toBe(2);
    expect(result.density).toBe(0);
  });

  it("fails only when the tightest rung is still over the target", () => {
    const el = stubbed(PAGE * 3);
    const result = fitToTarget(el, 1);

    expect(result.fits).toBe(false);
    expect(result.density).toBe(TIGHTEST_RUNG);
    expect(result.pages).toBeGreaterThan(1);
    expect(result.target).toBe(1);
    expect(el.getAttribute("data-density")).toBe(String(TIGHTEST_RUNG));
  });

  it("gives the long fixture the two pages its six roles earn", () => {
    const el = measuredFixture(long);
    const result = fitToTarget(el, targetPagesFor(long));

    expect(result.target).toBe(2);
    expect(result.pages).toBeLessThanOrEqual(2);
    expect(result.fits).toBe(true);
    // The whole point: it is no longer printed at the bottom of the ladder.
    expect(result.density).toBeLessThan(TIGHTEST_RUNG);
  });

  it("leaves a sparse fixture at the roomiest rung on one page", () => {
    const result = fitToTarget(measuredFixture(sparse), targetPagesFor(sparse));
    expect(result).toMatchObject({ density: 0, fits: true, pages: 1, target: 1 });
  });
});
