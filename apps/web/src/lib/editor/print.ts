/**
 * Turning the preview on screen into the page that gets printed.
 *
 * The download used to POST the document model to `/api/render`, which has
 * only ever accepted `{ html, filename }`. Two halves of one feature written
 * against different contracts: every click returned 400 and the button had
 * never worked.
 *
 * Rebuilding the page on the server from the model was the other option and
 * it is the worse one. The preview is already the exact markup the user is
 * looking at, with the density the fitter settled on baked into it, so
 * printing that is the only version that cannot drift from the screen.
 */

import { printDocument } from "@ats/templates";

export class PreviewMissingError extends Error {
  constructor() {
    super("The preview is not on screen, so there is nothing to print.");
    this.name = "PreviewMissingError";
  }
}

/** The template's own article, which carries the density and the styles. */
export function findSheet(root: ParentNode = document): HTMLElement | null {
  return root.querySelector<HTMLElement>("[data-resume-sheet] .rz");
}

/**
 * The live preview as a standalone HTML document.
 *
 * Density is read back off the element rather than passed in: the fitter sets
 * it during layout, so the element is the only thing that knows which rung
 * the page actually settled on.
 */
export function serializePreview(title: string, root: ParentNode = document): string {
  const sheet = findSheet(root);
  if (!sheet) throw new PreviewMissingError();

  const density = Number(sheet.dataset.density ?? "0");
  return printDocument(title, sheet.outerHTML, Number.isFinite(density) ? density : 0);
}

/**
 * A filename a file manager will accept, derived from the candidate's name.
 *
 * `\p{M}` is in the keep set alongside letters and numbers, and it is not
 * decoration: in Gujarati, Devanagari and most Indic scripts the vowel signs
 * are combining marks, so keeping only `\p{L}\p{N}` turns આદિત્ય into
 * "આદ-ત-ય". The candidate's own name is the last thing this should mangle.
 */
export function printFilename(name: string, fallback = "resume"): string {
  const base = name
    .trim()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `${(base || fallback).slice(0, 80)}.pdf`;
}
