/**
 * The server client, for Server Components and Route Handlers.
 *
 * Cookie-aware, because there is a session again. Authentication is back, but
 * only as a gate in front of the download: everything before that point works
 * signed out, and the sign-in appears at the moment somebody asks for the PDF.
 * See `lib/auth/session.ts` for where that is enforced.
 *
 * WHAT THIS DOES NOT DO. Row-level security is still off and every table is
 * still granted to `anon` (0009_single_user.sql). A session identifies who is
 * asking; it does not yet restrict what they can reach. Signing in gates the
 * download and nothing else, so this is a gate, not isolation, and it must not
 * be mistaken for one. Restoring isolation means re-running 0002_rls.sql and
 * giving every row a real owner, which is a migration and not a client change.
 *
 * It stays async. Every caller awaits it, and `cookies()` is async in Next 16
 * regardless.
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

  const jar = await cookies();

  return createServerClient<Database>(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(written) {
        /*
          A Server Component cannot set cookies, and Next throws if it tries.
          That is not an error worth surfacing: the only thing lost is a
          rotated refresh token, which the browser client rotates again on its
          next call. Route Handlers, where writes matter, can set them, and do.
        */
        try {
          for (const { name, value, options } of written) jar.set(name, value, options);
        } catch {
          // Server Component render. See above.
        }
      },
    },
  });
}
