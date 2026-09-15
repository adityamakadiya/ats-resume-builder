/**
 * Superseded by `./index.ts`, which reads geometry as well as characters.
 *
 * Kept only so the old import path keeps resolving; it delegates rather than
 * duplicating the extraction logic. Safe to delete once nothing imports it.
 */
import { ingestResume, type ResumeUpload } from "./index";

export type { ResumeUpload };

/** @deprecated Use `ingestResume`, which also returns the style profile. */
export async function resumeToText(upload: ResumeUpload): Promise<string> {
  const { rawText } = await ingestResume(upload);
  return rawText;
}
