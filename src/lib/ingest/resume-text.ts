import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export type ResumeUpload = {
  filename: string;
  mimeType: string;
  bytes: Buffer;
};

/**
 * Turns an uploaded resume into plain text. This text is the ground truth the
 * whole pipeline is measured against, so nothing is normalized away here beyond
 * whitespace — the truth guard needs the candidate's own wording intact.
 */
export async function resumeToText(upload: ResumeUpload): Promise<string> {
  const ext = upload.filename.toLowerCase().split(".").pop() ?? "";

  let text: string;
  if (ext === "pdf" || upload.mimeType === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(upload.bytes));
    const { text: pages } = await extractText(pdf, { mergePages: true });
    text = Array.isArray(pages) ? pages.join("\n") : pages;
  } else if (ext === "docx" || upload.mimeType.includes("wordprocessingml")) {
    const { value } = await mammoth.extractRawText({ buffer: upload.bytes });
    text = value;
  } else if (ext === "txt" || ext === "md" || upload.mimeType.startsWith("text/")) {
    text = upload.bytes.toString("utf8");
  } else {
    throw new Error(
      `Unsupported resume format '.${ext}'. Upload a PDF, DOCX, TXT or Markdown file.`,
    );
  }

  const cleaned = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  if (cleaned.length < 200) {
    throw new Error(
      "Almost no text came out of that file. If it is a scanned or image-based PDF, " +
        "export a text PDF or paste the resume as text instead.",
    );
  }
  return cleaned;
}
