/**
 * Who is asking, on the server.
 *
 * The product is usable signed out on purpose: upload, tailor, edit and
 * preview all work with no account, because asking somebody to register
 * before they have seen whether the thing is any good is how you lose them.
 * The account is asked for once, at the download, which is the first moment
 * the user is getting something they would mind losing.
 *
 * WHAT A SESSION MEANS HERE. It means the download is allowed. It does not
 * mean the data is theirs: row-level security is still off (0009), so a
 * session identifies the caller without restricting them. Anything written
 * on the strength of "the user is signed in, so this row is safe" would be
 * wrong today. See the note in lib/supabase/server.ts.
 */

import { getServerClient } from "@/lib/supabase/server";

export type SignedIn = { id: string; email: string | null };

/**
 * The signed-in user, or null.
 *
 * `getUser()` rather than `getSession()`: getSession returns whatever is in
 * the cookie without checking it, and the cookie is attacker-controlled.
 * getUser asks the auth server whether the token is real. For a gate that is
 * the only one of the two worth calling.
 */
export async function currentUser(): Promise<SignedIn | null> {
  const supabase = await getServerClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  return { id: data.user.id, email: data.user.email ?? null };
}

/** True when this deployment cannot authenticate anyone at all. */
export async function authAvailable(): Promise<boolean> {
  return (await getServerClient()) !== null;
}
