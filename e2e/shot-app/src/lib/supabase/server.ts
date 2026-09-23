/**
 * The server client, for Server Components and Route Handlers.
 *
 * The `next/headers` import below is what keeps this module off the client:
 * it throws at build time if a Client Component reaches for it, which is the
 * same guarantee the `server-only` package gives without the extra dependency.
 *
 * Next 16 note: `cookies()` is async. The synchronous compatibility shim from
 * the 15 line was removed entirely in 16, so this module is async all the way
 * down and there is no sync variant to reach for by mistake.
 *
 * `setAll` is wrapped in try/catch because a Server Component cannot write
 * response headers. That is not an error to surface: the proxy refreshes the
 * session on every request and writes the rotated cookies there, so the throw
 * from a component render is the expected, already-handled case.
 */

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseConfig } from "./config";
import type { Database } from "./types";

export type ServerClient = SupabaseClient<Database>;

export async function getServerClient(): Promise<ServerClient | null> {
  const config = supabaseConfig();
  if (!config.ok) return null;

  const cookieStore = await cookies();

  return createServerClient<Database>(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component. The proxy owns cookie rotation.
        }
      },
    },
  });
}

/**
 * The signed-in user, or null.
 *
 * Deliberately `getUser()` and not `getSession()`. `getSession` reads the
 * cookie and trusts it; `getUser` asks the auth server to verify the JWT.
 * Anything that gates access has to use the verified one.
 */
export async function getCurrentUser() {
  const supabase = await getServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}
