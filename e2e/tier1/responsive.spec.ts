/**
 * /start and /resumes at 375px, which is an iPhone SE and still the
 * narrowest thing worth supporting.
 *
 * It used to be /login, which is gone. These are the two screens a visit
 * now begins on.
 *
 * Two failures are being looked for. A horizontal scrollbar, which on a
 * touch device means the page slides sideways under the thumb and the layout
 * looks broken. And a primary action that is off screen, or covered, or
 * smaller than a fingertip: the page can look fine and still be unusable.
 */

import { test, expect } from "../support/fixtures";

const NARROW = { width: 375, height: 667 };

test.use({ viewport: NARROW });

for (const path of ["/start", "/resumes"]) {
  test(`no horizontal scroll at 375px on ${path}`, async ({ page }) => {
    await page.goto(path);

    const overflow = await page.evaluate(() => {
      const el = document.documentElement;
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });

    expect(
      overflow.scrollWidth,
      "the page is wider than the viewport, so it slides sideways"
    ).toBeLessThanOrEqual(overflow.clientWidth);
  });

  test(`nothing individually overflows the viewport at 375px on ${path}`, async ({ page }) => {
    await page.goto(path);

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
}

test("the dropzone is reachable and hittable at 375px", async ({ page }) => {
  await page.goto("/start");

  const dropzone = page.getByRole("button", { name: /drop your resume here/i });
  await dropzone.scrollIntoViewIfNeeded();

  await expect(dropzone).toBeInViewport();
  await expect(dropzone).toBeEnabled();

  const box = await dropzone.boundingBox();
  expect(box).not.toBeNull();
  // Apple's own floor is 44pt. Anything under it is a mis-tap generator.
  expect(box!.height, "the primary action is smaller than a fingertip").toBeGreaterThanOrEqual(40);
  expect(box!.width).toBeLessThanOrEqual(NARROW.width);

  // A trial click resolves actionability without firing the handler, so this
  // catches an invisible overlay sitting on top of the button.
  await dropzone.click({ trial: true });
});

test("the blank template path is usable at 375px", async ({ page }) => {
  await page.goto("/start");

  const blank = page.getByRole("button", { name: /choose a blank template/i });
  await blank.scrollIntoViewIfNeeded();
  await expect(blank).toBeInViewport();

  const box = await blank.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(40);
  await blank.click({ trial: true });
});

test("the navigation drawer opens at 375px", async ({ page }) => {
  await page.goto("/resumes");

  // Below lg the rail collapses into a Sheet behind this button. If it did
  // not open there would be no way to reach anything from a phone.
  await page.getByRole("button", { name: /open navigation/i }).click();
  await expect(page.getByRole("link", { name: /new resume/i })).toBeVisible();

  await page.keyboard.press("Escape");
});
