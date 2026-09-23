"use client";

/**
 * Sign in.
 *
 * No password, by design. A password is one more thing to leak and one more
 * support burden, and for a tool someone uses in bursts while job hunting,
 * a link in the inbox they are already watching is the shorter path.
 *
 * These are auth calls, not database writes, so they legitimately run in the
 * browser: `signInWithOtp` and `signInWithOAuth` talk to GoTrue and set
 * cookies. Nothing here touches Postgres. Every Postgres write in this app
 * still goes through a route handler.
 *
 * The three states this screen can be in are all named out loud:
 *   sending   "Sending your link"
 *   sent      the inbox instruction, with the address repeated back
 *   failed    what happened, and what to do instead
 */

import { useState } from "react";
import { getBrowserClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; email: string }
  | { kind: "redirecting" }
  | { kind: "failed"; reason: string; remedy: string };

/** Enough to catch a typo, not enough to reject a valid oddity. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function LoginForm({ next }: { next?: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const busy = status.kind === "sending" || status.kind === "redirecting";

  function callbackUrl(): string {
    const url = new URL("/auth/callback", window.location.origin);
    if (next) url.searchParams.set("next", next);
    return url.toString();
  }

  function fail(reason: string, remedy: string) {
    setStatus({ kind: "failed", reason, remedy });
  }

  async function sendLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();

    if (!looksLikeEmail(address)) {
      fail(
        "That does not look like an email address.",
        "Check for a missing @ or a typo in the domain, then try again."
      );
      return;
    }

    const supabase = getBrowserClient();
    if (!supabase) {
      fail(
        "Sign in is not wired up on this deployment.",
        "The Supabase environment variables are missing. See the setup panel on the home page."
      );
      return;
    }

    setStatus({ kind: "sending" });
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: callbackUrl() },
    });

    if (error) {
      fail(
        error.status === 429
          ? "Too many links requested for that address."
          : "The link could not be sent.",
        error.status === 429
          ? "Wait a minute, then ask for another one. The last link we sent is still valid."
          : `${error.message}. Check the address and try again.`
      );
      return;
    }

    setStatus({ kind: "sent", email: address });
  }

  async function signInWithGoogle() {
    const supabase = getBrowserClient();
    if (!supabase) {
      fail(
        "Sign in is not wired up on this deployment.",
        "The Supabase environment variables are missing. See the setup panel on the home page."
      );
      return;
    }

    setStatus({ kind: "redirecting" });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: callbackUrl() },
    });

    if (error) {
      fail(
        "Google sign in could not start.",
        `${error.message}. Try the email link below instead.`
      );
    }
    // On success the browser navigates away; leaving the state as
    // "redirecting" is correct, because this page is about to be replaced.
  }

  if (status.kind === "sent") {
    return (
      <div role="status" aria-live="polite" className="rise">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-traced-soft px-2.5 py-1 text-[0.75rem] font-medium text-traced">
          Link sent
        </p>
        <h2 className="mt-3 text-xl font-semibold tracking-[-0.015em] text-ink">
          Check your inbox
        </h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">
          We sent a sign in link to{" "}
          <span className="font-mono text-[0.875rem] break-all text-ink">
            {status.email}
          </span>
          . It works once and expires in an hour.
        </p>
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-ink-muted">
          Nothing after a minute or two? Look in spam, and check the address
          above for a typo.
        </p>
        <button
          type="button"
          onClick={() => setStatus({ kind: "idle" })}
          className="mt-6 rounded-md text-[0.875rem] font-medium text-[var(--stamp-strong)] underline-offset-4 hover:underline"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <div>
      <Button
        type="button"
        onClick={signInWithGoogle}
        disabled={busy}
        variant="outline"
        size="lg"
        className="w-full gap-2.5"
      >
        <GoogleMark />
        {status.kind === "redirecting" ? "Opening Google" : "Continue with Google"}
      </Button>

      <div className="my-5 flex items-center gap-3" role="separator">
        <span className="h-px flex-1 bg-rule" />
        <span className="text-[0.75rem] text-ink-muted">or</span>
        <span className="h-px flex-1 bg-rule" />
      </div>

      <form onSubmit={sendLink} noValidate>
        <Label htmlFor="email" className="text-[0.8125rem] font-medium text-ink">
          Work email
        </Label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@company.com"
          value={email}
          disabled={busy}
          aria-invalid={status.kind === "failed" || undefined}
          aria-describedby={status.kind === "failed" ? "login-error" : "login-hint"}
          onChange={(event) => {
            setEmail(event.target.value);
            if (status.kind === "failed") setStatus({ kind: "idle" });
          }}
          className="mt-1.5"
        />

        <Button
          type="submit"
          size="lg"
          disabled={busy}
          className="mt-3 w-full"
        >
          {status.kind === "sending" ? "Sending your link" : "Email me a sign in link"}
        </Button>
      </form>

      <div aria-live="polite" className="min-h-[3rem] pt-3">
        {status.kind === "failed" ? (
          <p
            id="login-error"
            className="rounded-lg border border-[var(--refused)]/25 bg-[var(--refused-soft)] px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink"
          >
            <span className="font-medium text-[var(--refused)]">{status.reason}</span>{" "}
            {status.remedy}
          </p>
        ) : (
          <p id="login-hint" className="text-[0.8125rem] leading-relaxed text-ink-muted">
            No password to remember. We send a link that signs you in once.
          </p>
        )}
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className="size-4" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
