/**
 * The shell that wraps every signed-in screen.
 *
 * A route group, so the URLs stay /dashboard and /resumes with no (app)
 * segment in them. The onboarding funnel at /start deliberately sits outside
 * this group: a sidebar full of things you have not made yet is noise on the
 * screen where you are making your first one.
 *
 * The proxy has already redirected anonymous visitors, so reaching this
 * layout without a user means Supabase is not configured. The shell still
 * renders, because the setup panel inside it is more useful than a redirect
 * loop between /login and here.
 */

import { AppShell } from "@/components/shell/app-shell";
import { getCurrentUser } from "@/lib/supabase/server";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();

  return <AppShell email={user?.email ?? null}>{children}</AppShell>;
}
