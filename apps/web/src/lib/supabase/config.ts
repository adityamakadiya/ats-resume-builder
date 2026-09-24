/**
 * Environment, read once and in one place.
 *
 * The first person to run this app will not have a Supabase project wired up
 * yet, and an app that throws a module-scope error on a missing env var gives
 * them a stack trace instead of an instruction. So nothing here throws:
 * `supabaseConfig()` returns a discriminated result, every caller that needs a
 * client has to handle the unconfigured branch, and the UI renders a panel
 * that says which two variables are missing and where to put them.
 *
 * Both variables are NEXT_PUBLIC_ on purpose. The publishable key is designed
 * to ship to browsers. What used to keep one tenant out of another's rows was
 * row-level security rather than the secrecy of that key; there are no longer
 * either of those things. The note at the top of `client.ts` says what that
 * means, once.
 */

/**
 * The one owner every row belongs to.
 *
 * Mirrors `app.owner_id()` in supabase/migrations/0009_single_user.sql, which
 * is the DEFAULT on `user_id` in every table. Application code should not send
 * `user_id` at all and let that default apply; this constant is here for the
 * places where a value is genuinely required, such as the storage path prefix
 * and the rate-limit and cache keys that used to be the session user's id.
 */
export const OWNER_ID = "00000000-0000-0000-0000-00000000da7a";

export type SupabaseConfig =
  | { ok: true; url: string; anonKey: string }
  | { ok: false; missing: string[] };

export const SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

/**
 * Read as literal property accesses rather than `process.env[name]`: Next
 * inlines NEXT_PUBLIC_ vars into the client bundle by static substitution, and
 * a dynamic index is not substituted.
 */
function readEnv(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function supabaseConfig(): SupabaseConfig {
  const env = readEnv();
  const missing = SUPABASE_ENV_KEYS.filter((key) => {
    const value = env[key];
    return typeof value !== "string" || value.trim() === "";
  });

  if (missing.length > 0) return { ok: false, missing };

  return {
    ok: true,
    url: (env.NEXT_PUBLIC_SUPABASE_URL as string).trim(),
    anonKey: (env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string).trim(),
  };
}

export function isSupabaseConfigured(): boolean {
  return supabaseConfig().ok;
}
