/**
 * /login, the only screen a signed-out visitor can reach.
 *
 * The interesting assertion in this file is the last one, and it is not about
 * layout. The product's claim is that a rewrite is *traced* back to a line
 * the candidate wrote. It is not *verified*: nothing here checks that the
 * candidate's resume is true. "Verified" is the word a marketing pass reaches
 * for, it is one word away, and it would be a lie. This test is what keeps it
 * off the page.
 */

import { test, expect } from "../support/fixtures";

test.describe("/login", () => {
  test("renders the sign in screen", async ({ page }) => {
    await page.goto("/login");

    await expect(page).toHaveTitle(/Sign in/);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();

    // The two ways in.
    await expect(page.getByRole("button", { name: /continue with google/i })).toBeVisible();
    await expect(page.getByLabel(/work email/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /email me a sign in link/i })).toBeVisible();

    // The honest strapline. It says "trace", and it says what is not shipped.
    await expect(
      page.getByText(/Anything it cannot trace back to a line you wrote is shown to you/i)
    ).toBeVisible();
  });

  test("the email field is a real email field", async ({ page }) => {
    await page.goto("/login");
    const email = page.getByLabel(/work email/i);
    await expect(email).toHaveAttribute("type", "email");
    await expect(email).toHaveAttribute("autocomplete", "email");
    await expect(email).toHaveAttribute("placeholder", /@/);
  });

  test('the word "verified" appears nowhere on the page', async ({ page }) => {
    await page.goto("/login");

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

  test("a bad address is refused in the page, without a round trip", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel(/work email/i).fill("not-an-address");
    await page.getByRole("button", { name: /email me a sign in link/i }).click();

    await expect(page.getByText(/does not look like an email address/i)).toBeVisible();
    // Still on /login, nothing was sent.
    await expect(page).toHaveURL(/\/login$/);
  });
});
