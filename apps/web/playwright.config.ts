/**
 * The end to end layer.
 *
 * It lives in `apps/web` because that is where the dev server, the Next
 * config and the node_modules are, but every spec is in `../../e2e` because
 * tier 3 tests `packages/templates` and has nothing to do with this app.
 *
 * Four projects, three tiers:
 *
 *   tier1               runs against a normal dev server
 *   tier1-unconfigured  runs against a dev server with the Supabase
 *                       variables blanked
 *   tier3               no server at all; file:// against the nine
 *                       pre-rendered template fixtures
 *   tier2               the whole funnel, end to end, against a real
 *                       database and a real model
 *
 * There used to be a fifth, `setup`, which signed in and wrote a
 * storageState for tier 2. Authentication has been removed, so there is
 * nothing to sign in to and no credentials to hold: tier 2 now runs for
 * anyone. It is still out of CI because it is slow, it spends model tokens
 * and it writes rows. See ../../e2e/README.md.
 */

import { defineConfig, devices } from "@playwright/test";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..");
const E2E = join(REPO_ROOT, "e2e");

/** The dev server a contributor probably already has running. */
const APP_PORT = Number(process.env.E2E_PORT ?? 3100);
const APP_URL = process.env.E2E_BASE_URL ?? `http://localhost:${APP_PORT}`;

/**
 * The second server: same app, Supabase variables blanked.
 *
 * Next 16 refuses to start a second `next dev` in a directory that already
 * has one ("Another next dev server is already running"), and the dist dir
 * is not configurable from the CLI. So this one runs out of its own tiny
 * project directory, `e2e/unconfigured-app`, which gets a fresh copy of
 * `apps/web/src` and a symlink to `apps/web/node_modules` every time it
 * boots. See e2e/harness/serve-unconfigured.mjs.
 */
const UNCONFIGURED_PORT = Number(process.env.E2E_UNCONFIGURED_PORT ?? 3101);
const UNCONFIGURED_URL = `http://localhost:${UNCONFIGURED_PORT}`;

/**
 * Which servers this run actually needs.
 *
 * `webServer` is global, so without this, `--project=tier3` would boot two
 * Next dev servers to open nine local files. Playwright gives no hook for
 * "the projects that were selected", so the command line is read directly.
 * With no --project, everything is selected and both servers are needed.
 */
function selectedProjects(): string[] {
  const argv = process.argv;
  const names: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--project" || arg === "-p") names.push(argv[i + 1] ?? "");
    else if (arg.startsWith("--project=")) names.push(arg.slice("--project=".length));
  }
  return names.filter(Boolean);
}

const selected = selectedProjects();
const needs = (project: string) => selected.length === 0 || selected.includes(project);
const needsApp = needs("tier1") || needs("tier2");
const needsUnconfigured = needs("tier1-unconfigured");

const webServer = [
  needsApp
    ? {
        command: `npm run dev -- --port ${APP_PORT}`,
        cwd: __dirname,
        url: APP_URL,
        // A contributor almost always has one up already, and Next will not
        // let us start a second in this directory anyway.
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe" as const,
      }
    : null,
  needsUnconfigured
    ? {
        command: `node ${join(E2E, "harness", "serve-unconfigured.mjs")} ${UNCONFIGURED_PORT}`,
        cwd: REPO_ROOT,
        url: UNCONFIGURED_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: "pipe" as const,
      }
    : null,
].filter((server) => server !== null);

export default defineConfig({
  testDir: E2E,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: join(E2E, "playwright-report"), open: "never" }]]
    : [["list"], ["html", { outputFolder: join(E2E, "playwright-report"), open: "never" }]],
  outputDir: join(E2E, "test-results"),

  use: {
    // Kept only for failures. A green run leaves nothing behind.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 15_000,
  },

  expect: { timeout: 10_000 },

  projects: [
    {
      name: "tier1",
      testDir: join(E2E, "tier1"),
      use: { ...devices["Desktop Chrome"], baseURL: APP_URL },
    },
    {
      name: "tier1-unconfigured",
      testDir: join(E2E, "tier1-unconfigured"),
      use: { ...devices["Desktop Chrome"], baseURL: UNCONFIGURED_URL },
    },
    {
      name: "tier3",
      testDir: join(E2E, "tier3"),
      // No baseURL: every navigation here is a file:// URL.
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "tier2",
      testDir: join(E2E, "tier2"),
      testMatch: /.*\.spec\.ts$/,
      // No `dependencies` and no `storageState`. Both existed to carry a
      // session into every context, and there is no session to carry.
      use: { ...devices["Desktop Chrome"], baseURL: APP_URL },
    },
  ],

  webServer: webServer.length > 0 ? webServer : undefined,
});

export { APP_URL, UNCONFIGURED_URL };
