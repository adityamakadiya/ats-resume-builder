/**
 * POST /api/auth/sign-out
 *
 * POST, not GET. A GET sign out is triggerable by any <img> tag on any page
 * the user visits, and browsers prefetch links.
 *
 * Signing out server side is what actually clears the cookie pair. The
 * browser-side `signOut()` clears local storage and leaves the cookies, which
 * produces a page that looks signed out until the next server render.
 */

import { NextResponse } from "next/server";
import { getServerClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await getServerClient();

  if (!supabase) {
    // No session can exist without a configured project, so this succeeded.
    return NextResponse.json({ ok: true });
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    return NextResponse.json(
      {
        ok: false,
        reason: "Sign out did not complete.",
        remedy: "Try again. If it keeps failing, clear this site's cookies.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
