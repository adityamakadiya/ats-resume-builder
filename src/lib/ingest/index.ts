import mammoth from "mammoth";
import { docxToLayout, type DocxLayout } from "./docx-layout";
import { pdfToLayout, type StyleProfile } from "./layout";

export type ResumeUpload = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

/**
 * How faithfully the original can be reproduced:
 *  - exact:  DOCX. New text goes into the same paragraph nodes, so every font,
 *            indent and spacing decision survives untouched.
 *  - visual: PDF. A PDF stores positioned glyphs, not paragraphs, and the
 *            rewritten lines are a different length, so the layout has to be
 *            rebuilt from the measured style rather than edited.
 *  - none:   plain text. There was never a format to keep.
 */
export type Preservability = "exact" | "visual" | "none";

export type SourceDocument = {
  kind: "pdf" | "docx" | "text";
  rawText: string;
  style: StyleProfile | null;
  docx: DocxLayout | null;
  pageCount: number;
  preservable: Preservability;
  /** Anything the candidate should know about how their file was read. */
  notes: string[];
};

export async function ingestResume(upload: ResumeUpload): Promise<SourceDocument> {
  const ext = upload.filename.toLowerCase().split(".").pop() ?? "";
  const notes: string[] = [];

  let doc: SourceDocument;

  if (ext === "pdf" || upload.mimeType === "application/pdf") {
    const layout = await pdfToLayout(upload.bytes);
    if (layout.style.columnCount > 1) {
      notes.push(
        "This resume is laid out in two columns. Columns were detected and each was read " +
          "separately — without that, the sidebar interleaves with the body and every " +
          "extracted fact is scrambled. Many ATS parsers do not do this.",
      );
    }
    if (!layout.style.confidence.fonts) {
      notes.push("Font names could not be read from this PDF, so the rebuild uses a matched default.");
    }
    doc = {
      kind: "pdf",
      rawText: layout.text,
      style: layout.style,
      docx: null,
      pageCount: layout.pageCount,
      preservable: "visual",
      notes,
    };
  } else if (ext === "docx" || upload.mimeType.includes("wordprocessingml")) {
    const layout = await docxToLayout(upload.bytes);
    // mammoth's reader handles numbering and field codes that the raw XML walk
    // does not, so it wins for the text the model reads. The paragraph index
    // from the XML walk is what makes preservation possible.
    const { value } = await mammoth.extractRawText({ buffer: upload.bytes });
    const richer = value.trim().length > layout.text.length ? value : layout.text;
    doc = {
      kind: "docx",
      rawText: richer,
      style: null,
      docx: layout,
      pageCount: 0,
      preservable: "exact",
      notes,
    };
  } else if (ext === "txt" || ext === "md" || upload.mimeType.startsWith("text/")) {
    doc = {
      kind: "text",
      rawText: upload.bytes.toString("utf8"),
      style: null,
      docx: null,
      pageCount: 0,
      preservable: "none",
      notes: ["A plain-text upload carries no formatting, so the ATS layout is the only output."],
    };
  } else {
    throw new Error(
      `Unsupported resume format '.${ext}'. Upload a PDF, DOCX, TXT or Markdown file.`,
    );
  }

  doc.rawText = doc.rawText
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (doc.rawText.length < 200) {
    throw new Error(
      "Almost no text came out of that file. If it is a scanned or image-based PDF, " +
        "export a text PDF or paste the resume as text instead.",
    );
  }

  return doc;
}

export type { StyleProfile } from "./layout";
