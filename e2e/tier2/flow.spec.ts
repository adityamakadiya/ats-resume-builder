/**
 * The whole trip, signed in: upload, template, editor, edit, undo, download.
 *
 * These are serial and share one resume on purpose. Each step is the
 * precondition for the next, and creating a fresh upload per test would mean
 * four uploads to reach one download, which is four times the rate limit and
 * four times the storage.
 *
 * The test that matters most is "the editor shows the uploaded candidate's
 * own name". For a while this screen fell back to the sample document
 * whenever a version was missing, which is almost every resume for the first
 * few seconds of its life, and the result looked completely correct: a
 * well laid out resume for somebody who does not exist. `lib/editor/load.ts`
 * now hydrates from the upload first. Nothing but an end to end check can
 * tell the two apart, because both render perfectly.
 */

import { expect, test, CANDIDATE, FIXTURE_NAME, UUID, resumePdf } from "./support";

test.describe.configure({ mode: "serial" });

let documentId: string;
let resumeId: string;

test("uploading a PDF lands on the template picker with a document id", async ({ page }) => {
  await page.goto("/start");
  await expect(page.getByRole("heading", { name: /where should this one start/i })).toBeVisible();

  await page.setInputFiles('input[type="file"]', {
    name: "priyanka-raghunathan-resume.pdf",
    mimeType: "application/pdf",
    buffer: resumePdf(),
  });

  await page.waitForURL(/\/start\/template\?document=/, { timeout: 60_000 });

  const param = new URL(page.url()).searchParams.get("document");
  expect(param, "the upload has to hand the next step a document id").toMatch(UUID);
  documentId = param!;

  await expect(page.getByRole("heading", { name: /choose how it should look/i })).toBeVisible();
  // The copy changes when the upload is real; that is the observable proof
  // the id survived the navigation.
  await expect(page.getByText(/your upload is stored/i)).toBeVisible();
});

test("the two column template card carries its parser warning", async ({ page }) => {
  await page.goto(`/start/template?document=${documentId}`);

  const warning = page.getByText(/many parsers read them out of order/i).first();
  await expect(
    warning,
    "a two column resume is a real risk and the card has to say so before it is chosen, not after"
  ).toBeVisible();
});

test("choosing a template opens the editor", async ({ page }) => {
  await page.goto(`/start/template?document=${documentId}`);

  await page.getByRole("button", { name: /standard/i }).first().click();
  await page.getByRole("button", { name: /use this template|continue|create/i }).first().click();

  await page.waitForURL(new RegExp(`/resume/${UUID.source}`), { timeout: 60_000 });
  resumeId = new URL(page.url()).pathname.split("/").pop()!;
  expect(resumeId).toMatch(UUID);

  // Not the 404, and not the error boundary.
  await expect(page.getByText(/this page could not be found/i)).toHaveCount(0);
  await expect(page.getByText(/something went wrong/i)).toHaveCount(0);

  // The three columns are there.
  await expect(page.getByRole("heading", { name: /score/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /^download$/i })).toBeVisible();
});

test("the editor shows the uploaded candidate, not the fixture", async ({ page }) => {
  await page.goto(`/resume/${resumeId}?document=${documentId}`);

  const body = page.locator("body");

  await expect(
    body,
    `the editor is showing ${FIXTURE_NAME}, the invented candidate from packages/templates/src/fixtures.ts, instead of the uploaded resume`
  ).not.toContainText(FIXTURE_NAME);

  await expect(
    body,
    "the uploaded candidate's own name has to appear somewhere in the document"
  ).toContainText(CANDIDATE.name);

  // And if it did fall back, it must at least be saying so out loud.
  const banner = page.getByText(/sample document, not saved/i);
  await expect(banner).toHaveCount(0);
});

test("typing in a field moves the score within 500ms", async ({ page }) => {
  await page.goto(`/resume/${resumeId}?document=${documentId}`);

  const score = page.locator('[aria-label^="ATS score"]');
  await expect(score).toBeVisible();

  const before = await score.getAttribute("aria-label");

  const summary = page.getByLabel("Summary");
  await summary.click();
  // A term the sample job asks for, so the score has to react.
  await summary.fill(
    "Staff platform engineer. Go, Kubernetes, Terraform, gRPC, Apache Flink, Rust, idempotency."
  );

  await expect(async () => {
    const after = await score.getAttribute("aria-label");
    expect(after, "the score did not react to an edit").not.toBe(before);
  }).toPass({ timeout: 500, intervals: [50, 50, 50, 100] });
});

test("undo restores the previous text", async ({ page }) => {
  await page.goto(`/resume/${resumeId}?document=${documentId}`);

  const summary = page.getByLabel("Summary");
  const original = await summary.inputValue();
  expect(original.length, "nothing to undo from an empty field").toBeGreaterThan(0);

  await summary.click();
  await summary.fill(`${original} One more sentence that should not survive.`);
  await expect(summary).not.toHaveValue(original);

  await page.getByRole("button", { name: /^undo$/i }).click();

  await expect(
    summary,
    "undo has to go through the editor's own history, not the textarea's"
  ).toHaveValue(original);
});

test("download produces a real PDF", async ({ page }) => {
  await page.goto(`/resume/${resumeId}?document=${documentId}`);

  const downloadPromise = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: /^download$/i }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.pdf$/);

  const path = await download.path();
  expect(path).toBeTruthy();

  const { readFileSync } = await import("node:fs");
  const bytes = readFileSync(path!);
  expect(
    bytes.subarray(0, 5).toString("latin1"),
    "the download is not a PDF, whatever the extension says"
  ).toBe("%PDF-");
  expect(bytes.length).toBeGreaterThan(1000);
});
