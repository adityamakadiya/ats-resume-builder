/**
 * The login form from the keyboard.
 *
 * Someone who never touches the mouse should be able to sign in, and should
 * be able to see where they are while doing it. Two separate things:
 * reaching the controls in a sensible order, and the focus ring actually
 * being drawn. `globals.css` sets one loud `:focus-visible` outline for the
 * whole app, and a component that sets `outline: none` without replacing it
 * would silently undo that for its own control.
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

test("tab order runs Google, then email, then submit", async ({ page }) => {
  await page.goto("/login");

  // The email input carries autoFocus, so a tab walk has to start from a
  // known place rather than from wherever the page left it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const order: string[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    order.push(await focused(page));
  }

  const indexOf = (pattern: RegExp) => order.findIndex((entry) => pattern.test(entry));

  const google = indexOf(/continue with google/i);
  const email = indexOf(/^email:/i);
  const submit = indexOf(/email me a sign in link/i);

  expect(google, `Google button never took focus. Walk was:\n${order.join("\n")}`).toBeGreaterThanOrEqual(0);
  expect(email, `email field never took focus. Walk was:\n${order.join("\n")}`).toBeGreaterThanOrEqual(0);
  expect(submit, `submit never took focus. Walk was:\n${order.join("\n")}`).toBeGreaterThanOrEqual(0);

  expect(google).toBeLessThan(email);
  expect(email).toBeLessThan(submit);
});

test("every control in the form draws a visible focus ring", async ({ page }) => {
  await page.goto("/login");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  const targets = [
    { name: "Google button", pattern: /continue with google/i },
    { name: "email field", pattern: /^email:/i },
    { name: "submit", pattern: /email me a sign in link/i },
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

test("the form submits on Enter from the email field", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/work email/i).fill("nope");
  await page.getByLabel(/work email/i).press("Enter");

  // The in-page validation is the observable proof the form submitted at all
  // without anything having to be clicked.
  await expect(page.getByText(/does not look like an email address/i)).toBeVisible();
});
