"use client";

/**
 * The one moment this product asks for an account.
 *
 * Not on arrival, not before the upload, not before the rewrite: at the
 * download, which is the first point the user is getting something they would
 * mind losing. Everything above this dialog already happened without an
 * account and is still there behind it, which is why the copy says so rather
 * than making somebody guess whether signing in costs them their work.
 *
 * Sign in and create account are the same form. Two tabs would make the user
 * answer a question they cannot answer - whether they have been here before -
 * so the form tries the answer it has and says the other one when it is
 * wrong.
 */

import { useEffect, useRef, useState } from "react";
import { getAuthClient } from "@/lib/supabase/browser";

type Mode = "signin" | "signup";

export function SignInDialog({
  open,
  onClose,
  onSignedIn,
}: {
  open: boolean;
  onClose: () => void;
  /** Fires once the session exists, so the caller can retry the download. */
  onSignedIn: () => void;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) emailRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setProblem(null);
    setNote(null);

    const client = getAuthClient();
    if (!client) {
      setProblem("This deployment has no Supabase project configured, so it cannot sign anyone in.");
      return;
    }
    if (password.length < 8) {
      setProblem("Use at least 8 characters.");
      return;
    }

    setBusy(true);
    const result =
      mode === "signin"
        ? await client.auth.signInWithPassword({ email, password })
        : await client.auth.signUp({ email, password });
    setBusy(false);

    if (result.error) {
      /*
        "Invalid login credentials" is what Supabase says both when the
        password is wrong and when the account does not exist. Offering the
        other mode is more useful than repeating that back.
      */
      const message = result.error.message;
      if (mode === "signin" && /invalid login credentials/i.test(message)) {
        setMode("signup");
        setProblem("No account with that email and password. Create one below, it takes a moment.");
        return;
      }
      if (mode === "signup" && /already registered|already exists/i.test(message)) {
        setMode("signin");
        setProblem("That email already has an account. Sign in instead.");
        return;
      }
      setProblem(message);
      return;
    }

    /*
      Sign-up returns a user with no session when the project requires email
      confirmation. Saying "check your email" is the only honest thing to do:
      the download cannot proceed until the session exists.
    */
    if (!result.data.session) {
      setNote(
        "Check your email for a confirmation link, then come back and download. Your resume is saved.",
      );
      return;
    }

    onSignedIn();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signin-title"
        className="w-full max-w-md rounded-lg border border-rule bg-paper-raised p-6 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="signin-title" className="font-display text-[1.25rem] font-semibold text-ink">
          {mode === "signin" ? "Sign in to download" : "Create an account to download"}
        </h2>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-ink-muted">
          Your resume is saved and stays exactly as it is. This is the only step that needs an
          account.
        </p>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="label">Email</span>
            <input
              ref={emailRef}
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-md border border-rule-strong bg-paper px-3 py-2 text-[0.9375rem] text-ink"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="label">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-md border border-rule-strong bg-paper px-3 py-2 text-[0.9375rem] text-ink"
            />
            <span className="text-[0.75rem] text-ink-faint">At least 8 characters.</span>
          </label>

          {problem && (
            <p role="alert" className="text-[0.8125rem] text-[color:var(--refused)]">
              {problem}
            </p>
          )}
          {note && (
            <p role="status" className="text-[0.8125rem] text-[color:var(--traced)]">
              {note}
            </p>
          )}

          <div className="mt-1 flex items-center gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-stamp px-4 py-2 text-[0.9375rem] font-medium text-paper-raised disabled:opacity-60"
            >
              {busy ? "Working" : mode === "signin" ? "Sign in and download" : "Create account"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="text-[0.875rem] text-ink-muted underline underline-offset-2"
            >
              Not now
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setProblem(null);
              setNote(null);
            }}
            className="mt-1 self-start text-[0.8125rem] text-stamp underline underline-offset-2"
          >
            {mode === "signin" ? "Create an account instead" : "I already have an account"}
          </button>
        </form>
      </div>
    </div>
  );
}
