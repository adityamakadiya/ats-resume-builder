/**
 * The console watchdog.
 *
 * Every tier 1 spec imports `test` from here instead of from Playwright, and
 * gets one extra guarantee for free: if the browser logged an error, or threw
 * an uncaught exception, or failed to load a resource, the test fails and
 * prints what it was. A screen can look perfect and still be shipping a 404
 * for a font or a hydration mismatch, and nothing else in this repository
 * would notice.
 *
 * The filter list is short on purpose. Anything added to it is an error we
 * have decided to keep, so it needs a reason written next to it.
 */

import { test as base, expect } from "@playwright/test";

/**
 * Console output that is noise from the dev server rather than the app.
 *
 * Nothing is here yet, and the intent is that nothing ever is. Add an entry
 * only with a comment saying why it cannot be fixed instead.
 */
const IGNORED: { pattern: RegExp; why: string }[] = [];

function ignored(text: string): boolean {
  return IGNORED.some((entry) => entry.pattern.test(text));
}

type ConsoleFixtures = {
  /** Errors seen so far. Asserted empty when the test ends. */
  consoleErrors: string[];
};

export const test = base.extend<ConsoleFixtures>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];

      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (ignored(text)) return;
        const at = message.location();
        errors.push(`console.error: ${text}${at.url ? `\n    at ${at.url}:${at.lineNumber}` : ""}`);
      });

      page.on("pageerror", (error) => {
        if (ignored(error.message)) return;
        errors.push(`uncaught: ${error.message}\n${error.stack ?? ""}`);
      });

      page.on("requestfailed", (request) => {
        const failure = request.failure()?.errorText ?? "unknown";
        // Navigations the test aborted on purpose are not app failures.
        if (failure === "net::ERR_ABORTED") return;
        errors.push(`request failed: ${request.method()} ${request.url()} (${failure})`);
      });

      await use(errors);

      expect(
        errors,
        "the browser console must be clean on every page this test visited"
      ).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
