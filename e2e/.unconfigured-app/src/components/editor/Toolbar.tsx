"use client";

/**
 * The strip along the top: what this document is, and the four things you do
 * to the whole of it.
 *
 * Undo and redo are buttons as well as shortcuts. The keyboard path is the one
 * people use, but a control that exists only as a shortcut is invisible, and
 * the disabled state is also the only honest indicator of whether there is
 * anything to undo.
 *
 * Download states its failure in words. It is the one action somebody takes
 * immediately before sending the file to an employer, so a silent no-op there
 * is the worst bug this screen could have.
 */

import { useState } from "react";
import { templateList } from "@ats/templates";
import { requestRender } from "@/lib/editor/api";
import type { SaveState } from "@/lib/store/editor";

export type ToolbarProps = {
  title: string;
  templateId: string;
  canUndo: boolean;
  canRedo: boolean;
  saveState: SaveState;
  onTemplate: (id: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  resumeId: string;
  doc: unknown;
};

function saveLabel(state: SaveState): string {
  switch (state.kind) {
    case "sample":
      return "Not saved";
    case "clean":
      return "Saved";
    case "dirty":
      return "Unsaved changes";
    case "saving":
      return "Saving";
    case "saved":
      return "Saved";
    case "failed":
      return "Save failed";
  }
}

export function Toolbar({
  title,
  templateId,
  canUndo,
  canRedo,
  saveState,
  onTemplate,
  onUndo,
  onRedo,
  resumeId,
  doc,
}: ToolbarProps) {
  const [downloading, setDownloading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function download() {
    setDownloading(true);
    setProblem(null);
    const result = await requestRender({ resumeId, templateId, doc });
    setDownloading(false);

    if (!result.ok) {
      setProblem(result.hint ? `${result.message} ${result.hint}` : result.message);
      return;
    }
    const link = document.createElement("a");
    link.href = result.url;
    link.download = `${title.replace(/[^\w\s-]/g, "").trim() || "resume"}.pdf`;
    link.click();
    URL.revokeObjectURL(result.url);
  }

  return (
    <div className="border-b border-rule">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
        <h1 className="min-w-0 truncate font-display text-[1.25rem] leading-none text-ink">
          {title}
        </h1>
        <span
          className={`shrink-0 font-mono text-[0.625rem] tracking-wider uppercase ${
            saveState.kind === "failed" ? "text-stamp" : "text-ink-faint"
          }`}
        >
          {saveLabel(saveState)}
        </span>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span className="label">Template</span>
            <select
              value={templateId}
              onChange={(event) => onTemplate(event.target.value)}
              className="rounded-xs border border-rule bg-paper-raised px-1.5 py-1 text-[0.8125rem] text-ink outline-none hover:border-rule-strong"
            >
              {templateList().map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.atsSafe ? "" : " (risky)"}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              aria-keyshortcuts="Meta+Z Control+Z"
              className="rounded-xs border border-rule px-2 py-1 text-[0.8125rem] text-ink-muted hover:border-rule-strong hover:text-ink disabled:opacity-35"
            >
              Undo
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z"
              className="-ml-px rounded-xs border border-rule px-2 py-1 text-[0.8125rem] text-ink-muted hover:border-rule-strong hover:text-ink disabled:opacity-35"
            >
              Redo
            </button>
          </div>

          <button
            type="button"
            onClick={() => void download()}
            disabled={downloading}
            className="rounded-xs border border-ink bg-ink px-3 py-1 text-[0.8125rem] text-paper-raised hover:bg-ink/85 disabled:opacity-50"
          >
            {downloading ? "Rendering the PDF" : "Download"}
          </button>
        </div>
      </div>

      {problem && (
        <p role="status" className="border-t border-rule bg-caution-soft px-4 py-2 text-[0.8125rem] text-caution">
          {problem}
        </p>
      )}
    </div>
  );
}
