/**
 * /auth/callback
 *
 * Where both sign in paths land.
 *
 *   Google OAuth (PKCE)  arrives with ?code=...          -> exchangeCodeForSession
 *   Email magic link     arrives with ?token_hash=&type= -> verifyOtp
 *
 * Supabase's hosted redirect can send either shape depending on how the
 * project's email templates are configured, so both are handled rather than
 * assuming one. Anything else is a malformed or tampered link.
 *
 * Every failure redirects back to /login with a short, stable error code.
 * The raw provider message is never put in the URL: it is not written for a
 * user, and it can carry the address the link was issued to.
 *
 * Note the redirect target is built from `origin` plus a path that has been
 * checked to start with a single "/". A `next` of "//evil.example" would be
 * protocol relative and would leave the site, which is the standard open
 * redirect in this exact handler.
 */

import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getServerClient } from "@/lib/supabase/server";

const OTP_TYPES: EmailOtpType[] = [
  "email",
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
];

function safeNext(raw: string | null): string {
  if (!raw) return "/resumes";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/resumes";
  return raw;
}

function backToLogin(request: NextRequest, code: string, next: string) {
  const url = new URL("/login", request.nextUrl.origin);
  url.searchParams.set("error", code);
  if (next !== "/resumes") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));

  // The provider can refuse before we ever get a code.
  if (params.get("error")) {
    const denied = params.get("error") === "access_denied";
    return backToLogin(request, denied ? "denied" : "exchange", next);
  }

  const supabase = await getServerClient();
  if (!supabase) {
    // Unconfigured. /login renders the setup panel, which is the useful page.
    return NextResponse.redirect(new URL("/login", request.nextUrl.origin));
  }

  const code = params.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return backToLogin(request, "exchange", next);
    return NextResponse.redirect(new URL(next, request.nextUrl.origin));
  }

  const tokenHash = params.get("token_hash");
  const rawType = params.get("type");
  const type = OTP_TYPES.find((candidate) => candidate === rawType);

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) {
      const message = error.message.toLowerCase();
      const code = message.includes("expired")
        ? "expired"
        : message.includes("already") || message.includes("used")
          ? "used"
          : "exchange";
      return backToLogin(request, code, next);
    }
    return NextResponse.redirect(new URL(next, request.nextUrl.origin));
  }

  return backToLogin(request, "exchange", next);
}
