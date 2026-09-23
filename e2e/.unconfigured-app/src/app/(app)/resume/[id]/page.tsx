/**
 * The editor.
 *
 * A Server Component, because the run is server data and the id in the URL is
 * the only thing the client needs to be told. Everything after that is local:
 * the score is computed in the browser, the preview renders the same template
 * component the PDF will, and the document is patched in place.
 *
 * Next 16: `params` and `searchParams` are Promises with no synchronous shim,
 * and `PageProps` is a global type generated into `.next/types` rather than an
 * import.
 *
 * `loadRun` never throws and never returns nothing, so there is no notFound()
 * here. A resume row that exists with no version yet is the normal state
 * during a tailoring run, and the right answer to it is the sample document
 * with a banner, not a dead end.
 */

import { EditorRoot } from "@/components/editor/EditorRoot";
import { loadRun } from "@/lib/editor/load";

export const dynamic = "force-dynamic";

export default async function ResumeEditorPage(props: PageProps<"/resume/[id]">) {
  const { id } = await props.params;
  const query = await props.searchParams;

  const documentId = typeof query.document === "string" ? query.document : undefined;
  const { run, sourceFile } = await loadRun(id, documentId);

  return <EditorRoot run={run} sourceFile={sourceFile} />;
}
