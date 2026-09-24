/**
 * The shell that wraps every screen in the app proper.
 *
 * A route group, so the URLs stay /dashboard and /resumes with no (app)
 * segment in them. The onboarding funnel at /start deliberately sits outside
 * this group: a sidebar full of things you have not made yet is noise on the
 * screen where you are making your first one.
 *
 * Nothing is gated. There is no session to check and nobody to turn away, so
 * this layout has no data to fetch and can stay synchronous.
 */

import { AppShell } from "@/components/shell/app-shell";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return <AppShell>{children}</AppShell>;
}
