/**
 * /login
 *
 * Centred, quiet, no marketing. Someone arriving here either has an account
 * or is about to make one; a feature list would be in the way of both. The
 * one non-functional line on the page is the product's actual claim, set
 * small under the rule, because it is the thing worth knowing before you
 * hand over an email address.
 */

import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";
import { Wordmark } from "@/components/brand";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfig } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Sign in | Tailor",
};

const CALLBACK_ERRORS: Record<string, { reason: string; remedy: string }> = {
  expired: {
    reason: "That sign in link has expired.",
    remedy: "Links last an hour and work once. Ask for a fresh one below.",
  },
  used: {
    reason: "That sign in link has already been used.",
    remedy: "Ask for a new one below, then open it in this browser.",
  },
  denied: {
    reason: "The sign in was cancelled.",
    remedy: "Nothing was changed. Try again whenever you are ready.",
  },
  exchange: {
    reason: "We could not complete the sign in.",
    remedy: "Ask for a new link below. If it keeps failing, try a different browser.",
  },
};

export default async function LoginPage(props: PageProps<"/login">) {
  // Next 16: searchParams is a Promise. The synchronous form was removed.
  const params = await props.searchParams;
  const config = supabaseConfig();

  const nextParam = params.next;
  const next = typeof nextParam === "string" && nextParam.startsWith("/") ? nextParam : undefined;

  const errorParam = params.error;
  const callbackError =
    typeof errorParam === "string" ? CALLBACK_ERRORS[errorParam] : undefined;

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 py-5 sm:px-8">
        <Wordmark />
      </header>

      <main id="main" className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8">
        {config.ok ? (
          <div className="w-full max-w-[24rem] rise">
            <h1 className="font-display text-4xl leading-none text-ink">Sign in</h1>
            <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink-muted">
              Your resumes, the jobs you measured them against, and every score
              are already here.
            </p>

            {callbackError ? (
              <p
                role="alert"
                className="mt-5 rounded-xs border-l-2 border-stamp bg-stamp-soft/60 px-3 py-2 text-[0.8125rem] leading-relaxed text-ink"
              >
                <span className="font-medium text-stamp">{callbackError.reason}</span>{" "}
                {callbackError.remedy}
              </p>
            ) : null}

            <div className="mt-7">
              <LoginForm next={next} />
            </div>

            <p className="mt-8 border-t border-rule pt-5 text-[0.8125rem] leading-relaxed text-ink-faint">
              Tailor rewrites your resume using only what your resume already
              says. Anything it cannot trace back to a line you wrote is shown
              to you rather than shipped.
            </p>
          </div>
        ) : (
          <SetupNotice missing={config.missing} context="Signing in" />
        )}
      </main>
    </div>
  );
}
