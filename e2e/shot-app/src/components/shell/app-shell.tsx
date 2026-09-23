"use client";

/**
 * The application chrome.
 *
 * A white rail down the left holding the product mark, the one action worth
 * a button in the navigation, and the nav itself. The page beside it is the
 * faintly cool paper, so the rail and the content cards both read as raised
 * without either needing a heavy shadow to say so.
 *
 * The active row is filled rather than ticked: a soft blue pill in the one
 * action colour, which is the same signal the primary button uses. Phase 2
 * rows carry a muted "Soon" chip and are not clickable.
 *
 * Below the lg breakpoint the rail becomes a Sheet behind a menu button.
 * The Sheet is Base UI's dialog underneath, so Escape closes it, focus is
 * trapped while it is open and returned to the trigger on close, all without
 * us reimplementing any of it.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu, Plus } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { PHASE_TWO_NAV, PRIMARY_NAV, type NavItem } from "./nav-items";
import { UserMenu } from "./user-menu";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/link-button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export type AppShellProps = {
  email: string | null;
  children: React.ReactNode;
};

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

const ROW =
  "relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[0.875rem] transition-colors";

function NavRow({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;

  if (item.unavailable) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              // Not a button: it does nothing. But it must still be reachable,
              // or a keyboard user never learns the feature exists.
              tabIndex={0}
              role="link"
              aria-disabled="true"
              className={`${ROW} cursor-not-allowed text-ink-muted`}
            />
          }
        >
          <Icon aria-hidden="true" className="size-4 shrink-0 opacity-70" />
          <span className="truncate">{item.label}</span>
          <span className="ml-auto shrink-0 rounded-full bg-paper-sunk px-2 py-0.5 text-[0.6875rem] font-medium text-ink-muted">
            Soon
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="max-w-64 rounded-lg bg-ink px-3 py-2 text-[0.75rem] leading-relaxed text-paper"
        >
          {item.unavailable}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`${ROW} ${
        active
          ? "bg-stamp-soft font-medium text-[var(--stamp-strong)]"
          : "text-ink-muted hover:bg-paper-sunk hover:text-ink"
      }`}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function SidebarBody({
  pathname,
  email,
  onNavigate,
}: {
  pathname: string;
  email: string | null;
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-paper-raised">
      <div className="px-4 pt-5 pb-5">
        <Link
          href="/resumes"
          onClick={onNavigate}
          className="inline-block rounded-md"
          aria-label="Tailor, go to my resumes"
        >
          <Wordmark />
        </Link>
      </div>

      <div className="px-3 pb-5">
        <LinkButton
          size="lg"
          className="w-full justify-center gap-2"
          href="/start"
          onClick={onNavigate}
        >
          <Plus aria-hidden="true" />
          New resume
        </LinkButton>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-1">
          {PRIMARY_NAV.map((item) => (
            <li key={item.href}>
              <NavRow
                item={item}
                active={isActive(pathname, item.href)}
                onNavigate={onNavigate}
              />
            </li>
          ))}
        </ul>

        <p className="mt-7 mb-2 px-2.5 text-[0.6875rem] font-semibold tracking-[0.08em] text-ink-muted uppercase">
          Later
        </p>
        <ul className="space-y-1">
          {PHASE_TWO_NAV.map((item) => (
            <li key={item.href}>
              <NavRow item={item} active={false} />
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-rule p-2">
        <UserMenu email={email} />
      </div>
    </div>
  );
}

export function AppShell({ email, children }: AppShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Route changes should not leave the drawer sitting open behind the page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="flex min-h-full flex-1 flex-col lg:flex-row">
      {/* Desktop rail */}
      <aside className="hidden w-64 shrink-0 border-r border-rule bg-paper-raised lg:sticky lg:top-0 lg:block lg:h-screen">
        <SidebarBody pathname={pathname} email={email} />
      </aside>

      {/* Mobile bar */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-rule bg-paper-raised/95 px-3 py-2.5 backdrop-blur-sm lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" aria-label="Open navigation" />
            }
          >
            <Menu aria-hidden="true" />
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[17.5rem] border-r border-rule bg-paper-raised p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Move between the dashboard, your resumes and your account.
            </SheetDescription>
            <SidebarBody
              pathname={pathname}
              email={email}
              onNavigate={() => setOpen(false)}
            />
          </SheetContent>
        </Sheet>

        <Link href="/resumes" className="rounded-md" aria-label="Tailor, go to my resumes">
          <Wordmark />
        </Link>
      </header>

      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
