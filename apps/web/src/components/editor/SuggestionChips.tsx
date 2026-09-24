"use client";

/**
 * The seam between the editor's left rail and the gap panel.
 *
 * The panel itself is `KeywordGapPanel`, which is pure: it takes the posting,
 * the facts, the document, the score and the gap analysis, and it hands a
 * chosen placement back. This file is the twenty lines that connect it to the
 * store, and it keeps the old name and the old props so the rail's single
 * import line did not have to change.
 *
 * The one piece of judgement here is which store action an applied placement
 * goes through, and it is the provenance rule in code:
 *
 *   skills   `addSuggestion`, which records `asserted:<term>` in `editedKeys`
 *            for an amber term and nothing for a green one. That distinction
 *            is the traced badge's, and it stays where the store already
 *            makes it rather than being reimplemented here.
 *
 *   bullet   `applyUserOps` with no keys, because a restored bullet is a line
 *            the parsed resume already contains, put back verbatim, carrying
 *            the source id it came with. It is traced, not asserted, and only
 *            ever offered for a green term.
 */

import type { AtsReport } from "@ats/core";
import type { ResumeDoc } from "@ats/templates";
import type { Placement, Suggestion } from "@/lib/editor/gaps";
import { useEditorStore } from "@/lib/store/editor";
import { KeywordGapPanel } from "./KeywordGapPanel";

export type SuggestionChipsProps = {
  report: AtsReport | null;
  doc: ResumeDoc;
  onAdd: (term: string, kind: "recoverable" | "missing") => void;
};

export function SuggestionChips({ report, doc, onAdd }: SuggestionChipsProps) {
  /*
    The posting, the facts and the gap analysis come from the store rather
    than from props. They are the same three values the score is already a
    function of, and threading them through the rail would have meant editing
    a file this change does not own.
  */
  const job = useEditorStore((s) => s.job);
  const facts = useEditorStore((s) => s.facts);
  const gaps = useEditorStore((s) => s.gaps);
  const applyUserOps = useEditorStore((s) => s.applyUserOps);

  function apply(suggestion: Suggestion, placement: Placement) {
    if (placement.kind === "skills") {
      onAdd(suggestion.term, suggestion.kind);
      return;
    }
    applyUserOps(placement.ops, `Restored a line naming ${suggestion.term}`, []);
  }

  return (
    <KeywordGapPanel
      job={job}
      facts={facts}
      doc={doc}
      report={report}
      gaps={gaps}
      onApply={apply}
    />
  );
}
