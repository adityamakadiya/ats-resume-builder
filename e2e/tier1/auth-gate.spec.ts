/**
 * The auth gate, asserted at the HTTP level.
 *
 * `apps/web/src/lib/supabase/proxy.ts` gates four prefixes and sends a signed
 * out visitor to /login with a `next` parameter so the trip is resumable. A
 * browser follows the redirect and the evidence disappears, so these use the
 * request API with redirects off and read the status and the Location header
 * directly. That is the difference between "we ended up on the login page"
 * and "we were sent there, once, with the destination preserved".
 */

import { test, expect } from "../support/fixtures";

/** One per protected prefix in PROTECTED_PREFIXES, plus a nested path. */
const PROTECTED = [
  "/start",
  "/start/template",
  "/resumes",
  "/resume/x",
  "/resume/00000000-0000-4000-8000-000000000000",
  "/dashboard",
];

for (const path of PROTECTED) {
  test(`signed out, ${path} is redirected to /login`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(response.status(), `${path} should be a temporary redirect`).toBe(307);

    const location = response.headers()["location"];
    expect(location, `${path} should carry a Location header`).toBeTruthy();

    const url = new URL(location, "http://localhost");
    expect(url.pathname).toBe("/login");
    expect(
      url.searchParams.get("next"),
      "the destination has to survive the detour, or the trip is not resumable"
    ).toBe(path);
  });
}

test("a protected path keeps its query string in next", async ({ request }) => {
  const response = await request.get("/start/template?document=abc", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  const url = new URL(response.headers()["location"], "http://localhost");
  expect(url.searchParams.get("next")).toBe("/start/template?document=abc");
});

test("/login itself is not gated", async ({ request }) => {
  const response = await request.get("/login", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
});

test("an unknown path is a 404, not a redirect to login", async ({ request }) => {
  // The gate matches prefixes. Something outside them must not be swept up.
  const response = await request.get("/nothing-here", { maxRedirects: 0 });
  expect(response.status()).toBe(404);
});

test("following the redirect lands on a usable login screen", async ({ page }) => {
  await page.goto("/resumes");
  await expect(page).toHaveURL(/\/login\?next=%2Fresumes$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});
