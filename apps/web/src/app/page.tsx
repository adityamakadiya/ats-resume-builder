/**
 * /
 *
 * A junction, not a landing page, and now a junction with one exit. There is
 * no sign in, so there is nothing to decide: landing here goes straight into
 * the library.
 *
 * Not even the setup panel renders here any more. /resumes shows it when the
 * environment is missing, which is a better place for it: it is the screen
 * the person was going to anyway.
 *
 * The single-page prototype that used to live here is still on disk in
 * src/app/_components. It is being mined for the editor rather than deleted.
 */

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/resumes");
}
