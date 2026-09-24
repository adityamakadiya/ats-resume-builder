/**
 * The server client, for Server Components and Route Handlers.
 *
 * There is no session and there are no auth cookies, so this is the plain
 * `createClient` from supabase-js. It used to be `createServerClient` from
 * `@supabase/ssr` wired to `cookies()`; with nothing to read or rotate, that
 * was ceremony around an empty cookie jar. See the note at the top of
 * `client.ts` for what removing authentication actually costs.
 *
 * It stays async. Every caller awaits it, `cookies()` was not the only reason
 * for that, and a signature change here would ripple through a dozen route
 * handlers for no gain. Next 16 removed the synchronous request-API shims
 * entirely, so async is the house style here regardless.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "./config";
import type { Database } from "./types";

export type ServerClient = SupabaseClient<Database>;

export async function getServerClient(): Promise<ServerClient | null> {
  const config = supabaseConfig();
  if (!config.ok) return null;

  return createClient<Database>(config.url, config.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
