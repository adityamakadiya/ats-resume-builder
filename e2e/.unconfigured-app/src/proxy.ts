/**
 * Next 16 file convention.
 *
 * This used to be `middleware.ts` with an exported `middleware` function.
 * In 16 the convention is `proxy.ts` exporting `proxy`; the old name is
 * deprecated. The `edge` runtime is not supported here and the runtime is
 * fixed at `nodejs`, which cannot be configured.
 *
 * It sits in `src/`, beside `app/`, as the convention requires.
 */

import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  /*
    Without a matcher this runs on every request including _next/static and
    every image, which would put an auth round trip in front of the CSS. The
    negative match excludes static output, the favicon, and common image
    extensions. /api is excluded too: route handlers build their own client
    and answer with JSON, not a redirect to an HTML login page.
  */
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
