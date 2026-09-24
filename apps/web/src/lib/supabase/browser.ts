"use client";

/**
 * The cookie-aware browser client, used for authentication only.
 *
 * `client.ts` stays as it is: a plain supabase-js client for reads, with no
 * session. This one exists because a session has to be written somewhere the
 * server can read it, and `localStorage` is not that place. `createBrowserClient`
 * from `@supabase/ssr` writes the session to cookies, which is what makes
 * `getServerClient()` able to tell who is asking.
 *
 * Two clients rather than one on purpose. Everything that reads resume data
 * already works and does not need a session to do it; only sign-in, sign-out
 * and "who am I" go through here. Rewiring every read to a cookie-aware
 * client would be a change with no behaviour attached to it while row-level
 * security is still off.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";
import type { Database } from "./types";

let cached: SupabaseClient<Database> | null = null;

export function getAuthClient(): SupabaseClient<Database> | null {
  const config = supabaseConfig();
  if (!config.ok) return null;
  if (cached) return cached;

  cached = createBrowserClient<Database>(config.url, config.anonKey);
  return cached;
}
