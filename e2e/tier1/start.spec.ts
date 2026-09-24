/**
 * /start, the first screen of the product.
 *
 * This file replaces `login.spec.ts`. There is no sign in any more, so the
 * first screen anyone sees is this one, and the assertions that mattered on
 * /login move here rather than being dropped.
 *
 * The one that matters most is the last. The product's claim is that a
 * rewrite is *traced* back to a line the candidate wrote. It is not
 * *verified*: nothing here checks that the candidate's resume is true.
 * "Verified" is the word a marketing pass reaches for, it is one word away,
 * and it would be a lie. This test is what keeps it off the page.
 */

import { test, expect } from "../support/fixtures";

test.describe("/start", () => {
  test("renders the first step of the funnel", async ({ page }) => {
    await page.goto("/start");

    await expect(page).toHaveTitle(/Start a resume/);
    await expect(
      page.getByRole("heading", { level: 1, name: /where should this one start/i })
    ).toBeVisible();

    // The step counter is a promise about length, so it has to be there.
    // Three since the posting became a step of its own: upload, template,
    // posting. It read "1 of 2" while the posting was asked for after the
    // editor had already opened, which made the count true and useless.
    await expect(page.getByText(/step 1 of 3/i)).toBeVisible();

    // The two ways in.
    await expect(page.getByRole("button", { name: /drop your resume here/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /choose a blank template/i })).toBeVisible();
  });

  test("the upload card says what is read out of the file", async ({ page }) => {
    await page.goto("/start");

    await expect(page.getByText(/PDF or DOCX/i).first()).toBeVisible();
    await expect(
      page.getByText(/addressed back to the line it came from/i)
    ).toBeVisible();
  });

  test('the word "verified" appears nowhere on the page', async ({ page }) => {
    await page.goto("/start");

    /*
      Visible text, not innerHTML: the dev bundle carries the word inside
      third party source maps and Supabase's own strings, and failing on
      those would teach everyone to delete this test. What matters is what a
      reader sees, so that is what is read.
    */
    const visible = await page.evaluate(() => document.body.innerText);

    expect(
      visible.toLowerCase(),
      'the claim is "traced", not "verified": nothing here checks that a resume is true'
    ).not.toContain("verified");
    expect(visible.toLowerCase()).not.toContain("verify");

    // And the claim that should be there, is.
    expect(visible.toLowerCase()).toContain("trace");
  });
});

test.describe("/resumes", () => {
  test("is the landing screen and offers nothing to sign out of", async ({ page }) => {
    await page.goto("/resumes");

    await expect(page.getByRole("heading", { level: 1, name: /my resumes/i })).toBeVisible();

    // The account menu is gone. A dead "Sign out" control is worse than no
    // control, because it looks like there is a session behind it.
    await expect(page.getByRole("button", { name: /sign out/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /sign in/i })).toHaveCount(0);
    await expect(page.getByText(/signed in as/i)).toHaveCount(0);
  });

  test('the word "verified" appears nowhere there either', async ({ page }) => {
    await page.goto("/resumes");

    const visible = await page.evaluate(() => document.body.innerText);
    expect(visible.toLowerCase()).not.toContain("verified");
    expect(visible.toLowerCase()).not.toContain("verify");
  });
});
