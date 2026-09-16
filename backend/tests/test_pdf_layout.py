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
