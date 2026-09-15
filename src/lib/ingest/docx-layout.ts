import JSZip from "jszip";

/**
 * DOCX ingest that keeps a handle on where each line came from.
 *
 * This is the one input format where true format preservation is possible. A
 * .docx is a zip whose `word/document.xml` holds real paragraphs with real
 * style references — so the new resume can be written back into the same
 * paragraph nodes, keeping every font, indent, table and spacing decision the
 * candidate made. A PDF offers nothing equivalent: it stores positioned glyphs,
 * not paragraphs, which is why that path has to rebuild rather than edit.
 */

export type DocxParagraph = {
  index: number;
  text: string;
  /** Byte offsets into document.xml, so the writer can splice precisely. */
  start: number;
  end: number;
  /** Paragraphs inside a <w:tbl> reflow differently; the writer leaves them alone. */
  inTable: boolean;
};

export type DocxLayout = {
  text: string;
  paragraphs: DocxParagraph[];
  /** The raw document.xml, retained so the writer edits the real bytes. */
  documentXml: string;
  originalZip: JSZip;
};

const PARAGRAPH_RE = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|<w:p(?:\s[^>]*)?\/>/g;
const TEXT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const TAB_RE = /<w:tab\b[^>]*\/>/g;
const BREAK_RE = /<w:br\b[^>]*\/>/g;

function unescapeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function escapeXml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Concatenated visible text of one paragraph's XML. */
function paragraphText(xml: string): string {
  const withMarkers = xml.replace(TAB_RE, "\t").replace(BREAK_RE, "\n");
  let out = "";
  let m: RegExpExecArray | null;
  const re = new RegExp(TEXT_RE.source, "g");
  while ((m = re.exec(withMarkers))) out += unescapeXml(m[1]);
  return out.replace(/[ \t]+/g, " ").trim();
}

/** Table ranges, so the writer can refuse to touch paragraphs inside them. */
function tableRanges(xml: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  const re = /<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) ranges.push({ start: m.index, end: m.index + m[0].length });
  return ranges;
}

export async function docxToLayout(bytes: Buffer | Uint8Array): Promise<DocxLayout> {
  const zip = await JSZip.loadAsync(bytes);
  const entry = zip.file("word/document.xml");
  if (!entry) {
    throw new Error("That .docx has no word/document.xml — it may be corrupt or not a Word file.");
  }
  const documentXml = await entry.async("string");

  const tables = tableRanges(documentXml);
  const inTable = (pos: number) => tables.some((t) => pos >= t.start && pos < t.end);

  const paragraphs: DocxParagraph[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(PARAGRAPH_RE.source, "g");
  let index = 0;
  while ((m = re.exec(documentXml))) {
    paragraphs.push({
      index: index++,
      text: paragraphText(m[0]),
      start: m.index,
      end: m.index + m[0].length,
      inTable: inTable(m.index),
    });
  }

  const text = paragraphs
    .map((p) => p.text)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, paragraphs, documentXml, originalZip: zip };
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Replaces a paragraph's visible text while leaving its formatting intact.
 *
 * Word routinely splits one sentence across several <w:t> runs — a spell-check
 * boundary or a bold word is enough to start a new run. The whole replacement
 * therefore goes into the first run, which carries the paragraph's dominant
 * formatting, and the remaining runs are emptied rather than deleted so their
 * run properties survive for anything that re-edits the file later.
 */
function replaceParagraphText(paragraphXml: string, newText: string): string {
  let first = true;
  let replaced = false;

  const out = paragraphXml.replace(
    /(<w:t)((?:\s[^>]*)?)(>)([\s\S]*?)(<\/w:t>)/g,
    (_full, open: string, attrs: string, close: string, _body: string, shut: string) => {
      if (first) {
        first = false;
        replaced = true;
        const withSpace = /xml:space=/.test(attrs) ? attrs : `${attrs} xml:space="preserve"`;
        return `${open}${withSpace}${close}${escapeXml(newText)}${shut}`;
      }
      return `${open}${attrs}${close}${shut}`;
    },
  );

  // A paragraph with no run at all (rare, but possible for an empty bullet)
  // cannot carry text without inventing formatting, so it is left untouched.
  return replaced ? out : paragraphXml;
}

export type DocxEdit = {
  paragraphIndex: number;
  /** New text, or null to blank the paragraph because the rewrite dropped it. */
  text: string | null;
};

export type DocxWriteResult = {
  bytes: Buffer;
  applied: number;
  skipped: { paragraphIndex: number; reason: string }[];
};

export async function writeDocx(
  layout: DocxLayout,
  edits: DocxEdit[],
): Promise<DocxWriteResult> {
  const skipped: { paragraphIndex: number; reason: string }[] = [];

  // Apply from the end backwards so earlier offsets stay valid.
  const ordered = [...edits].sort((a, b) => b.paragraphIndex - a.paragraphIndex);
  let xml = layout.documentXml;
  let applied = 0;

  for (const edit of ordered) {
    const para = layout.paragraphs[edit.paragraphIndex];
    if (!para) {
      skipped.push({ paragraphIndex: edit.paragraphIndex, reason: "no such paragraph" });
      continue;
    }
    if (para.inTable) {
      skipped.push({
        paragraphIndex: edit.paragraphIndex,
        reason: "inside a table; replacing it would reflow the cell",
      });
      continue;
    }
    const original = xml.slice(para.start, para.end);
    const updated = replaceParagraphText(original, edit.text ?? "");
    if (updated === original && edit.text !== null) {
      skipped.push({ paragraphIndex: edit.paragraphIndex, reason: "paragraph has no text run" });
      continue;
    }
    xml = xml.slice(0, para.start) + updated + xml.slice(para.end);
    applied++;
  }

  const zip = layout.originalZip;
  zip.file("word/document.xml", xml);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });

  return { bytes, applied, skipped };
}
