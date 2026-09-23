/**
 * Session refresh and route gating, called from `src/proxy.ts`.
 *
 * Next 16 renamed the `middleware` file convention to `proxy`, and the
 * exported function with it. The runtime is Node and is not configurable;
 * `edge` is no longer available here. That suits us: this code calls
 * `supabase.auth.getUser()`, which verifies the JWT against the auth server
 * rather than trusting the cookie.
 *
 * Why the refresh has to live here at all: a Server Component cannot set
 * response cookies. When an access token expires mid-navigation, the only
 * place that can write the rotated pair back to the browser is this one.
 */

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "./config";

/** Routes that require a session. Everything else is public. */
const PROTECTED_PREFIXES = ["/start", "/resumes", "/resume", "/dashboard"];

/** Routes a signed-in user should be bounced away from. */
const AUTH_ONLY_PREFIXES = ["/login"];

function matches(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const config = supabaseConfig();
  if (!config.ok) {
    /*
      Nothing is configured yet, so there is no such thing as a session and
      redirecting to /login would only produce a login screen that cannot
      work. Let the request through; each page renders the "Supabase is not
      configured" panel, which is a far more useful thing to look at than a
      redirect loop.
    */
    return response;
  }

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Must be awaited before any redirect, or the rotated cookies are dropped.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && matches(pathname, PROTECTED_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    // So the login screen can send them back where they were headed.
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (user && matches(pathname, AUTH_ONLY_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = "/resumes";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const __test = { matches, PROTECTED_PREFIXES, AUTH_ONLY_PREFIXES };
