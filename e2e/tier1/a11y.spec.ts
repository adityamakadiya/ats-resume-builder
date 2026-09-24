/**
 * axe on the two screens a visitor can now land on.
 *
 * It used to scan /login, which no longer exists. /start is where a first
 * visit goes and /resumes is where / sends everyone, so those are the two.
 *
 * /start is scanned in the tier1-unconfigured project as well, and the two
 * passes are not redundant: there, the page renders the setup panel, and
 * here it renders the real upload card. Same scan, same threshold.
 */

import { test } from "../support/fixtures";
import { expectNoSeriousA11yViolations } from "../support/a11y";

test("/start has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/start");
  await expectNoSeriousA11yViolations(page);
});

test("/start is still clean once the dropzone has refused a file", async ({ page }) => {
  await page.goto("/start");

  // A .txt is refused in the browser, without a request, so this reaches the
  // error state without uploading anything.
  await page.setInputFiles('input[type="file"]', {
    name: "resume.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("not a resume"),
  });
  await page.getByText(/pdf|docx/i).first().waitFor();

  // An error message that is announced but unreadable is the common failure.
  await expectNoSeriousA11yViolations(page);
});

test("/start/job has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/start/job");
  await expectNoSeriousA11yViolations(page);
});

test("/start/job is still clean with the link input showing", async ({ page }) => {
  await page.goto("/start/job");
  await page.getByRole("button", { name: /use a link/i }).click();
  await expectNoSeriousA11yViolations(page);
});

test("/resumes has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/resumes");
  await expectNoSeriousA11yViolations(page);
});
