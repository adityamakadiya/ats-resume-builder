/**
 * The onboarding funnel's chrome.
 *
 * No sidebar. A nav column listing four things you have not made yet is
 * noise on the screen where you are making your first one, and the only
 * useful escape from here is back to the library, which is one link.
 */

import Link from "next/link";
import { Wordmark } from "@/components/brand";

export default function StartLayout({ children }: LayoutProps<"/start">) {
  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-rule bg-paper-raised px-4 py-3.5 sm:px-8">
        <Link href="/resumes" className="rounded-md" aria-label="Tailor, go to my resumes">
          <Wordmark />
        </Link>
        <Link
          href="/resumes"
          className="rounded-md px-2 py-1.5 text-[0.8125rem] font-medium text-ink-muted transition-colors hover:bg-paper-sunk hover:text-ink"
        >
          My resumes
        </Link>
      </header>

      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
