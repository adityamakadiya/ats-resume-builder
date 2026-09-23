"""Fitting a resume onto one page without cutting anything out of it.

A two-page resume is not read twice as carefully; page two is usually not read
at all. So the target is one page, and the question is what to spend to get
there.

The cheap answer is a uniform shrink: scale the whole document to 90% and stop.
It is one calculation and it is what most editors do. It is also the worst
option per millimetre gained, because it spends the same proportion on the
things a reader never notices and on the one thing they do. Body type is the
last thing that should shrink and the first thing a uniform scale touches.

So the budget is spent in the order a typesetter would spend it:

    1. Page margins.        Generous margins are a convention, not a
                            requirement. 0.75in to 0.45in is invisible to a
                            reader and buys almost a full inch of column.
    2. Space between        The gaps between roles and between section
       blocks.              headings carry structure. They can tighten a long
                            way before the structure stops reading.
    3. Line spacing.        Noticeable, but only against a comparison.
    4. Body type size.      Spent last, and never below FLOOR_PT.

Below 9pt a resume starts to fail the people reading it on a phone and the
recruiters printing it, so the ladder stops there rather than continuing down
to something that technically occupies one page. When the content still does
not fit at the bottom rung, that is a content problem and it is reported as
one: nothing is silently deleted to make the page count look right.

The ladder is not tuned by eye. ``scripts/calibrate_density.py`` renders a
fixed sample at every rung and records how much text height each one holds;
CAPACITY below is that measurement, and re-running the script after a rendercv
upgrade regenerates it.
"""

from __future__ import annotations

from dataclasses import dataclass

FLOOR_PT = 9.0
"""Body type below this is not worth the page it saves."""


@dataclass(frozen=True)
class Rung:
    """One step on the density ladder.

    ``capacity`` is how many times more text this rung holds than rung 0,
    measured rather than estimated. It is what lets a single measured render
    pick the right rung instead of bisecting towards it.
    """

    margin_in: float
    body_pt: float
    line_spacing_em: float
    space_above_title_cm: float
    space_below_title_cm: float
    space_between_entries_cm: float
    space_between_text_entries_cm: float
    space_below_name_cm: float
    space_below_headline_cm: float
    space_below_connections_cm: float
    capacity: float = 1.0

    def design(self, theme: str) -> dict:
        """The rendercv ``design`` block for this rung.

        Only spacing and size are set. Font family, colours, rules and section
        title style are left to the theme, because those are what makes one
        template different from another and the point of the ladder is to fit
        the page, not to homogenise the templates into one look.
        """
        return {
            "theme": theme,
            "page": {
                # A page number and a "last updated" line are furniture, and
                # both land in the bottom margin where they are indistinguishable
                # from content to anything measuring text extent. Off for the
                # measurement to be meaningful, and off because a resume does not
                # want them.
                "show_footer": False,
                "show_top_note": False,
                "top_margin": f"{self.margin_in}in",
                "bottom_margin": f"{self.margin_in}in",
                "left_margin": f"{self.margin_in}in",
                "right_margin": f"{self.margin_in}in",
            },
            "typography": {
                "line_spacing": f"{self.line_spacing_em}em",
                "font_size": {"body": f"{self.body_pt}pt"},
            },
            "header": {
                "space_below_name": f"{self.space_below_name_cm}cm",
                "space_below_headline": f"{self.space_below_headline_cm}cm",
                "space_below_connections": f"{self.space_below_connections_cm}cm",
            },
            "section_titles": {
                "space_above": f"{self.space_above_title_cm}cm",
                "space_below": f"{self.space_below_title_cm}cm",
            },
            "sections": {
                "space_between_regular_entries": f"{self.space_between_entries_cm}cm",
                "space_between_text_based_entries": f"{self.space_between_text_entries_cm}cm",
            },
        }


# Rung 0 is what a resume gets when it already fits: roomier than rendercv's
# own defaults, because a short resume that fills two thirds of a page looks
# thin, and space is the only thing available to spend on it.
#
# The `capacity` figures are written by scripts/calibrate_density.py.
LADDER: tuple[Rung, ...] = (
    Rung(0.75, 10.5, 0.70, 0.50, 0.30, 0.42, 0.15, 0.70, 0.70, 0.70, 1.000),
    Rung(0.70, 10.0, 0.62, 0.44, 0.26, 0.36, 0.13, 0.55, 0.55, 0.55, 1.196),
    Rung(0.62, 10.0, 0.56, 0.38, 0.22, 0.30, 0.11, 0.45, 0.45, 0.45, 1.316),
    Rung(0.55, 9.5, 0.52, 0.34, 0.20, 0.26, 0.10, 0.38, 0.36, 0.36, 1.473),
    Rung(0.50, 9.5, 0.48, 0.30, 0.18, 0.22, 0.09, 0.32, 0.30, 0.30, 1.568),
    Rung(0.46, 9.0, 0.45, 0.27, 0.16, 0.19, 0.08, 0.28, 0.26, 0.26, 1.707),
    Rung(0.42, 9.0, 0.42, 0.24, 0.14, 0.17, 0.07, 0.24, 0.22, 0.22, 1.801),
)

TIGHTEST = len(LADDER) - 1


def rung_for(overflow_ratio: float) -> int:
    """The loosest rung whose measured capacity absorbs this much overflow.

    ``overflow_ratio`` is total content height over one page of usable height,
    both measured at rung 0. A resume that renders 1.3 pages needs a rung
    holding 1.3x, and picking it directly is why fitting usually costs one
    extra render rather than a search.

    A little headroom is added because the measurement is of text extent and
    the renderer also has to place whatever trailing space a theme puts after
    the last block.

    A ratio at or under 1 already fits, and asks for nothing.
    """
    if overflow_ratio <= 1:
        return 0

    needed = overflow_ratio * 1.02
    for index, rung in enumerate(LADDER):
        if rung.capacity >= needed:
            return index
    return TIGHTEST


def measure(pdf: bytes) -> tuple[int, float]:
    """Page count, and total text height as a multiple of one page's usable height.

    The ratio is taken from where the text actually starts and stops rather
    than from the page box, so it reflects the content and not the margins the
    content happens to be sitting in. On a one-page document it says how full
    that page is, which is what decides whether a short resume should be given
    more room rather than less.
    """
    import pymupdf

    with pymupdf.open(stream=pdf, filetype="pdf") as document:
        pages = document.page_count
        if pages == 0:
            return 0, 0.0

        first = document[0]
        top = min((b[1] for b in first.get_text("blocks")), default=0.0)
        last = document[pages - 1]
        bottom = max((b[3] for b in last.get_text("blocks")), default=0.0)

        # Usable height is measured from the first page's own text margins, so
        # it stays correct whatever margin the rung set.
        first_bottom = max((b[3] for b in first.get_text("blocks")), default=0.0)
        usable = (first_bottom - top) if pages > 1 else (first.rect.height - 2 * top)
        if usable <= 0:
            return pages, float(pages)

        used = (pages - 1) * usable + (bottom - top) if pages > 1 else (bottom - top)
        return pages, used / usable


def excess_lines(pdf: bytes, extent: float) -> int:
    """Roughly how many lines of text have to go for this to reach one page.

    "Cut a bullet" is useless advice for a resume that runs to three pages, and
    telling someone to cut sixty lines when eight would do is just as wrong. So
    the number comes from the document: total typeset lines, scaled by how far
    over one page the content actually runs.
    """
    if extent <= 1:
        return 0

    import pymupdf

    with pymupdf.open(stream=pdf, filetype="pdf") as document:
        total = sum(
            len(block.get("lines", ()))
            for page in document
            for block in page.get_text("dict")["blocks"]
            if block.get("type") == 0
        )
    return max(1, round(total * (extent - 1) / extent))
