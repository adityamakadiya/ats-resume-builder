"use client";

/**
 * The browser client.
 *
 * READS may go through this. RLS is the boundary, so a select from the
 * browser is exactly as safe as the same select from a server: the policy
 * runs in Postgres either way.
 *
 * WRITES must not. Every mutation in this app goes through a route handler
 * under /api, because a write has invariants the database cannot express on
 * its own (a resume and its first version are one transaction, a patch
 * acceptance is idempotent, a template id has to exist in the registry) and
 * because a route handler is a place those invariants can be tested.
 *
 * Returns null rather than throwing when the environment is missing, so a
 * component can render the "not configured" panel instead of a stack trace.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";
import type { Database } from "./types";

export type BrowserClient = SupabaseClient<Database>;

let cached: BrowserClient | null = null;

export function getBrowserClient(): BrowserClient | null {
  const config = supabaseConfig();
  if (!config.ok) return null;
  if (cached) return cached;

  cached = createBrowserClient<Database>(config.url, config.anonKey);
  return cached;
}
