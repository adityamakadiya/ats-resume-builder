/**
 * A second dev server for the same app, with Supabase deliberately absent.
 *
 * `apps/web/src/lib/supabase/config.ts` has a real, reachable mode that needs
 * no account: when the two NEXT_PUBLIC_SUPABASE_* variables are missing, no
 * page throws and no route redirects. Every screen renders the setup panel
 * instead. That is the first thing a fresh clone sees, so it is worth a test.
 *
 * Getting a server into that state is the awkward part:
 *
 *   - `apps/web/.env.local` sets both variables, and Next loads it. Passing
 *     them through the environment as empty strings does suppress it (dotenv
 *     only fills keys that are absent from process.env, and an empty string
 *     is present), and `supabaseConfig()` treats blank as missing.
 *
 *   - But Next 16 refuses to run a second `next dev` in a directory that
 *     already has one, and `distDir` cannot be set from the CLI, so the two
 *     servers cannot share `apps/web`. Someone almost always has the normal
 *     dev server running.
 *
 * So this builds a second, throwaway Next project beside the app. It needs a
 * real `src` directory rather than a symlink, because Next's route discovery
 * follows the symlink to the real path and then finds no routes under this
 * project (the layout renders, every page 404s). `src` is under a megabyte
 * and is recopied on every boot, so it cannot go stale. Everything else is
 * symlinked, including node_modules.
 *
 * Usage: node e2e/harness/serve-unconfigured.mjs [port]
 */

import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E = join(HERE, "..");
const REPO_ROOT = join(E2E, "..");
const WEB = join(REPO_ROOT, "apps", "web");
const APP = join(E2E, "unconfigured-app");

const port = process.argv[2] ?? "3101";

/** Copied fresh every boot: Next needs these to be real files. */
const COPIED = ["src"];

/** Symlinked: large, or shared, or both. */
const LINKED = ["node_modules", "public", "tsconfig.json", "postcss.config.mjs", "components.json"];

function link(name) {
  const target = join(WEB, name);
  const path = join(APP, name);
  if (!existsSync(target)) return;
  rmSync(path, { force: true, recursive: true });
  symlinkSync(target, path);
}

mkdirSync(APP, { recursive: true });
for (const name of COPIED) {
  const path = join(APP, name);
  rmSync(path, { force: true, recursive: true });
  cpSync(join(WEB, name), path, { recursive: true });
}
for (const name of LINKED) link(name);

const child = spawn(
  process.execPath,
  [join(WEB, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", port],
  {
    cwd: APP,
    stdio: "inherit",
    env: {
      ...process.env,
      /*
        Present but blank. Next's dotenv loader only fills keys that are
        absent from process.env, so this is what keeps apps/web/.env.local
        from leaking in through the symlinked node_modules resolution of the
        app's own config, and `supabaseConfig()` counts a blank value as
        missing.
      */
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
    },
  }
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code) => process.exit(code ?? 0));
