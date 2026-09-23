"use client";

/**
 * The application chrome.
 *
 * A column of ruled entries down the left, like the index of a case file,
 * rather than a floating card of pills. The active row is marked with a
 * stamp-red bar in the gutter, which is the same gesture the rest of the
 * product uses for "this one".
 *
 * Below the lg breakpoint the sidebar becomes a Sheet behind a menu button.
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

  const body = (
    <>
      <span
        aria-hidden="true"
        className={[
          "absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 transition-opacity",
          active ? "bg-stamp opacity-100" : "opacity-0",
        ].join(" ")}
      />
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </>
  );

  const shared =
    "relative flex items-center gap-2.5 rounded-xs py-2 pr-2 pl-3.5 text-[0.875rem] transition-colors";

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
              className={`${shared} cursor-not-allowed text-ink-faint hover:bg-paper-raised/60`}
            />
          }
        >
          {body}
          <span className="ml-auto font-mono text-[0.5625rem] tracking-[0.12em] text-ink-faint">
            SOON
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          className="max-w-64 rounded-xs bg-ink px-3 py-2 text-[0.75rem] leading-relaxed text-paper"
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
      className={`${shared} ${
        active
          ? "bg-paper-raised font-medium text-ink"
          : "text-ink-muted hover:bg-paper-raised hover:text-ink"
      }`}
    >
      {body}
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
    <div className="flex h-full flex-col">
      <div className="px-4 pt-5 pb-4">
        <Link
          href="/resumes"
          onClick={onNavigate}
          className="inline-block rounded-xs"
          aria-label="Tailor, go to my resumes"
        >
          <Wordmark />
        </Link>
      </div>

      <div className="px-3 pb-4">
        <Button
          render={<Link href="/start" onClick={onNavigate} />}
          size="lg"
          className="w-full justify-start gap-2 rounded-xs bg-stamp text-paper-raised hover:bg-stamp/90"
        >
          <Plus aria-hidden="true" />
          New resume
        </Button>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">
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

        <p className="label mt-7 mb-2 px-3.5">Later</p>
        <ul className="space-y-0.5">
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
      <aside className="hidden w-60 shrink-0 border-r border-rule bg-paper-sunk lg:sticky lg:top-0 lg:block lg:h-screen">
        <SidebarBody pathname={pathname} email={email} />
      </aside>

      {/* Mobile bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-rule bg-paper/95 px-3 py-2.5 backdrop-blur-sm lg:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="rounded-xs"
                aria-label="Open navigation"
              />
            }
          >
            <Menu aria-hidden="true" />
          </SheetTrigger>
          <SheetContent
            side="left"
            className="w-[17rem] border-r border-rule bg-paper-sunk p-0 shadow-none"
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

        <Link href="/resumes" className="rounded-xs" aria-label="Tailor, go to my resumes">
          <Wordmark />
        </Link>
      </header>

      <main id="main" className="min-w-0 flex-1">
        {children}
      </main>
    </div>
  );
}
