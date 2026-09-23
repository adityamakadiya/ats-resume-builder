/**
 * /
 *
 * A junction, not a landing page. Signed in goes to the library, signed out
 * goes to sign in. The one thing it renders on its own is the setup panel,
 * because when nothing is configured neither of those destinations can work
 * and sending someone to a login form that cannot log anyone in would waste
 * their time.
 *
 * The single-page prototype that used to live here is still on disk in
 * src/app/_components. It is being mined for the editor rather than deleted.
 */

import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { SetupNotice } from "@/components/setup-notice";
import { supabaseConfig } from "@/lib/supabase/config";
import { getCurrentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const config = supabaseConfig();

  if (config.ok) {
    const user = await getCurrentUser();
    redirect(user ? "/resumes" : "/login");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="px-5 py-5 sm:px-8">
        <Wordmark />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center px-5 py-8 sm:px-8">
        <SetupNotice missing={config.missing} context="Tailor" />
      </main>
    </div>
  );
}
