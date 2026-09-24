"use client";

/**
 * THIS APP HAS NO AUTHENTICATION.
 *
 * Migration 0009_single_user.sql turned the database into a single-user one:
 * row-level security is off on every table and every table is granted to the
 * `anon` role. The publishable key below is shipped to browsers by design, so
 * anyone who can reach this site can read, change and delete every row in it,
 * including the names, addresses, phone numbers and employment history that a
 * resume is made of. That is the deliberate trade for a local, single-operator
 * install, and it is not a configuration to put on the public internet.
 *
 * Restoring tenancy means re-running 0002_rls.sql and putting a session back
 * in front of these clients. 0002 was left in place and unmodified for that.
 *
 * This is said once, here, rather than in every file that touches the data.
 *
 * ---------------------------------------------------------------------------
 *
 * The browser client.
 *
 * READS may go through this. WRITES must not. Every mutation in this app goes
 * through a route handler under /api, because a write has invariants the
 * database cannot express on its own (a resume and its first version are one
 * transaction, a patch acceptance is idempotent, a template id has to exist in
 * the registry) and because a route handler is a place those invariants can be
 * tested.
 *
 * There is no session to carry, so this is the plain `createClient` from
 * supabase-js rather than the cookie-aware browser client from `@supabase/ssr`.
 *
 * Returns null rather than throwing when the environment is missing, so a
 * component can render the "not configured" panel instead of a stack trace.
 */

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";
import type { Database } from "./types";

export type BrowserClient = SupabaseClient<Database>;

let cached: BrowserClient | null = null;

export function getBrowserClient(): BrowserClient | null {
  const config = supabaseConfig();
  if (!config.ok) return null;
  if (cached) return cached;

  cached = createClient<Database>(config.url, config.anonKey, {
    // Nothing signs in, so there is no session to persist, no token to
    // refresh and no callback URL to detect. All three default to on.
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return cached;
}
