"use client";

/**
 * The three columns, and the keyboard.
 *
 * Left is what the document is worth and what it is made of. Centre is the
 * conversation and the changes it proposes. Right is the thing that will
 * actually be sent. The order is deliberate: judgement, then negotiation, then
 * artefact, left to right, the way the work moves.
 *
 * Undo is intercepted at the window rather than left to the browser. Every
 * field here is controlled and every keystroke is already an op, so the
 * native textarea undo stack would restore text the store has never heard of
 * and the score, the preview and the traced badge would all disagree with the
 * field. One history, and it is the one in `@ats/core`.
 *
 * Below the lg breakpoint the columns stack and the preview moves behind a
 * toggle. Editing is never what gets dropped on a small screen: somebody
 * fixing a typo on a phone twenty minutes before a deadline is a real person.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorRun } from "@/lib/editor/fixtures";
import { countLines } from "@/lib/editor/doc";
import {
  selectCanRedo,
  selectCanUndo,
  openViolations,
  useEditorStore,
} from "@/lib/store/editor";
import { ChatPanel } from "./ChatPanel";
import { FormPanel } from "./FormPanel";
import { PreviewPane } from "./PreviewPane";
import { ScoreCard } from "./ScoreCard";
import { SuggestionChips } from "./SuggestionChips";
import { Toolbar } from "./Toolbar";
import { TracedBadge } from "./TracedBadge";
import { UnverifiableDialog } from "./UnverifiableDialog";

function Fold({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <details className="border-t border-rule py-2.5">
      <summary className="label flex cursor-pointer list-none items-center gap-2 select-none hover:text-ink">
        {title}
        {count !== undefined && <span className="font-mono tabular-nums">{count}</span>}
      </summary>
      <div className="mt-2 space-y-2 text-[0.8125rem] leading-snug text-ink-muted">{children}</div>
    </details>
  );
}

export function EditorRoot({ run, sourceFile }: { run: EditorRun; sourceFile: string | null }) {
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const init = useEditorStore((s) => s.init);
  const resumeId = useEditorStore((s) => s.resumeId);
  const title = useEditorStore((s) => s.title);
  const doc = useEditorStore((s) => s.doc);
  const report = useEditorStore((s) => s.report);
  const breakdown = useEditorStore((s) => s.breakdown);
  const gaps = useEditorStore((s) => s.gaps);
  const facts = useEditorStore((s) => s.facts);
  const editedKeys = useEditorStore((s) => s.editedKeys);
  const templateId = useEditorStore((s) => s.templateId);
  const zoom = useEditorStore((s) => s.zoom);
  const saveState = useEditorStore((s) => s.saveState);
  const lastError = useEditorStore((s) => s.lastError);
  const unverifiableOpen = useEditorStore((s) => s.unverifiableOpen);
  const truthViolations = useEditorStore((s) => s.truth.violations);
  const droppedViolations = useEditorStore((s) => s.droppedViolations);
  // Derived in render, not in the selector. See openViolations.
  const violations = useMemo(
    () => openViolations(truthViolations, droppedViolations),
    [truthViolations, droppedViolations]
  );
  const canUndo = useEditorStore(selectCanUndo);
  const canRedo = useEditorStore(selectCanRedo);

  /*
    The run is server data, and loading it is the one moment the store is
    replaced wholesale rather than patched. It is keyed on the document it
    describes rather than on object identity: a router refresh hands down a
    structurally identical `run` as a new object, and re-running init on that
    would silently throw away everything the user had typed.
  */
  const loaded = useRef<string | null>(null);
  const runKey = `${run.resumeId}:${run.versionId}`;
  useEffect(() => {
    if (loaded.current === runKey) return;
    loaded.current = runKey;
    init(run);
  }, [init, run, runKey]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      const store = useEditorStore.getState();
      if (event.shiftKey) store.redo();
      else store.undo();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const ask = useCallback((question: string) => {
    useEditorStore.getState().closeUnverifiable();
    setPrefill({ text: question, nonce: Date.now() });
  }, []);

  const lines = countLines(doc);
  const store = useEditorStore.getState();

  return (
    <div className="flex h-[calc(100dvh-1px)] min-h-0 flex-col">
      <Toolbar
        title={title}
        templateId={templateId}
        canUndo={canUndo}
        canRedo={canRedo}
        saveState={saveState}
        onTemplate={store.setTemplate}
        onUndo={store.undo}
        onRedo={store.redo}
        resumeId={resumeId}
        doc={doc}
      />

      {saveState.kind === "sample" && (
        <p
          role="status"
          className="flex flex-wrap items-center gap-x-2 border-b border-rule bg-caution-soft px-4 py-2 text-[0.8125rem] text-caution"
        >
          <span className="font-mono text-[0.625rem] tracking-wider uppercase">Sample document, not saved</span>
          <span className="text-ink-muted">
            The database schema is not applied yet, so there is no version to load. Everything
            here works, nothing here is being stored.
            {sourceFile ? ` Your upload, ${sourceFile}, was received.` : ""}
          </span>
        </p>
      )}

      {lastError && (
        <p role="alert" className="border-b border-rule bg-stamp-soft px-4 py-2 text-[0.8125rem] text-stamp">
          {lastError}
        </p>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)_minmax(24rem,1fr)]">
        {/* left */}
        <aside className="min-h-0 overflow-y-auto border-rule px-4 py-4 lg:border-r">
          <ScoreCard report={report} breakdown={breakdown} />

          <div className="mt-4">
            <TracedBadge
              traced={lines.traced}
              total={lines.total}
              editedCount={editedKeys.size}
              refusedCount={violations.length}
              onShowRefused={store.openUnverifiable}
            />
          </div>

          <div className="mt-4">
            <SuggestionChips report={report} doc={doc} onAdd={store.addSuggestion} />
          </div>

          <div className="mt-4">
            {gaps.recruiter_concerns.length > 0 && (
              <Fold title="A screener will hesitate on" count={gaps.recruiter_concerns.length}>
                <ul className="list-disc space-y-1 pl-4">
                  {gaps.recruiter_concerns.map((concern, i) => (
                    <li key={i}>{concern}</li>
                  ))}
                </ul>
              </Fold>
            )}

            {gaps.missing.length > 0 && (
              <Fold title="Gaps you cannot edit away" count={gaps.missing.length}>
                <ul className="space-y-1.5">
                  {gaps.missing.map((item, i) => (
                    <li key={i}>
                      <span className="text-ink">{item.jd_term}</span>
                      <span className="font-mono text-[0.625rem] tracking-wider text-ink-faint uppercase">
                        {" "}
                        {item.severity}
                      </span>
                      <span className="block">{item.note}</span>
                    </li>
                  ))}
                </ul>
              </Fold>
            )}

            {report.recommendations.length > 0 && (
              <Fold title="What to do next" count={report.recommendations.length}>
                <ol className="list-decimal space-y-1 pl-4">
                  {report.recommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ol>
              </Fold>
            )}

            {doc.rewrite_notes.length > 0 && (
              <Fold title="What the rewrite changed" count={doc.rewrite_notes.length}>
                <ul className="list-disc space-y-1 pl-4">
                  {doc.rewrite_notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </Fold>
            )}
          </div>

          <div className="mt-5 border-t border-rule pt-3">
            <h2 className="label">The document</h2>
            <div className="mt-2">
              <FormPanel
                doc={doc}
                editedKeys={editedKeys}
                onEdit={store.editField}
                onOps={(ops, label, keys) => store.applyUserOps(ops, label, keys)}
              />
            </div>
          </div>
        </aside>

        {/* centre */}
        <div className="min-h-0 border-rule xl:border-r">
          <ChatPanel prefill={prefill} />
        </div>

        {/* right */}
        <div className="hidden min-h-0 xl:block">
          <PreviewPane doc={doc} templateId={templateId} zoom={zoom} onZoom={store.setZoom} />
        </div>
      </div>

      {/* Below xl the preview is a toggle rather than a column. */}
      <div className="border-t border-rule px-4 py-2 xl:hidden">
        <button
          type="button"
          aria-expanded={previewOpen}
          onClick={() => setPreviewOpen((open) => !open)}
          className="rounded-xs border border-rule-strong px-3 py-1 text-[0.8125rem] text-ink hover:bg-paper-sunk"
        >
          {previewOpen ? "Hide the preview" : "Show the preview"}
        </button>
      </div>

      {previewOpen && (
        <div className="fixed inset-0 z-40 bg-paper xl:hidden">
          <div className="flex items-center justify-between border-b border-rule px-4 py-2">
            <span className="label">Preview</span>
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="rounded-xs border border-rule-strong px-2 py-1 text-[0.8125rem]"
            >
              Close
            </button>
          </div>
          <div className="h-[calc(100dvh-3rem)]">
            <PreviewPane doc={doc} templateId={templateId} zoom={zoom} onZoom={store.setZoom} />
          </div>
        </div>
      )}

      <UnverifiableDialog
        open={unverifiableOpen}
        violations={violations}
        doc={doc}
        facts={facts}
        onClose={store.closeUnverifiable}
        onAsk={ask}
        onDrop={store.dropViolation}
      />
    </div>
  );
}
