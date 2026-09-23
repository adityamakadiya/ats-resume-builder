"use client";

/**
 * The account menu.
 *
 * Signing out is a state change on the server, so it goes through a route
 * handler rather than calling `supabase.auth.signOut()` in the browser. The
 * browser call would clear local storage and leave the httpOnly cookie pair
 * in place, which is the classic "signed out but still signed in" bug.
 */

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { LogOut, User2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type UserMenuProps = {
  email: string | null;
};

function initials(email: string | null): string {
  if (!email) return "?";
  const name = email.split("@")[0] ?? "";
  const parts = name.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.slice(0, 2) || "?").toUpperCase();
}

export function UserMenu({ email }: UserMenuProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    setError(null);
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST" });
      if (!response.ok) {
        setError("Sign out did not go through. Check your connection and try again.");
        return;
      }
      startTransition(() => {
        router.replace("/login");
        router.refresh();
      });
    } catch {
      setError("Sign out did not go through. Check your connection and try again.");
    }
  }

  return (
    <div className="w-full">
      <DropdownMenu>
        <DropdownMenuTrigger
          className="flex w-full items-center gap-2.5 rounded-xs border border-transparent px-2 py-2 text-left transition-colors hover:border-rule hover:bg-paper-raised aria-expanded:border-rule aria-expanded:bg-paper-raised"
          aria-label={email ? `Account menu for ${email}` : "Account menu"}
        >
          <span
            aria-hidden="true"
            className="grid size-7 shrink-0 place-items-center rounded-xs border border-rule-strong bg-paper-raised font-mono text-[0.6875rem] tracking-wider text-ink-muted"
          >
            {initials(email)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[0.8125rem] text-ink">
              {email ?? "Signed in"}
            </span>
          </span>
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          side="top"
          className="min-w-56 rounded-xs border border-rule bg-paper-raised p-1 shadow-none ring-0"
        >
          <DropdownMenuLabel className="px-2 py-1.5">
            <span className="label block">Signed in as</span>
            <span className="mt-1 block truncate text-[0.8125rem] text-ink">
              {email ?? "unknown"}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-rule" />
          <DropdownMenuItem className="rounded-xs px-2 py-1.5" disabled>
            <User2 aria-hidden="true" />
            Account settings
            <span className="ml-auto font-mono text-[0.625rem] tracking-wider text-ink-faint">
              SOON
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="rounded-xs px-2 py-1.5"
            onClick={signOut}
            disabled={pending}
          >
            <LogOut aria-hidden="true" />
            {pending ? "Signing out" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <p role="status" aria-live="polite" className="sr-only">
        {pending ? "Signing out" : ""}
      </p>
      {error ? (
        <p className="mt-1.5 px-2 text-[0.75rem] leading-snug text-stamp">{error}</p>
      ) : null}
    </div>
  );
}
