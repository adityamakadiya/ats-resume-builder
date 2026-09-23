/**
 * The accessibility pass.
 *
 * axe reports four impact levels. We fail on `serious` and `critical` and
 * report the rest, because `minor` and `moderate` on a design this quiet are
 * mostly contrast ratios a designer chose on purpose, and a gate nobody can
 * pass is a gate everybody turns off.
 *
 * The one thing this module will not do is lower that bar to make a run
 * green. A rule that fires on something genuinely correct gets disabled here,
 * by name, with the reason written beside it, so the next person can see the
 * decision and disagree with it.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Rules switched off, and why.
 *
 * Empty. Nothing has needed it yet; if something does, it goes here rather
 * than into the impact threshold.
 */
const DISABLED_RULES: { rule: string; why: string }[] = [];

export type A11yOptions = {
  /** CSS selector to confine the scan to. Defaults to the whole page. */
  include?: string;
};

export async function expectNoSeriousA11yViolations(page: Page, options: A11yOptions = {}) {
  let builder = new AxeBuilder({ page }).withTags([
    "wcag2a",
    "wcag2aa",
    "wcag21a",
    "wcag21aa",
  ]);

  if (options.include) builder = builder.include(options.include);
  if (DISABLED_RULES.length > 0) {
    builder = builder.disableRules(DISABLED_RULES.map((entry) => entry.rule));
  }

  const results = await builder.analyze();

  const blocking = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical"
  );

  const described = blocking.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    help: violation.help,
    nodes: violation.nodes.map((node) => node.target.join(" ")),
  }));

  expect(
    described,
    `serious or critical accessibility violations on ${page.url()}`
  ).toEqual([]);

  return results;
}
