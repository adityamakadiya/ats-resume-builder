"use client";

/**
 * The upload target.
 *
 * Three things it refuses to do, all of which are common and all of which
 * are defects:
 *
 *   1. Show a bare spinner. Every busy state below names the step it is on
 *      ("Uploading …", "Storing …"), because a person watching a resume
 *      upload wants to know whether the slow part is their connection or our
 *      server.
 *   2. Swallow a rejection. Errors render as reason plus remedy in an
 *      aria-live region, so a screen reader hears the same sentence a sighted
 *      user reads.
 *   3. Be mouse only. The panel is a real <button>, so Enter and Space open
 *      the picker and the focus ring is the same one used everywhere else.
 */

import { useCallback, useId, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import {
  ACCEPT_ATTRIBUTE,
  MAX_BYTES,
  formatBytes,
  validateDrop,
  validateResumeFile,
  type ValidationError,
} from "./validate";

export type UploadPhase =
  | { kind: "idle" }
  | { kind: "busy"; step: string }
  | { kind: "failed"; reason: string; remedy: string };

export type DropzoneProps = {
  /** Called once a file has passed validation. */
  onAccept: (file: File) => void;
  /** Progress reported by the parent, which owns the network call. */
  phase?: UploadPhase;
  disabled?: boolean;
};

export function Dropzone({ onAccept, phase = { kind: "idle" }, disabled }: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [local, setLocal] = useState<ValidationError | null>(null);
  const [accepted, setAccepted] = useState<File | null>(null);
  const statusId = useId();
  const hintId = useId();

  const busy = phase.kind === "busy";
  const error =
    local ??
    (phase.kind === "failed"
      ? { reason: phase.reason, remedy: phase.remedy }
      : null);

  const take = useCallback(
    (files: File[]) => {
      const result = files.length === 1 ? validateResumeFile(files[0]) : validateDrop(files);
      if (!result.ok) {
        setLocal(result);
        setAccepted(null);
        return;
      }
      setLocal(null);
      setAccepted(result.file);
      onAccept(result.file);
    },
    [onAccept]
  );

  const open = useCallback(() => {
    if (busy || disabled) return;
    inputRef.current?.click();
  }, [busy, disabled]);

  return (
    <div className="flex h-full flex-col">
      <button
        type="button"
        onClick={open}
        disabled={busy || disabled}
        aria-describedby={`${hintId} ${statusId}`}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!busy && !disabled) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy && !disabled) setDragging(true);
        }}
        onDragLeave={(event) => {
          // Only clear when the pointer actually left the panel, not a child.
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (busy || disabled) return;
          take(Array.from(event.dataTransfer?.files ?? []));
        }}
        className={[
          "group relative flex w-full flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-10 text-center transition-colors duration-150",
          "disabled:cursor-progress",
          dragging
            ? "border-stamp bg-stamp-soft"
            : error
              ? "border-[var(--refused)]/50 bg-[var(--refused-soft)]/40"
              : "border-rule-strong bg-paper-sunk/50 hover:border-stamp hover:bg-stamp-soft/50",
        ].join(" ")}
      >
        {busy ? (
          <>
            <div
              aria-hidden="true"
              className="sweeping h-px w-32 rounded-full"
              style={{ minHeight: 2 }}
            />
            <p className="font-mono text-[0.8125rem] text-ink">{phase.step}</p>
            <p className="max-w-[26ch] text-[0.8125rem] leading-relaxed text-ink-muted">
              Keep this tab open. Nothing is read from the file until it is
              safely stored.
            </p>
          </>
        ) : accepted ? (
          <>
            <p className="inline-flex items-center rounded-full bg-traced-soft px-2.5 py-1 text-[0.75rem] font-medium text-traced">
              File ready
            </p>
            <p className="max-w-[30ch] text-[0.9375rem] leading-snug break-all text-ink">
              {accepted.name}
            </p>
            <p className="font-mono text-[0.75rem] text-ink-muted">
              {formatBytes(accepted.size)}
            </p>
            <span className="mt-1 text-[0.8125rem] font-medium text-[var(--stamp-strong)] underline-offset-4 group-hover:underline">
              Choose a different file
            </span>
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="grid size-10 place-items-center rounded-full bg-stamp-soft text-stamp"
            >
              <UploadCloud className="size-5" />
            </span>
            <p className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-ink">
              Drop your resume here
            </p>
            <p id={hintId} className="text-[0.8125rem] leading-relaxed text-ink-muted">
              PDF or DOCX, up to {formatBytes(MAX_BYTES)}.
              <br />
              Or press Enter to browse.
            </p>
          </>
        )}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          take(Array.from(event.target.files ?? []));
          // Reset so re-picking the same file fires change again.
          event.target.value = "";
        }}
      />

      <div id={statusId} role="status" aria-live="polite" className="min-h-[3.25rem] pt-3">
        {error ? (
          <p className="rounded-lg border border-[var(--refused)]/25 bg-[var(--refused-soft)] px-3 py-2.5 text-[0.8125rem] leading-relaxed text-ink">
            <span className="font-medium text-[var(--refused)]">{error.reason}</span>{" "}
            {error.remedy}
          </p>
        ) : null}
      </div>
    </div>
  );
}
