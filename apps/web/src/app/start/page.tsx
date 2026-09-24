/**
 * /start
 *
 * Step one of three. The step counter is real: there are exactly two screens
 * after this one before the editor, and saying so is the difference between
 * a funnel someone finishes and one they abandon on suspicion it is longer.
 *
 * It read "1 of 2" until the posting became a step of its own. The posting
 * was always going to be asked for; it was asked for after the editor had
 * opened, which made the count technically true and practically a lie.
 */

import type { Metadata } from "next";
import { ChooseSource } from "@/components/start/choose-source";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfig } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Start a resume | Tailor",
};

export default function StartPage() {
  const config = supabaseConfig();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="max-w-2xl">
        <p className="inline-flex items-center rounded-full bg-stamp-soft px-2.5 py-1 text-[0.75rem] font-medium text-[var(--stamp-strong)]">
          Step 1 of 3
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-[2rem]">
          Where should this one start?
        </h1>
        <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink-muted">
          Either way you choose a template next, then add the job posting.
          Nothing is sent anywhere until you ask for it.
        </p>
      </header>

      <div className="mt-8">
        {config.ok ? (
          <ChooseSource />
        ) : (
          <SetupNotice missing={config.missing} context="Uploading a resume" />
        )}
      </div>
    </div>
  );
}
