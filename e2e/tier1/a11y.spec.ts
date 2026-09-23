/**
 * axe on /login.
 *
 * /start is the other page in the brief, but a signed out visitor is
 * redirected away from it, so its axe pass lives in the tier1-unconfigured
 * project, where /start renders for real. Same scan, same threshold.
 */

import { test } from "../support/fixtures";
import { expectNoSeriousA11yViolations } from "../support/a11y";

test("/login has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/login");
  await expectNoSeriousA11yViolations(page);
});

test("/login is still clean once the form is in its error state", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/work email/i).fill("not-an-address");
  await page.getByRole("button", { name: /email me a sign in link/i }).click();
  await page.getByText(/does not look like an email address/i).waitFor();

  // An error message that is announced but unreadable is the common failure.
  await expectNoSeriousA11yViolations(page);
});
