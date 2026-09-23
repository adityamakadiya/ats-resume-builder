/**
 * /start
 *
 * Step one of two. The step counter is real: there is exactly one screen
 * after this one before the editor, and saying so is the difference between
 * a funnel someone finishes and one they abandon on suspicion it is longer.
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
        <p className="label">Step 1 of 2</p>
        <h1 className="mt-2.5 font-display text-4xl leading-[1.05] text-ink sm:text-5xl">
          Where should this one start?
        </h1>
        <p className="mt-3.5 text-[0.9375rem] leading-relaxed text-ink-muted">
          Either way you choose a template next, then paste the job
          description. Nothing is sent anywhere until you ask for it.
        </p>
      </header>

      <div className="mt-9">
        {config.ok ? (
          <ChooseSource />
        ) : (
          <SetupNotice missing={config.missing} context="Uploading a resume" />
        )}
      </div>
    </div>
  );
}
