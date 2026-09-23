/**
 * The fresh clone.
 *
 * With no NEXT_PUBLIC_SUPABASE_* variables set, this app deliberately does
 * not redirect, does not throw and does not show a stack trace. Every screen
 * renders a panel that names the two missing variables and says where to put
 * them. `apps/web/src/lib/supabase/config.ts` and the early return in
 * `lib/supabase/proxy.ts` are what make that true, and it is the very first
 * thing a new contributor sees, so it is worth holding in place.
 *
 * The server behind this project is booted by e2e/harness/serve-unconfigured.mjs.
 */

import { test, expect } from "../support/fixtures";
import { expectNoSeriousA11yViolations } from "../support/a11y";

const MISSING = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

test("/start renders instead of redirecting", async ({ request }) => {
  const response = await request.get("/start", { maxRedirects: 0 });
  expect(
    response.status(),
    "unconfigured, the gate has to let the request through: a login page that cannot work is worse than an instruction"
  ).toBe(200);
});

test("/start names both missing variables", async ({ page }) => {
  await page.goto("/start");

  await expect(page).toHaveURL(/\/start$/);
  await expect(
    page.getByRole("heading", { name: "Supabase is not configured" })
  ).toBeVisible();

  for (const key of MISSING) {
    // The panel puts an sr-only "Missing: " in front of each name, so the
    // list reads as more than a column of identifiers to a screen reader.
    // Asserting on both together keeps that from being dropped.
    await expect(page.getByText(new RegExp(`^Missing:\\s*${key}$`))).toBeVisible();
  }

  // And it says where they go, not just that they are absent.
  await expect(page.getByText(".env.local").first()).toBeVisible();
  await expect(page.getByText("apps/web").first()).toBeVisible();
});

test("/login shows the same panel rather than a broken form", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Supabase is not configured" })).toBeVisible();
  // No sign in controls, because none of them could work.
  await expect(page.getByRole("button", { name: /continue with google/i })).toHaveCount(0);
});

/*
  This one caught something the first time it ran, and then watched it get
  fixed.

  The setup panel was failing axe's colour contrast rule at serious impact on
  seven nodes: --ink-faint was #8a94a6 on white, 3.05:1, where WCAG AA wants
  4.5:1 for text that size. It was a real violation rather than an axe false
  positive, so it was recorded as a `test.fail()` rather than disabled by
  rule name or waved through by lowering the threshold. A redesign pass
  darkened the token, the expected failure started reporting "expected to
  fail but passed", and the marker came off. That is the loop this kind of
  annotation is for, and it is why the threshold in support/a11y.ts has not
  moved.
*/
test("/start has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/start");
  await expectNoSeriousA11yViolations(page);
});
