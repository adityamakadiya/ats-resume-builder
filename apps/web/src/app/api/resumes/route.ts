/**
 * POST /api/resumes
 *
 * Creates the resume the user is about to edit.
 *
 * The template id is checked against the registry rather than trusted.
 * `resumes.template_id` is plain text in Postgres, so an unknown value would
 * be stored happily and then fail at render time, in the editor, after the
 * user has done the work. Better to refuse it here.
 */

import { NextResponse } from "next/server";
import { DEFAULT_TEMPLATE_ID, TEMPLATES } from "@ats/templates";
import { getServerClient } from "@/lib/supabase/server";

function refuse(reason: string, remedy: string, status: number) {
  return NextResponse.json({ ok: false, reason, remedy }, { status });
}

export async function POST(request: Request) {
  const supabase = await getServerClient();
  if (!supabase) {
    return refuse(
      "This deployment has no database configured.",
      "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY, then restart the server.",
      503
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return refuse(
      "Your session has expired.",
      "Sign in again. Your template choice will be remembered in the address bar.",
      401
    );
  }

  let body: { templateId?: unknown; title?: unknown };
  try {
    body = await request.json();
  } catch {
    return refuse(
      "The request body was not readable.",
      "Reload the page and try again.",
      400
    );
  }

  const templateId =
    typeof body.templateId === "string" ? body.templateId : DEFAULT_TEMPLATE_ID;

  if (!(templateId in TEMPLATES)) {
    return refuse(
      `There is no template called "${templateId}".`,
      `Choose one of: ${Object.keys(TEMPLATES).join(", ")}.`,
      400
    );
  }

  const title =
    typeof body.title === "string" && body.title.trim() !== ""
      ? body.title.trim().slice(0, 120)
      : "Untitled resume";

  const { data, error } = await supabase
    .from("resumes")
    .insert({ user_id: user.id, template_id: templateId, title, status: "draft" })
    .select("id")
    .single();

  if (error) {
    return refuse(
      "The resume could not be created.",
      `${error.message}. Nothing was saved, so it is safe to try again.`,
      502
    );
  }

  return NextResponse.json({ ok: true, id: data.id });
}
