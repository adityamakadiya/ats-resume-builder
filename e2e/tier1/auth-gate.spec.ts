/**
 * There is no auth gate. Asserted at the HTTP level.
 *
 * This file used to assert the opposite: four gated prefixes, each a 307 to
 * /login carrying a `next` parameter. `apps/web/src/proxy.ts` and the module
 * behind it are gone, along with /login itself, so the property worth holding
 * in place is now the reverse. Every path that used to be gated has to answer
 * 200 and answer it directly.
 *
 * Still the request API with redirects off, for the same reason as before: a
 * browser follows a redirect and the evidence disappears, so "this rendered"
 * and "this bounced somewhere that rendered" look identical from a page.
 *
 * What this cannot tell you is that the data behind those 200s is now public.
 * That is said once, in `apps/web/src/lib/supabase/client.ts`.
 */

import { test, expect } from "../support/fixtures";

/** Every prefix the old PROTECTED_PREFIXES list covered, plus a nested path. */
const FORMERLY_GATED = [
  "/start",
  "/start/template",
  "/resumes",
  "/resume/x",
  "/resume/00000000-0000-4000-8000-000000000000",
  "/dashboard",
];

for (const path of FORMERLY_GATED) {
  test(`${path} is served directly, with no redirect`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status(), `${path} should render, not redirect`).toBe(200);
    expect(
      response.headers()["location"],
      `${path} must not send anyone anywhere: there is nowhere to send them`
    ).toBeUndefined();
  });
}

test("a query string survives, because nothing is intercepting it", async ({ request }) => {
  const response = await request.get("/start/template?document=abc", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["location"]).toBeUndefined();
});

test("/ redirects into the product, and nowhere else", async ({ request }) => {
  const response = await request.get("/", { maxRedirects: 0 });

  // The one redirect left in the app. `redirect()` from a Server Component
  // is a 307.
  expect(response.status()).toBe(307);
  const url = new URL(response.headers()["location"], "http://localhost");
  expect(url.pathname).toBe("/resumes");
  expect(url.search, "nothing is being remembered for a sign in that follows").toBe("");
});

test("/ lands on the library in a browser", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/resumes$/);
  await expect(page.getByRole("heading", { level: 1, name: /my resumes/i })).toBeVisible();
});

test("/login is gone rather than redirecting", async ({ request }) => {
  const response = await request.get("/login", { maxRedirects: 0 });
  expect(
    response.status(),
    "a sign in page that cannot sign anyone in should not answer at all"
  ).toBe(404);
});

test("an unknown path is still a 404", async ({ request }) => {
  const response = await request.get("/nothing-here", { maxRedirects: 0 });
  expect(response.status()).toBe(404);
});
