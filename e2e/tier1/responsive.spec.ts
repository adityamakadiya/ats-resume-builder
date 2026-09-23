/**
 * /login at 375px, which is an iPhone SE and still the narrowest thing worth
 * supporting.
 *
 * Two failures are being looked for. A horizontal scrollbar, which on a
 * touch device means the page slides sideways under the thumb and the layout
 * looks broken. And a primary action that is off screen, or covered, or
 * smaller than a fingertip: the page can look fine and still be unusable.
 */

import { test, expect } from "../support/fixtures";

const NARROW = { width: 375, height: 667 };

test.use({ viewport: NARROW });

test("no horizontal scroll at 375px", async ({ page }) => {
  await page.goto("/login");

  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });

  expect(
    overflow.scrollWidth,
    "the page is wider than the viewport, so it slides sideways"
  ).toBeLessThanOrEqual(overflow.clientWidth);
});

test("nothing individually overflows the viewport at 375px", async ({ page }) => {
  await page.goto("/login");

  // Narrows a page-level overflow down to the element causing it, which is
  // the question anyone reading a failure will ask next.
  const wide = await page.evaluate((width) => {
    const out: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      if (box.right > width + 1 || box.left < -1) {
        out.push(`${el.tagName.toLowerCase()}.${el.className || "(no class)"} → ${Math.round(box.left)}..${Math.round(box.right)}`);
      }
    }
    return out.slice(0, 10);
  }, NARROW.width);

  expect(wide).toEqual([]);
});

test("the Google button is reachable and hittable at 375px", async ({ page }) => {
  await page.goto("/login");

  const google = page.getByRole("button", { name: /continue with google/i });
  await google.scrollIntoViewIfNeeded();

  await expect(google).toBeInViewport();
  await expect(google).toBeEnabled();

  const box = await google.boundingBox();
  expect(box).not.toBeNull();
  // Apple's own floor is 44pt. Anything under it is a mis-tap generator.
  expect(box!.height, "the primary action is smaller than a fingertip").toBeGreaterThanOrEqual(40);
  expect(box!.width).toBeLessThanOrEqual(NARROW.width);

  // A trial click resolves actionability without firing the handler, so this
  // catches an invisible overlay sitting on top of the button.
  await google.click({ trial: true });
});

test("the email field and submit are usable at 375px", async ({ page }) => {
  await page.goto("/login");

  const email = page.getByLabel(/work email/i);
  await email.fill("someone@example.com");
  await expect(email).toHaveValue("someone@example.com");

  const submit = page.getByRole("button", { name: /email me a sign in link/i });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
  await submit.click({ trial: true });
});
