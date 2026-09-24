/**
 * /start from the keyboard.
 *
 * It used to be the login form. There is no login form, so the screen worth
 * holding to this standard is the first one in the funnel: someone who never
 * touches the mouse should be able to reach both ways of starting a resume,
 * and should be able to see where they are while doing it.
 *
 * Two separate things: reaching the controls in a sensible order, and the
 * focus ring actually being drawn. `globals.css` sets one loud
 * `:focus-visible` outline for the whole app, and a component that sets
 * `outline: none` without replacing it would silently undo that for its own
 * control.
 */

import { test, expect } from "../support/fixtures";

/** A short, stable description of whatever currently has focus. */
async function focused(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return "(body)";
    const role = el.getAttribute("type") ?? el.tagName.toLowerCase();
    const label =
      el.getAttribute("aria-label") ??
      (el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent : null) ??
      el.textContent ??
      "";
    return `${role}:${label.trim().replace(/\s+/g, " ").slice(0, 40)}`;
  });
}

/**
 * Walk from the top of the document until the skip link has focus, so the
 * recorded order always starts from the same place. Chromium resumes tabbing
 * from wherever focus last was, not from the top.
 */
async function toSkipLink(page: import("@playwright/test").Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    if (/skip to content/i.test(await focused(page))) return;
  }
  throw new Error("never reached the skip link");
}

async function tabCycle(page: import("@playwright/test").Page, steps = 8) {
  await toSkipLink(page);
  const order = ["a:Skip to content"];
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press("Tab");
    order.push(await focused(page));
  }
  return order;
}

test("tab order runs skip link, then the two ways to start", async ({ page }) => {
  await page.goto("/start");

  const order = await tabCycle(page);
  const walk = order.join("\n");
  const indexOf = (pattern: RegExp) => order.findIndex((entry) => pattern.test(entry));

  const skip = indexOf(/skip to content/i);
  const dropzone = indexOf(/drop your resume here/i);
  const blank = indexOf(/choose a blank template/i);

  expect(skip, `no skip link. Walk was:\n${walk}`).toBe(0);
  expect(dropzone, `the dropzone never took focus. Walk was:\n${walk}`).toBeGreaterThan(0);
  expect(blank, `the blank template button never took focus. Walk was:\n${walk}`).toBeGreaterThan(0);

  expect(
    dropzone,
    `the recommended path has to come first. Walk was:\n${walk}`
  ).toBeLessThan(blank);
});

test("every control on the page draws a visible focus ring", async ({ page }) => {
  await page.goto("/start");
  await toSkipLink(page);

  const targets = [
    { name: "dropzone", pattern: /drop your resume here/i },
    { name: "blank template", pattern: /choose a blank template/i },
  ];

  const seen = new Set<string>();

  for (let i = 0; i < 12 && seen.size < targets.length; i++) {
    await page.keyboard.press("Tab");
    const description = await focused(page);

    const target = targets.find((candidate) => candidate.pattern.test(description));
    if (!target || seen.has(target.name)) continue;
    seen.add(target.name);

    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
        matchesFocusVisible: el.matches(":focus-visible"),
      };
    });

    expect(ring, `${target.name} had no computed style`).not.toBeNull();
    expect(ring!.matchesFocusVisible, `${target.name} did not match :focus-visible after Tab`).toBe(true);

    const outlined = ring!.outlineStyle !== "none" && parseFloat(ring!.outlineWidth) > 0;
    const shadowed = ring!.boxShadow !== "none" && ring!.boxShadow !== "";
    expect(
      outlined || shadowed,
      `${target.name} has no focus ring: outline ${ring!.outlineStyle} ${ring!.outlineWidth}, box-shadow ${ring!.boxShadow}`
    ).toBe(true);
  }

  expect(Array.from(seen).sort()).toEqual(targets.map((t) => t.name).sort());
});

test("the skip link jumps past the chrome to the content", async ({ page }) => {
  await page.goto("/start");
  await toSkipLink(page);
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/#main$/);
  expect(await page.locator("#main").count()).toBe(1);
});
