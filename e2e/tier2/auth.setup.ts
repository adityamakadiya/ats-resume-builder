/**
 * Sign in once, save the cookies, let every tier 2 spec start signed in.
 *
 * Why this does not drive the login form: there isn't a password on it. The
 * product signs people in with a magic link or with Google, and neither can
 * be automated from a test without an inbox or a Google session. Email
 * signup on this project is also rate limited, which is the whole reason
 * tier 2 is opt in.
 *
 * So this exchanges E2E_EMAIL and E2E_PASSWORD for a session with GoTrue
 * directly, then writes the cookie `@supabase/ssr` would have written. The
 * encoding is copied from `@supabase/ssr/dist/main/cookies.js` (the
 * `base64-` prefix) and `utils/chunker.js` (MAX_CHUNK_SIZE 3180). If a
 * Supabase upgrade changes either, this file is what breaks, and it breaks
 * with a clear message rather than a mysterious redirect to /login.
 *
 * On every path, including the skip, a storageState file is written, so that
 * a contributor without credentials sees "skipped" rather than a Playwright
 * config error about a missing file.
 */

import { test as setup, expect } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const E2E = join(__dirname, "..");
const STORAGE_STATE = join(E2E, ".auth", "user.json");
const WEB = join(E2E, "..", "apps", "web");

/** Copied from @supabase/ssr/dist/main/utils/chunker.js. */
const MAX_CHUNK_SIZE = 3180;
/** Copied from @supabase/ssr/dist/main/cookies.js. */
const BASE64_PREFIX = "base64-";

function writeState(state: unknown) {
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  writeFileSync(STORAGE_STATE, JSON.stringify(state, null, 2));
}

/** `.env.local` is not on process.env when Playwright runs, so read it. */
function envFromFile(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const path = join(WEB, ".env.local");
  if (!existsSync(path)) return undefined;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && match[1] === key) return match[2].trim().replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/** The `sb-<ref>-auth-token` name Supabase derives from the project URL. */
function cookieName(supabaseUrl: string): string {
  const host = new URL(supabaseUrl).hostname;
  const ref = host.split(".")[0];
  return `sb-${ref}-auth-token`;
}

function chunk(name: string, value: string) {
  if (value.length <= MAX_CHUNK_SIZE) return [{ name, value }];
  const chunks: { name: string; value: string }[] = [];
  for (let i = 0; i * MAX_CHUNK_SIZE < value.length; i++) {
    chunks.push({
      name: `${name}.${i}`,
      value: value.slice(i * MAX_CHUNK_SIZE, (i + 1) * MAX_CHUNK_SIZE),
    });
  }
  return chunks;
}

setup("sign in", async ({ request, baseURL }) => {
  const email = process.env.E2E_EMAIL;
  const password = process.env.E2E_PASSWORD;

  // Always leave a file behind, even when skipping.
  writeState({ cookies: [], origins: [] });

  setup.skip(
    !email || !password,
    "Tier 2 needs a real Supabase account. Set E2E_EMAIL and E2E_PASSWORD to " +
      "an existing user with a password (Supabase dashboard, Authentication, " +
      "Users, then Send password recovery or create one with a password). " +
      "Email signup on this project is rate limited, which is why this tier " +
      "is opt in. See e2e/README.md."
  );

  const supabaseUrl = envFromFile("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = envFromFile("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  expect(
    supabaseUrl && anonKey,
    "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set, " +
      "in the environment or in apps/web/.env.local"
  ).toBeTruthy();

  const response = await request.post(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      headers: { apikey: anonKey!, "content-type": "application/json" },
      data: { email, password },
    }
  );

  expect(
    response.ok(),
    `GoTrue refused the sign in (${response.status()}): ${await response.text()}`
  ).toBe(true);

  const session = await response.json();
  expect(session.access_token, "no access token in the GoTrue response").toBeTruthy();

  /*
    @supabase/ssr stores the whole session object, not just the token, and
    prefixes the base64 with a marker so it can tell its own cookies from a
    legacy JSON one.
  */
  const encoded =
    BASE64_PREFIX + Buffer.from(JSON.stringify(session), "utf8").toString("base64url");

  const origin = new URL(baseURL ?? "http://localhost:3100");
  const cookies = chunk(cookieName(supabaseUrl!), encoded).map((part) => ({
    ...part,
    domain: origin.hostname,
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 60 * 60,
    httpOnly: false,
    secure: origin.protocol === "https:",
    sameSite: "Lax" as const,
  }));

  writeState({ cookies, origins: [] });
});
