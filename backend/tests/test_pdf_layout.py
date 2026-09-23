"""Layout reading.

The two-column case is the one that matters. It fails silently — the extracted
text looks like prose, the model happily parses it, and every downstream fact is
wrong — so it needs a test that would catch its return.
"""

from __future__ import annotations

import os
from pathlib import Path

import pymupdf
import pytest

from atsresume.ingest.pdf_layout import PdfReadError, dehyphenate, read_pdf

REAL_RESUME = Path(
    os.environ.get("REAL_RESUME", "/Users/apple/career-ops/latex/Aditya-Makadiya-Resume.pdf")
)


def naive_text(data: bytes) -> str:
    doc = pymupdf.open(stream=data, filetype="pdf")
    text = "\n".join(page.get_text() for page in doc)
    doc.close()
    return " ".join(text.split())


def test_two_columns_are_detected(two_column_pdf):
    layout = read_pdf(two_column_pdf)
    assert layout.style.column_count == 2


def test_column_aware_read_keeps_the_sidebar_contiguous(two_column_pdf):
    layout = read_pdf(two_column_pdf)
    flat = " | ".join(layout.text.split("\n"))
    assert "SKILLS | JavaScript | TypeScript" in flat


def test_column_aware_read_keeps_experience_contiguous(two_column_pdf):
    layout = read_pdf(two_column_pdf)
    assert "Built REST APIs in Node.js for settlement" in layout.text


def test_naive_read_interleaves_which_is_the_bug_being_fixed(two_column_pdf):
    """Documents the failure mode. If this ever stops interleaving the fixture
    no longer reproduces the problem and the tests above prove less."""
    assert "SKILLS EXPERIENCE" in naive_text(two_column_pdf)


def test_single_column_is_not_split(single_column_pdf):
    assert read_pdf(single_column_pdf).style.column_count == 1


def test_right_aligned_dates_stay_on_their_line(single_column_pdf):
    """A date in a right-hand column on the same baseline is one line to an ATS."""
    layout = read_pdf(single_column_pdf)
    assert any("Acme Payments" in line and "Bengaluru" in line for line in layout.text.split("\n"))


def test_soft_hyphen_is_closed_up(hyphenated_pdf):
    assert "modules" in read_pdf(hyphenated_pdf).text


def test_real_compound_hyphen_survives(hyphenated_pdf):
    text = read_pdf(hyphenated_pdf).text
    assert "exponential-backoff" in text
    assert "exponentialbackoff" not in text


def test_dehyphenate_units():
    assert dehyphenate("mod-\nules") == "modules"
    assert dehyphenate("optimi-\nsation") == "optimisation"
    assert dehyphenate("exponential-\nbackoff") == "exponential-backoff"
    assert dehyphenate("event-\ndriven") == "event-driven"
    assert dehyphenate("multi-\ntenant") == "multi-tenant"
    # A hyphen not at a line break is untouched.
    assert dehyphenate("well-known") == "well-known"


def test_empty_pdf_raises_readable_error():
    doc = pymupdf.open()
    doc.new_page()
    data = doc.tobytes()
    doc.close()
    with pytest.raises(PdfReadError, match="No text layer"):
        read_pdf(data)


def test_garbage_bytes_raise_readable_error():
    with pytest.raises(PdfReadError, match="could not be opened"):
        read_pdf(b"this is not a pdf at all")


@pytest.mark.skipif(not REAL_RESUME.exists(), reason="no real resume on disk")
def test_style_profile_of_a_real_resume():
    layout = read_pdf(REAL_RESUME.read_bytes())
    style = layout.style

    assert style.column_count == 1
    assert style.font_sizes.name > style.font_sizes.heading >= style.font_sizes.body
    assert 10 < style.margins.left < 120
    # pymupdf reports fonts and colours directly; losing either means the
    # extraction path changed underneath us.
    assert style.fonts, "no font names recovered"
    assert style.accent_color.startswith("#"), f"no accent recovered: {style.accent_color!r}"
    assert "Bacancy" in layout.text


# --------------------------------------------------------------------------- #
# Hyperlinks                                                                   #
# --------------------------------------------------------------------------- #
#
# A resume's link targets are frequently better data than the glyphs printed
# over them. Measured on a real file: the page showed "097379 32872" and the
# annotation underneath said "tel:+91-97379-32872". Reading only the text
# loses the country code, and a recruiter in another country cannot dial what
# is left. Shortened profile URLs and a name linked to a portfolio are the
# same shape of loss.


def _pdf_with_links(pairs: list[tuple[str, str]]) -> bytes:
    """A page whose visible text differs from what it links to."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    y = 80.0
    for label, uri in pairs:
        point = pymupdf.Point(56.0, y)
        page.insert_text(point, label, fontsize=10, fontname="helv")
        page.insert_link(
            {
                "kind": pymupdf.LINK_URI,
                "from": pymupdf.Rect(56.0, y - 10, 300.0, y + 4),
                "uri": uri,
            }
        )
        y += 24.0
    data = doc.tobytes()
    doc.close()
    return data


def test_link_targets_are_read_not_just_the_text_over_them():
    data = _pdf_with_links(
        [
            ("097379 32872", "tel:+91-97379-32872"),
            ("my profile", "https://linkedin.com/in/adityamakadiya"),
        ]
    )

    layout = read_pdf(data)

    assert "tel:+91-97379-32872" in layout.links
    assert "https://linkedin.com/in/adityamakadiya" in layout.links
    # The printed form is still the printed form; the link is extra, not a
    # replacement. Deciding between them is the extractor's job.
    assert "097379 32872" in layout.text


def test_links_are_deduplicated_and_ordered():
    data = _pdf_with_links(
        [
            ("github", "https://github.com/x"),
            ("github again", "https://github.com/x"),
            ("site", "https://example.com"),
        ]
    )

    layout = read_pdf(data)

    assert layout.links == ["https://github.com/x", "https://example.com"]


def test_a_pdf_with_no_links_reports_none():
    """Most resumes have no annotations at all, and that is not an error."""
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text(
        pymupdf.Point(56.0, 80.0),
        "Backend Engineer at Acme Payments",
        fontsize=10,
        fontname="helv",
    )
    plain = doc.tobytes()
    doc.close()

    layout = read_pdf(plain)
    assert layout.links == []


def test_links_reach_raw_text_so_the_guard_can_see_them():
    """A URL that exists only as a link target is still something the
    candidate published. If it were kept out of the corpus, a rewrite that
    mentioned it would be rejected as an invention."""
    from atsresume.ingest.resume import ingest_resume

    data = _pdf_with_links([("my profile", "https://linkedin.com/in/adityamakadiya")])
    # Pad the page so the result clears the minimum-length check.
    doc = pymupdf.open(stream=data, filetype="pdf")
    page = doc[0]
    for i in range(14):
        page.insert_text(
            pymupdf.Point(56.0, 200.0 + i * 16),
            "Built REST APIs in Node.js and Express for merchant settlement.",
            fontsize=10,
            fontname="helv",
        )
    padded = doc.tobytes()
    doc.close()

    source = ingest_resume("resume.pdf", padded)

    assert "LINKS" in source.raw_text
    assert "https://linkedin.com/in/adityamakadiya" in source.raw_text
