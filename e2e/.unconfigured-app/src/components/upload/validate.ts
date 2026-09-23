/**
 * Client-side file validation for the resume upload.
 *
 * Pure, synchronous and free of DOM types beyond `File`, so it is testable on
 * its own and cannot drift from the copy the dropzone shows: the message IS
 * the return value, not something the component composes afterwards.
 *
 * Every rejection has to answer two questions, because a user staring at a
 * red box can only act on the second one:
 *   what happened, and what do I do instead.
 * `reason` is the first. `remedy` is the second. Neither is optional.
 *
 * The server revalidates all of this. Nothing here is a security control; it
 * exists so a 14MB scan fails in 2ms on the desk instead of 30s up the wire.
 */

export const MAX_BYTES = 10 * 1024 * 1024;

export type AcceptedKind = "pdf" | "docx";

/**
 * Extension is the primary check, not the MIME type.
 *
 * Browsers disagree about `File.type` for .docx: Chrome usually reports the
 * full OOXML type, Safari has been known to send an empty string, and a file
 * dragged from a zip viewer can arrive as application/octet-stream. Rejecting
 * on MIME alone therefore rejects real resumes. The extension is what the
 * user can see and reason about, so it is what we judge, and the MIME type is
 * only consulted to catch a file that is plainly something else.
 */
const ACCEPTED: Record<AcceptedKind, { extensions: string[]; mimes: string[] }> = {
  pdf: { extensions: [".pdf"], mimes: ["application/pdf"] },
  docx: {
    extensions: [".docx"],
    mimes: [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
  },
};

/** What an <input type="file"> accept attribute should say. */
export const ACCEPT_ATTRIBUTE =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type ValidationOk = { ok: true; kind: AcceptedKind; file: File };

export type ValidationError = {
  ok: false;
  /** Stable code, for tests and for telemetry that is not string matching. */
  code: "empty" | "too-large" | "wrong-type" | "unnamed";
  /** What happened, in the user's terms. */
  reason: string;
  /** What to do about it. */
  remedy: string;
};

export type ValidationResult = ValidationOk | ValidationError;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  // One decimal below 10MB, none above: "12MB" reads faster than "12.4MB".
  return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function kindOf(file: File): AcceptedKind | null {
  const ext = extensionOf(file.name);
  for (const kind of Object.keys(ACCEPTED) as AcceptedKind[]) {
    if (ACCEPTED[kind].extensions.includes(ext)) return kind;
  }
  return null;
}

export function validateResumeFile(file: File | null | undefined): ValidationResult {
  if (!file) {
    return {
      ok: false,
      code: "empty",
      reason: "No file came through.",
      remedy: "Try dragging it again, or use the browse button to pick it.",
    };
  }

  if (!file.name) {
    return {
      ok: false,
      code: "unnamed",
      reason: "That file arrived without a name, so its format cannot be read.",
      remedy: "Save it to disk as a PDF or DOCX first, then upload that.",
    };
  }

  const kind = kindOf(file);

  if (!kind) {
    const ext = extensionOf(file.name);
    const shown = ext ? ext.replace(".", "").toUpperCase() : "no extension";
    const hint =
      ext === ".doc"
        ? " Word can save a .doc as .docx with File, Save As."
        : ext === ".txt" || ext === ".md" || ext === ".rtf"
          ? " Plain text loses the layout we read structure from, so export a PDF instead."
          : ext === ".pages"
            ? " Pages can export a PDF with File, Export To, PDF."
            : "";
    return {
      ok: false,
      code: "wrong-type",
      reason: `${file.name} is ${shown}, and we read PDF or DOCX.`,
      remedy: `Export or save it as a PDF and upload that.${hint}`,
    };
  }

  if (file.size === 0) {
    return {
      ok: false,
      code: "empty",
      reason: `${file.name} is empty, 0 bytes.`,
      remedy: "Check the file opens on your machine, then upload it again.",
    };
  }

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      code: "too-large",
      reason: `${file.name} is ${formatBytes(file.size)}, over the ${formatBytes(
        MAX_BYTES
      )} limit.`,
      remedy:
        kind === "pdf"
          ? "A resume this size is almost always embedded images. Re-export it as text, or compress it, and try again."
          : "Remove embedded images from the document, or export it as a PDF, and try again.",
    };
  }

  /*
    The MIME check runs last and only fires on a positive contradiction, never
    on an empty or unknown type. See the note on ACCEPTED above.
  */
  const declared = (file.type || "").toLowerCase();
  if (declared && !ACCEPTED[kind].mimes.includes(declared)) {
    const looksZipped = declared === "application/zip" && kind === "docx";
    if (!looksZipped) {
      return {
        ok: false,
        code: "wrong-type",
        reason: `${file.name} is named .${kind} but its contents are ${declared}.`,
        remedy:
          "Open it, save it again in the right format, and upload the new copy.",
      };
    }
  }

  return { ok: true, kind, file };
}

/**
 * A drop can carry several files. We take one resume, and we say so rather
 * than silently using the first.
 */
export function validateDrop(files: File[]): ValidationResult {
  if (files.length === 0) {
    return {
      ok: false,
      code: "empty",
      reason: "Nothing was dropped.",
      remedy: "Drag a PDF or DOCX onto the panel, or use the browse button.",
    };
  }
  if (files.length > 1) {
    return {
      ok: false,
      code: "wrong-type",
      reason: `${files.length} files were dropped, and we tailor one resume at a time.`,
      remedy: "Drop just the resume you want to work on.",
    };
  }
  return validateResumeFile(files[0]);
}
