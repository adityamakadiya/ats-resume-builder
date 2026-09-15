import { getDocumentProxy } from "unpdf";

/**
 * Layout-aware PDF ingest.
 *
 * The naive path — pdf in, one string out — is wrong for two reasons. It loses
 * every visual decision the candidate made, so their format can never be
 * reproduced; and on a two-column resume it can interleave the sidebar with the
 * body, producing text like "JavaScript Backend Engineer at Acme TypeScript".
 * That second failure is silent and total: the extracted facts are garbage, the
 * rewrite is garbage, and the truth guard cannot catch it because the garbage
 * genuinely is in the source text.
 *
 * So this module reads geometry, not just characters: it finds the columns,
 * reads each one top to bottom in isolation, and records enough of the visual
 * design to rebuild something that looks like the original.
 */

export type Span = {
  text: string;
  /** Left edge in PDF points. Origin is bottom-left, so y grows upward. */
  x: number;
  y: number;
  width: number;
  fontSize: number;
  fontKey: string;
  page: number;
};

export type Line = {
  text: string;
  x: number;
  y: number;
  page: number;
  column: number;
  fontSize: number;
  /** True when this line's type is larger than body text — a heading candidate. */
  isLarge: boolean;
};

export type FontInfo = {
  family: string;
  bold: boolean;
  italic: boolean;
  serif: boolean;
};

export type StyleProfile = {
  pageWidth: number;
  pageHeight: number;
  margins: { top: number; right: number; bottom: number; left: number };
  columnCount: number;
  /** Horizontal extent of each column, in points. */
  columnBands: { start: number; end: number }[];
  fontSizes: { name: number; heading: number; body: number; small: number };
  bodyLineHeight: number;
  bulletGlyph: string;
  accentColor: string | null;
  serif: boolean;
  /**
   * Geometry is always recoverable. Font names and colours come from the
   * operator list, which some documents do not yield; when that fails the
   * profile still renders, just with defaults.
   */
  confidence: { geometry: true; fonts: boolean; colour: boolean };
};

export type LayoutDocument = {
  /** Reading-order text: column by column, never across the gutter. */
  text: string;
  lines: Line[];
  style: StyleProfile;
  pageCount: number;
};

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const BULLET_GLYPHS = ["•", "●", "▪", "◦", "‣", "⁃", "–", "‐", "-", "*"];

/** A gutter narrower than this is word spacing, not a column break. */
const MIN_GUTTER_PT = 18;
/** Each side of a real gutter has to carry a meaningful share of the text. */
const MIN_COLUMN_SHARE = 0.12;
/**
 * Below this there is not enough text for the histogram to mean anything — a
 * title page or a mostly-blank sheet would read as two columns off a single
 * wide gap. The share and gutter-width tests do the real work; this only keeps
 * the very sparse case from reaching them.
 */
const MIN_SPANS_FOR_COLUMNS = 12;

function fontSizeOf(transform: number[]): number {
  const scaled = Math.hypot(transform[0], transform[1]);
  return scaled > 0.01 ? scaled : Math.abs(transform[3]) || 10;
}

/**
 * Finds vertical bands of the page that no text crosses. A resume sidebar
 * leaves one; justified body text does not.
 */
function detectColumns(spans: Span[], pageWidth: number): { start: number; end: number }[] {
  const single = [{ start: 0, end: pageWidth }];
  if (spans.length < MIN_SPANS_FOR_COLUMNS) return single;

  // 1pt occupancy buckets across the page.
  const occupancy = new Array(Math.ceil(pageWidth)).fill(0);
  for (const s of spans) {
    const from = Math.max(0, Math.floor(s.x));
    const to = Math.min(occupancy.length - 1, Math.ceil(s.x + s.width));
    for (let i = from; i <= to; i++) occupancy[i]++;
  }

  const contentStart = occupancy.findIndex((v) => v > 0);
  let contentEnd = occupancy.length - 1;
  while (contentEnd > 0 && occupancy[contentEnd] === 0) contentEnd--;
  if (contentStart < 0 || contentEnd <= contentStart) return single;

  // Interior runs of zero occupancy are candidate gutters.
  const gutters: { start: number; end: number }[] = [];
  let runStart = -1;
  for (let i = contentStart; i <= contentEnd; i++) {
    if (occupancy[i] === 0) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      if (i - runStart >= MIN_GUTTER_PT) gutters.push({ start: runStart, end: i });
      runStart = -1;
    }
  }

  if (gutters.length === 0) return single;

  // Keep the widest gutter that genuinely splits the text. More than two
  // columns on a resume is rare enough that chasing it adds risk, not value.
  const widest = gutters.sort((a, b) => b.end - b.start - (a.end - a.start))[0];
  const mid = (widest.start + widest.end) / 2;
  const left = spans.filter((s) => s.x + s.width / 2 < mid).length;
  const right = spans.length - left;
  const share = Math.min(left, right) / spans.length;
  if (share < MIN_COLUMN_SHARE) return single;

  return [
    { start: contentStart, end: widest.start },
    { start: widest.end, end: contentEnd + 1 },
  ];
}

function columnOf(span: Span, bands: { start: number; end: number }[]): number {
  const centre = span.x + span.width / 2;
  for (let i = 0; i < bands.length; i++) {
    if (centre >= bands[i].start && centre < bands[i].end) return i;
  }
  return centre < bands[0].end ? 0 : bands.length - 1;
}

/** Groups spans sharing a baseline into one line, left to right. */
function groupIntoLines(spans: Span[], column: number, bodySize: number): Line[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => b.y - a.y || a.x - b.x);

  const lines: Line[] = [];
  let bucket: Span[] = [sorted[0]];

  const flush = () => {
    const ordered = [...bucket].sort((a, b) => a.x - b.x);
    // A wide horizontal jump is a right-aligned field (dates, location) sitting
    // on the same baseline. It belongs on this line — that is exactly how an
    // ATS reads it — but it needs a separator so the words do not fuse.
    let text = "";
    let prevEnd: number | null = null;
    for (const s of ordered) {
      if (prevEnd !== null) {
        const gap = s.x - prevEnd;
        if (gap > s.fontSize * 1.2) text += "  ";
        else if (gap > s.fontSize * 0.18 && !text.endsWith(" ")) text += " ";
      }
      text += s.text;
      prevEnd = s.x + s.width;
    }
    const size = Math.max(...ordered.map((s) => s.fontSize));
    lines.push({
      text: text.replace(/\s+/g, " ").trim(),
      x: ordered[0].x,
      y: ordered[0].y,
      page: ordered[0].page,
      column,
      fontSize: size,
      isLarge: size > bodySize + 0.6,
    });
    bucket = [];
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const sameLine = Math.abs(cur.y - prev.y) <= Math.max(1.5, prev.fontSize * 0.45);
    if (sameLine) bucket.push(cur);
    else {
      flush();
      bucket = [cur];
    }
  }
  flush();

  return lines.filter((l) => l.text.length > 0);
}

/** Most-used font size, weighted by how many characters are set in it. */
function sizeHistogram(spans: Span[]): Map<number, number> {
  const hist = new Map<number, number>();
  for (const s of spans) {
    const key = Math.round(s.fontSize * 2) / 2;
    hist.set(key, (hist.get(key) ?? 0) + s.text.trim().length);
  }
  return hist;
}

/* ------------------------------------------------------------------ */
/* Fonts and colour — best effort                                      */
/* ------------------------------------------------------------------ */

const SERIF_HINT = /(times|roman|georgia|garamond|minion|serif|lmroman|cmr|book|cambria|palatino|charter)/i;
const BOLD_HINT = /(bold|black|heavy|semibold|demibold|\bbd\b)/i;
const ITALIC_HINT = /(italic|oblique|\bit\b)/i;

function toHex(r: number, g: number, b: number) {
  const norm = (v: number) => {
    const n = v <= 1 ? Math.round(v * 255) : Math.round(v);
    return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  };
  return `#${norm(r)}${norm(g)}${norm(b)}`;
}

type PageLike = {
  getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[][] }>;
  commonObjs: { has: (k: string) => boolean; get: (k: string) => unknown };
};

/**
 * Walks the page's operator list for font selections and fill colours. This is
 * the part that can legitimately fail — encrypted documents, unusual producers,
 * pdf.js version drift — so every caller treats a null result as "use defaults"
 * rather than an error.
 */
async function readFontsAndColour(page: PageLike): Promise<{
  fonts: Map<string, FontInfo>;
  accent: string | null;
}> {
  const fonts = new Map<string, FontInfo>();
  let accent: string | null = null;

  let OPS: Record<string, number> | null = null;
  try {
    const mod = (await import("unpdf")) as unknown as {
      getResolvedPDFJS?: () => Promise<{ OPS: Record<string, number> }>;
    };
    if (mod.getResolvedPDFJS) OPS = (await mod.getResolvedPDFJS()).OPS;
  } catch {
    OPS = null;
  }
  if (!OPS) return { fonts, accent };

  const ops = await page.getOperatorList();
  const colourWeight = new Map<string, number>();

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];

    const firstArg = args?.[0];
    if (fn === OPS.setFont && typeof firstArg === "string") {
      const key = firstArg;
      if (!fonts.has(key)) {
        let family = key;
        try {
          if (page.commonObjs.has(key)) {
            const obj = page.commonObjs.get(key) as { name?: string } | null;
            if (obj?.name) family = obj.name;
          }
        } catch {
          /* font not resolvable; the key itself is the best label we have */
        }
        fonts.set(key, {
          family,
          bold: BOLD_HINT.test(family),
          italic: ITALIC_HINT.test(family),
          serif: SERIF_HINT.test(family),
        });
      }
    }

    if (fn === OPS.setFillRGBColor && Array.isArray(args) && args.length > 0) {
      // pdf.js has emitted this two ways: three channel numbers, and a single
      // pre-formatted hex string. Current builds use the string form.
      const hex =
        typeof args[0] === "string" && /^#[0-9a-f]{6}$/i.test(args[0])
          ? (args[0] as string).toLowerCase()
          : args.length >= 3
            ? toHex(args[0] as number, args[1] as number, args[2] as number)
            : null;

      if (hex) {
        // Black and near-black is body text, not an accent.
        const brightness =
          parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16);
        if (brightness > 90) colourWeight.set(hex, (colourWeight.get(hex) ?? 0) + 1);
      }
    }
  }

  const ranked = [...colourWeight.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length) accent = ranked[0][0];

  return { fonts, accent };
}

/**
 * Justified and LaTeX-set text breaks words across lines with a soft hyphen.
 * Left alone, "mod-\nules" never keyword-matches "modules".
 *
 * The catch is that a trailing hyphen is ambiguous: it is a soft hyphen in
 * "mod-ules" but a real one in "exponential-backoff", and only the second
 * should survive. Without a dictionary the honest discriminator is the second
 * fragment — technical compounds reuse a small, recognisable set of tails.
 */
const COMPOUND_TAILS = new Set([
  "backoff", "based", "driven", "side", "level", "time", "party", "scale",
  "tenant", "end", "first", "only", "aware", "specific", "facing", "safe",
  "free", "wide", "ready", "oriented", "friendly", "grained", "off", "in",
  "on", "up", "to", "the", "box", "premise", "prem", "core", "native",
]);

function dehyphenate(text: string): string {
  return text.replace(/([A-Za-z]{2,})-\n([a-z]{2,})/g, (_match, head: string, tail: string) => {
    const word = tail.match(/^[a-z]+/)?.[0] ?? tail;
    return COMPOUND_TAILS.has(word) ? `${head}-${tail}` : `${head}${tail}`;
  });
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export async function pdfToLayout(bytes: Buffer | Uint8Array): Promise<LayoutDocument> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const pageCount = pdf.numPages;

  const allSpans: Span[] = [];
  let pageWidth = 595.28;
  let pageHeight = 841.89;
  const fontsByKey = new Map<string, FontInfo>();
  let accentColor: string | null = null;
  let fontsResolved = false;
  let colourResolved = false;

  for (let p = 1; p <= pageCount; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    if (p === 1) {
      pageWidth = viewport.width;
      pageHeight = viewport.height;
    }

    const content = await page.getTextContent();
    for (const raw of content.items) {
      // pdf.js yields TextItem | TextMarkedContent; only the former has geometry.
      const item = raw as unknown as {
        str?: string;
        width?: number;
        transform?: number[];
        fontName?: string;
      };
      if (!item.str || !item.str.trim() || !item.transform) continue;
      allSpans.push({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width ?? 0,
        fontSize: fontSizeOf(item.transform),
        fontKey: item.fontName ?? "",
        page: p,
      });
    }

    try {
      const { fonts, accent } = await readFontsAndColour(page as unknown as PageLike);
      for (const [k, v] of fonts) if (!fontsByKey.has(k)) fontsByKey.set(k, v);
      if (fonts.size) fontsResolved = true;
      if (accent && !accentColor) {
        accentColor = accent;
        colourResolved = true;
      }
    } catch {
      /* geometry is enough to proceed; styling falls back to defaults */
    }
  }

  if (allSpans.length === 0) {
    throw new Error(
      "No text layer found in that PDF. If it is a scan or an image export, " +
        "save a text-based PDF or paste the resume as text instead.",
    );
  }

  /* --- size ladder --- */
  const hist = sizeHistogram(allSpans);
  const byUsage = [...hist.entries()].sort((a, b) => b[1] - a[1]);
  const bodySize = byUsage[0][0];
  const sizes = [...hist.keys()].sort((a, b) => a - b);
  const nameSize = sizes[sizes.length - 1];
  const smallSize = sizes.find((s) => s < bodySize) ?? bodySize;
  const headingCandidates = byUsage
    .filter(([size]) => size > bodySize && size < nameSize)
    .sort((a, b) => b[1] - a[1]);
  const headingSize = headingCandidates.length
    ? headingCandidates[0][0]
    : Math.round((bodySize + 2) * 2) / 2;

  /* --- columns and reading order --- */
  const columnBands = detectColumns(allSpans, pageWidth);
  const lines: Line[] = [];
  for (let p = 1; p <= pageCount; p++) {
    const pageSpans = allSpans.filter((s) => s.page === p);
    for (let c = 0; c < columnBands.length; c++) {
      const colSpans = pageSpans.filter((s) => columnOf(s, columnBands) === c);
      lines.push(...groupIntoLines(colSpans, c, bodySize));
    }
  }

  /* --- margins --- */
  const left = Math.min(...allSpans.map((s) => s.x));
  const right = pageWidth - Math.max(...allSpans.map((s) => s.x + s.width));
  const top = pageHeight - Math.max(...allSpans.map((s) => s.y));
  const bottom = Math.min(...allSpans.map((s) => s.y));

  /* --- body line height, from consecutive body-size lines --- */
  const bodyLines = lines.filter((l) => Math.abs(l.fontSize - bodySize) < 0.6);
  const deltas: number[] = [];
  for (let i = 1; i < bodyLines.length; i++) {
    const d = bodyLines[i - 1].y - bodyLines[i].y;
    if (d > 0 && d < bodySize * 3 && bodyLines[i].page === bodyLines[i - 1].page) deltas.push(d);
  }
  deltas.sort((a, b) => a - b);
  const medianDelta = deltas.length ? deltas[Math.floor(deltas.length / 2)] : bodySize * 1.35;

  /* --- bullet glyph --- */
  const glyphCount = new Map<string, number>();
  for (const l of lines) {
    const first = l.text.trimStart()[0];
    if (first && BULLET_GLYPHS.includes(first)) {
      glyphCount.set(first, (glyphCount.get(first) ?? 0) + 1);
    }
  }
  const bulletGlyph =
    [...glyphCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "•";

  /* --- serif, weighted by how much text each font sets --- */
  const serifChars = allSpans.reduce((acc, s) => {
    const f = fontsByKey.get(s.fontKey);
    return acc + (f?.serif ? s.text.trim().length : 0);
  }, 0);
  const totalChars = allSpans.reduce((acc, s) => acc + s.text.trim().length, 0);

  const style: StyleProfile = {
    pageWidth,
    pageHeight,
    margins: {
      top: Math.max(0, top),
      right: Math.max(0, right),
      bottom: Math.max(0, bottom),
      left: Math.max(0, left),
    },
    columnCount: columnBands.length,
    columnBands,
    fontSizes: { name: nameSize, heading: headingSize, body: bodySize, small: smallSize },
    bodyLineHeight: medianDelta / bodySize,
    bulletGlyph,
    accentColor,
    serif: totalChars > 0 && serifChars / totalChars > 0.5,
    confidence: { geometry: true, fonts: fontsResolved, colour: colourResolved },
  };

  const text = dehyphenate(lines.map((l) => l.text).join("\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text, lines, style, pageCount };
}
