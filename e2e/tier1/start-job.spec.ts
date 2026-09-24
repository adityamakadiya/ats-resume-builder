/**
 * /start/job, the third step, and the editor it opens.
 *
 * The posting used to live behind a button in the editor's toolbar, which
 * meant a first run showed the product with its main feature switched off.
 * It is a step of the funnel now, and these are the three things about it
 * that can silently rot:
 *
 *   - the screen renders, with both ways of giving a posting and a skip that
 *     says what skipping costs
 *   - the skip actually works, and reaches a real editor
 *   - that editor tells the truth about having no posting, which means an
 *     invitation and NOT a number. A score without a posting is the exact
 *     fiction this whole change removed, and it would come back looking
 *     completely correct: a confident 56 out of 100, computed against a
 *     fixture posting for a job the candidate never applied to.
 *
 * The skip writes a row through `POST /api/resumes`, like the funnel does.
 * Tier 1 needs no credentials and no session, which is still true: there is
 * no auth in this app. It does need the same configured dev server that
 * every other tier 1 spec already needs, since `/start` renders a setup
 * panel instead of a dropzone without one.
 */

import { test, expect } from "../support/fixtures";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const DOCUMENT = "11111111-2222-4333-8444-555555555555";

test.describe("/start/job", () => {
  test("renders the third step, both inputs, and the cost of skipping", async ({ page }) => {
    await page.goto("/start/job");

    await expect(page).toHaveTitle(/Add the job posting/);
    await expect(
      page.getByRole("heading", { level: 1, name: /what are you aiming at/i })
    ).toBeVisible();

    // The counter is a promise about length, and it has to have been
    // renumbered on all three screens at once.
    await expect(page.getByText(/step 3 of 3/i)).toBeVisible();

    // The same pair the editor's own panel offers.
    await expect(page.getByRole("button", { name: /paste the text/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /use a link/i })).toBeVisible();
    await expect(page.getByLabel(/the job description/i)).toBeVisible();

    // The skip, and both things it costs, named rather than implied.
    const skip = page.getByRole("button", { name: /skip for now/i });
    await expect(skip).toBeVisible();
    const cost = page.getByText(/no ATS score, and no keyword suggestions/i);
    await expect(cost, "a skip that hides its cost is a dark pattern").toBeVisible();
  });

  test("switching to the link input keeps the posting you already pasted", async ({ page }) => {
    await page.goto("/start/job");

    const paste = page.getByLabel(/the job description/i);
    await paste.fill("Senior Backend Engineer. Go, Kafka, PostgreSQL.");

    await page.getByRole("button", { name: /use a link/i }).click();
    await expect(page.getByLabel(/link to the posting/i)).toBeVisible();

    // Nothing typed is ever thrown away by a mode change.
    await page.getByRole("button", { name: /paste the text/i }).click();
    await expect(paste).toHaveValue("Senior Backend Engineer. Go, Kafka, PostgreSQL.");
  });

  test("the link input warns about the boards that serve a login wall", async ({ page }) => {
    await page.goto("/start/job");
    await page.getByRole("button", { name: /use a link/i }).click();

    await expect(page.getByText(/login wall/i)).toBeVisible();
    await expect(page.getByText(/linkedin/i)).toBeVisible();
  });

  test("carries ?document through to the step after it", async ({ page }) => {
    await page.goto(`/start/job?document=${DOCUMENT}&template=standard`);

    // Back has to land on step two with the upload still attached, or the
    // user loses the file they just gave us.
    const back = page.getByRole("link", { name: /^back$/i });
    await expect(back).toHaveAttribute("href", `/start/template?document=${DOCUMENT}`);
  });

  test('the word "verified" appears nowhere on it', async ({ page }) => {
    await page.goto("/start/job");

    const visible = await page.evaluate(() => document.body.innerText);
    expect(
      visible.toLowerCase(),
      'the claim is "traced", not "verified": nothing here checks that a resume is true'
    ).not.toContain("verified");
    expect(visible.toLowerCase()).not.toContain("verify");
  });

  test("no em dash or en dash in the copy", async ({ page }) => {
    await page.goto("/start/job");

    const visible = await page.evaluate(() => document.body.innerText);
    expect(visible).not.toContain("—");
    expect(visible).not.toContain("–");
  });
});

/*
  Serial: the skip creates one resume and the next test reads the editor it
  opened. Creating a second row to assert the same thing would be a second
  row for nothing.
*/
test.describe("skipping the posting", () => {
  test.describe.configure({ mode: "serial" });

  let resumeId = "";

  test("reaches a real editor", async ({ page }) => {
    await page.goto("/start/job");

    await page.getByRole("button", { name: /skip for now/i }).click();

    await page.waitForURL(new RegExp(`/resume/${UUID.source}`), { timeout: 60_000 });
    resumeId = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(resumeId).toMatch(UUID);

    // Not the 404, and not the error boundary.
    await expect(page.getByText(/this page could not be found/i)).toHaveCount(0);
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);

    // The document is there and it is editable, which is the half of the
    // promise that skipping must not cost.
    await expect(page.getByRole("button", { name: /^download$/i })).toBeVisible();
    await expect(page.getByLabel("Summary")).toBeEditable();
  });

  test("shows the no-posting state instead of a number", async ({ page }) => {
    expect(resumeId, "the skip test has to have run first").not.toBe("");
    await page.goto(`/resume/${resumeId}`);

    await expect(
      page.getByRole("heading", { name: /add the job posting/i })
    ).toBeVisible();

    /*
      The score is rendered as an <output> with an aria-label that starts
      "ATS score". Its absence is the assertion: a number here would be
      computed against a posting this resume does not have.
    */
    await expect(
      page.locator('[aria-label^="ATS score"]'),
      "a score with no posting behind it is the fiction this step exists to prevent"
    ).toHaveCount(0);

    // And the invitation says which two panels are waiting on what.
    await expect(page.getByText(/comparisons against one\s+posting/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /add a posting/i })).toBeVisible();
  });

  test("the prompt opens the posting panel, over a document still on screen", async ({
    page,
  }) => {
    expect(resumeId).not.toBe("");
    await page.goto(`/resume/${resumeId}`);

    await page.getByRole("button", { name: /add a posting/i }).click();

    const panel = page.getByRole("dialog", { name: /tailor to a job/i });
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel(/the job description/i)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });
});
