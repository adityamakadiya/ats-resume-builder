"""Layout-aware PDF reading.

Reading a resume as one flat string is wrong in a way that is silent and total.
A two-column resume whose content stream is written row by row — what Word
tables and most HTML-to-PDF converters produce — interleaves under naive
extraction: the sidebar fuses with the body and you get "JavaScript Backend
Engineer at Acme TypeScript". Every fact extracted from that is nonsense, and no
downstream check can catch it, because the nonsense genuinely is in the text.

So this module reads geometry. It finds the gutter with an occupancy histogram,
reads each column top to bottom in isolation, and records the visual design.

Note on coordinates: PyMuPDF's origin is top-left and y increases *downward*,
the opposite of the PDF specification's own convention. Reading order is
therefore ascending y, not descending.
"""

from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

import pymupdf

from ..models import ColumnBand, FontSizes, Margins, StyleProfile

# A gutter narrower than this is word spacing, not a column break.
MIN_GUTTER_PT = 18.0
# Each side of a real gutter must carry a meaningful share of the text.
MIN_COLUMN_SHARE = 0.12
# Below this there is not enough text for the histogram to mean anything; a
# title page would otherwise read as two columns off one wide gap.
MIN_SPANS_FOR_COLUMNS = 12
# Resumes are short. A hundred-page PDF is a mistake or an attack.
MAX_PAGES = 30

BULLET_GLYPHS = "•●▪◦‣⁃·-*–"


class PdfReadError(RuntimeError):
    """The PDF cannot be read as text. The message is shown to the candidate."""


@dataclass
class Span:
    text: str
    x0: float
    y0: float
    x1: float
    y1: float
    size: float
    font: str
    bold: bool
    italic: bool
    serif: bool
    color: int
    page: int

    @property
    def width(self) -> float:
        return max(0.0, self.x1 - self.x0)

    @property
    def mid_x(self) -> float:
        return (self.x0 + self.x1) / 2


@dataclass
class Line:
    text: str
    x: float
    y: float
    page: int
    column: int
    size: float
    spans: list[Span] = field(default_factory=list)


@dataclass
class PdfLayout:
    text: str
    lines: list[Line]
    style: StyleProfile
    page_count: int
    #: Hyperlink targets embedded in the document, in page order.
    #:
    #: Worth reading because the target is often better than the text over
    #: it. A measured example: a resume printed '097379 32872' and carried
    #: 'tel:+91-97379-32872' underneath. Reading only the glyphs loses the
    #: country code, and a recruiter abroad cannot dial what is left. The
    #: same applies to a shortened profile URL, or to a name hyperlinked to
    #: a portfolio with no visible address at all.
    links: list[str] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Hyphenation                                                                  #
# --------------------------------------------------------------------------- #

# A trailing hyphen is ambiguous: soft in "mod-ules", real in
# "exponential-backoff". Without a dictionary the honest discriminator is the
# second fragment, because technical compounds reuse a small, recognisable set
# of tails.
COMPOUND_TAILS = {
    "backoff", "based", "driven", "side", "level", "time", "party", "scale",
    "tenant", "end", "first", "only", "aware", "specific", "facing", "safe",
    "free", "wide", "ready", "oriented", "friendly", "grained", "off", "in",
    "on", "up", "to", "the", "box", "premise", "prem", "core", "native",
    "critical", "heavy", "intensive", "agnostic", "bound",
}

_HYPHEN_BREAK = re.compile(r"([A-Za-z]{2,})-\n([a-z]{2,})")


def dehyphenate(text: str) -> str:
    def repair(match: re.Match[str]) -> str:
        head, tail = match.group(1), match.group(2)
        word = re.match(r"^[a-z]+", tail)
        key = word.group(0) if word else tail
        return f"{head}-{tail}" if key in COMPOUND_TAILS else f"{head}{tail}"

    return _HYPHEN_BREAK.sub(repair, text)


# --------------------------------------------------------------------------- #
# Reading                                                                      #
# --------------------------------------------------------------------------- #


def _read_spans(doc: pymupdf.Document) -> tuple[list[Span], float, float]:
    spans: list[Span] = []
    page_width = page_height = 0.0

    for page_index in range(min(doc.page_count, MAX_PAGES)):
        page = doc[page_index]
        if page_index == 0:
            page_width, page_height = page.rect.width, page.rect.height

        try:
            data = page.get_text("dict")
        except Exception as exc:  # malformed page; skip rather than fail the upload
            raise PdfReadError(f"Page {page_index + 1} could not be read: {exc}") from exc

        for block in data.get("blocks", []):
            # type 1 blocks are images; they carry no text layer.
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for raw in line.get("spans", []):
                    text = raw.get("text", "")
                    if not text.strip():
                        continue
                    x0, y0, x1, y1 = raw["bbox"]
                    flags = raw.get("flags", 0)
                    spans.append(
                        Span(
                            text=text,
                            x0=x0,
                            y0=y0,
                            x1=x1,
                            y1=y1,
                            size=raw.get("size", 10.0),
                            font=raw.get("font", ""),
                            italic=bool(flags & 2**1),
                            serif=bool(flags & 2**2),
                            bold=bool(flags & 2**4),
                            color=raw.get("color", 0),
                            page=page_index,
                        )
                    )

    return spans, page_width, page_height


def detect_columns(spans: list[Span], page_width: float) -> list[ColumnBand]:
    """Find vertical bands of the page that no text crosses."""
    single = [ColumnBand(start=0.0, end=page_width)]
    if len(spans) < MIN_SPANS_FOR_COLUMNS or page_width <= 0:
        return single

    occupancy = [0] * (int(page_width) + 1)
    for span in spans:
        lo = max(0, int(span.x0))
        hi = min(len(occupancy) - 1, int(span.x1) + 1)
        for i in range(lo, hi + 1):
            occupancy[i] += 1

    content = [i for i, v in enumerate(occupancy) if v > 0]
    if not content:
        return single
    start, end = content[0], content[-1]

    gutters: list[tuple[int, int]] = []
    run_start = -1
    for i in range(start, end + 1):
        if occupancy[i] == 0:
            if run_start < 0:
                run_start = i
        elif run_start >= 0:
            if i - run_start >= MIN_GUTTER_PT:
                gutters.append((run_start, i))
            run_start = -1

    if not gutters:
        return single

    # More than two columns on a resume is rare enough that chasing it adds
    # risk, not value. Take the widest gutter that genuinely splits the text.
    widest = max(gutters, key=lambda g: g[1] - g[0])
    mid = (widest[0] + widest[1]) / 2
    left = sum(1 for s in spans if s.mid_x < mid)
    right = len(spans) - left
    if min(left, right) / len(spans) < MIN_COLUMN_SHARE:
        return single

    return [
        ColumnBand(start=float(start), end=float(widest[0])),
        ColumnBand(start=float(widest[1]), end=float(end + 1)),
    ]


def _column_of(span: Span, bands: list[ColumnBand]) -> int:
    for i, band in enumerate(bands):
        if band.start <= span.mid_x < band.end:
            return i
    return 0 if span.mid_x < bands[0].end else len(bands) - 1


def _group_into_lines(spans: list[Span], column: int) -> list[Line]:
    """Spans sharing a baseline become one line, left to right."""
    if not spans:
        return []

    ordered = sorted(spans, key=lambda s: (round(s.y0, 1), s.x0))
    lines: list[Line] = []
    bucket: list[Span] = [ordered[0]]

    def flush(group: list[Span]) -> None:
        group = sorted(group, key=lambda s: s.x0)
        text = ""
        prev_end: float | None = None
        for s in group:
            if prev_end is not None:
                gap = s.x0 - prev_end
                # A wide horizontal jump is a right-aligned field (dates,
                # location) on the same baseline. It belongs on this line —
                # that is how an ATS reads it — but it needs a separator so the
                # words do not fuse.
                if gap > s.size * 1.2:
                    text += "  "
                elif gap > s.size * 0.18 and not text.endswith(" "):
                    text += " "
            text += s.text
            prev_end = s.x1
        cleaned = re.sub(r"\s+", " ", text).strip()
        if cleaned:
            lines.append(
                Line(
                    text=cleaned,
                    x=group[0].x0,
                    y=group[0].y0,
                    page=group[0].page,
                    column=column,
                    size=max(s.size for s in group),
                    spans=group,
                )
            )

    for prev, cur in zip(ordered, ordered[1:], strict=False):
        same_line = abs(cur.y0 - prev.y0) <= max(1.5, prev.size * 0.45)
        if same_line:
            bucket.append(cur)
        else:
            flush(bucket)
            bucket = [cur]
    flush(bucket)
    return lines


def _style_profile(
    spans: list[Span],
    lines: list[Line],
    bands: list[ColumnBand],
    page_width: float,
    page_height: float,
) -> StyleProfile:
    # Size ladder, weighted by how much text is set in each size.
    by_size: Counter[float] = Counter()
    for s in spans:
        by_size[round(s.size * 2) / 2] += len(s.text.strip())

    body = by_size.most_common(1)[0][0]
    sizes = sorted(by_size)
    name_size = sizes[-1]
    small = next((s for s in sizes if s < body), body)
    heading_candidates = [(sz, n) for sz, n in by_size.items() if body < sz < name_size]
    heading = max(heading_candidates, key=lambda p: p[1])[0] if heading_candidates else body + 2

    # Accent colour, weighted by characters rather than occurrences: a colour
    # used for one long paragraph matters more than one used for six glyphs.
    by_colour: Counter[int] = Counter()
    for s in spans:
        if s.color != 0:  # pure black is body text, not an accent
            by_colour[s.color] += len(s.text.strip())
    accent = ""
    if by_colour:
        top = by_colour.most_common(1)[0][0]
        # Skip near-blacks, which are body text set slightly off-black.
        if (top >> 16 & 255) + (top >> 8 & 255) + (top & 255) > 90:
            accent = f"#{top:06x}"

    serif_chars = sum(len(s.text.strip()) for s in spans if s.serif)
    total_chars = sum(len(s.text.strip()) for s in spans) or 1

    body_lines = [line for line in lines if abs(line.size - body) < 0.6]
    deltas = [
        b.y - a.y
        for a, b in zip(body_lines, body_lines[1:], strict=False)
        if a.page == b.page and 0 < b.y - a.y < body * 3
    ]
    deltas.sort()
    median_delta = deltas[len(deltas) // 2] if deltas else body * 1.35

    glyphs = Counter(
        line.text[0] for line in lines if line.text and line.text[0] in BULLET_GLYPHS
    )
    bullet = glyphs.most_common(1)[0][0] if glyphs else "•"

    return StyleProfile(
        page_width=page_width,
        page_height=page_height,
        margins=Margins(
            left=min(s.x0 for s in spans),
            right=max(0.0, page_width - max(s.x1 for s in spans)),
            top=min(s.y0 for s in spans),
            bottom=max(0.0, page_height - max(s.y1 for s in spans)),
        ),
        column_count=len(bands),
        column_bands=bands,
        font_sizes=FontSizes(name=name_size, heading=heading, body=body, small=small),
        body_line_height=median_delta / body if body else 1.35,
        bullet_glyph=bullet,
        accent_color=accent,
        serif=serif_chars / total_chars > 0.5,
        fonts=sorted({s.font for s in spans if s.font})[:12],
    )


def _read_links(doc: pymupdf.Document, page_count: int) -> list[str]:
    """Hyperlink targets, de-duplicated, in page order.

    Only external targets. An internal jump to another page of the same
    document says nothing about the candidate, and `None` uris appear for
    widget annotations that carry no destination at all.
    """
    seen: set[str] = set()
    out: list[str] = []
    for index in range(page_count):
        try:
            links = doc[index].get_links()
        except Exception:  # a malformed annotation must not fail the upload
            continue
        for link in links:
            uri = link.get("uri")
            if not isinstance(uri, str):
                continue
            uri = uri.strip()
            if not uri or uri in seen or len(uri) > 500:
                continue
            seen.add(uri)
            out.append(uri)
    return out


def read_pdf(data: bytes) -> PdfLayout:
    """Read a PDF into reading-order text plus the design it was set in."""
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise PdfReadError(f"That file could not be opened as a PDF: {exc}") from exc

    try:
        if doc.needs_pass:
            raise PdfReadError(
                "That PDF is password protected. Remove the password and upload it again."
            )
        if doc.page_count == 0:
            raise PdfReadError("That PDF has no pages.")

        spans, page_width, page_height = _read_spans(doc)
        page_count = min(doc.page_count, MAX_PAGES)
        links = _read_links(doc, page_count)
    finally:
        doc.close()

    if not spans:
        raise PdfReadError(
            "No text layer found in that PDF. If it is a scan or an image export, "
            "save a text-based PDF or paste the resume as text instead."
        )

    bands = detect_columns(spans, page_width)

    lines: list[Line] = []
    for page_index in range(page_count):
        page_spans = [s for s in spans if s.page == page_index]
        for column in range(len(bands)):
            column_spans = [s for s in page_spans if _column_of(s, bands) == column]
            lines.extend(_group_into_lines(column_spans, column))

    style = _style_profile(spans, lines, bands, page_width, page_height)
    text = dehyphenate("\n".join(line.text for line in lines))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()

    return PdfLayout(
        text=text, lines=lines, style=style, page_count=page_count, links=links
    )
