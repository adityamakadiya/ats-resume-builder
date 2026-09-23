"""Do the templates a candidate picks actually survive being printed?

This is the only test in the repo that crosses the language boundary, and it
exists because neither side can answer the question alone. The Vitest suite in
packages/templates proves the React tree is well formed in jsdom, which has no
layout and no printer. The Python suite proves Chromium turns HTML into a PDF.
Neither proves that the thing a candidate downloads carries their name, in the
right order, in text a parser can read.

That question is the product. A resume that renders beautifully and extracts as
an image scores zero in every ATS on earth, and nothing about the file looks
wrong when you open it.

The HTML is committed rather than generated here, so this suite stays offline
and needs no Node. ``node scripts/emit-html.mjs --check`` in packages/templates
is what stops that convenience turning into a test of last month's templates.
"""

from __future__ import annotations

import re
from pathlib import Path

import pymupdf
import pytest

from atsresume.render.html_pdf import render_html_to_pdf

HTML_DIR = (
    Path(__file__).resolve().parents[2] / "packages" / "templates" / "test" / "fixtures" / "html"
)

TEMPLATES = ("standard", "compact", "modern")
FIXTURES = ("rich", "sparse", "long")

# Non-ASCII in extracted text means a curly quote, an em dash or a bullet glyph
# reached the text layer. Each of those is a literal keyword-match failure in a
# parser that searches for the straight-quoted form, and the em dash is the
# clearest tell that a document was machine drafted.
NON_ASCII = re.compile(r"[^\x20-\x7E\n\t]")


def _cases() -> list[tuple[str, str, Path]]:
    found = []
    for template in TEMPLATES:
        for fixture in FIXTURES:
            path = HTML_DIR / f"{template}--{fixture}.html"
            found.append((template, fixture, path))
    return found


def _text_of(pdf: bytes) -> str:
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    try:
        return "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()


@pytest.fixture(scope="module")
def rendered() -> dict[tuple[str, str], tuple[bytes, str]]:
    """Print every template once. Chromium is the expensive part, not the checks."""
    if not HTML_DIR.exists():
        pytest.skip(
            "Rendered template HTML is missing. Run: "
            "cd packages/templates && npx tsx scripts/emit-html.mjs"
        )

    out: dict[tuple[str, str], tuple[bytes, str]] = {}
    for template, fixture, path in _cases():
        if not path.exists():
            continue
        result = render_html_to_pdf(path.read_text(), filename=f"{template}-{fixture}.pdf")
        out[(template, fixture)] = (result.pdf, _text_of(result.pdf))
    return out


@pytest.mark.slow
@pytest.mark.parametrize(("template", "fixture"), [(t, f) for t in TEMPLATES for f in FIXTURES])
def test_every_template_prints_a_readable_text_layer(rendered, template, fixture):
    pdf, text = rendered[(template, fixture)]

    assert pdf.startswith(b"%PDF")
    # A page of glyphs with no text layer extracts to almost nothing. The
    # threshold is deliberately low: this is catching a categorical failure,
    # not measuring density.
    assert len(text.strip()) > 400, f"{template}/{fixture} extracted almost no text"


@pytest.mark.slow
@pytest.mark.parametrize(("template", "fixture"), [(t, f) for t in TEMPLATES for f in FIXTURES])
def test_no_non_ascii_reaches_the_text_layer(rendered, template, fixture):
    _, text = rendered[(template, fixture)]

    offenders = sorted(set(NON_ASCII.findall(text)))
    assert not offenders, (
        f"{template}/{fixture} put {offenders!r} in the text layer. Bullet markers "
        "and separators belong in CSS, and a curly quote breaks a literal match."
    )


@pytest.mark.slow
@pytest.mark.parametrize("template", TEMPLATES)
def test_the_name_is_read_before_the_work(rendered, template):
    """Reading order, not merely presence.

    A parser that finds the candidate's name after the bullets attributes the
    bullets to nobody. This is exactly the failure two-column layouts cause,
    and it is why the registry flags Modern rather than shipping it quietly.
    """
    _, text = rendered[(template, "rich")]

    name = text.find("Rohan")
    assert name != -1, f"{template} lost the candidate's name entirely"

    for marker in ("EXPERIENCE", "Experience"):
        where = text.find(marker)
        if where != -1:
            assert name < where, f"{template} prints the name after the experience heading"
            break
    else:
        pytest.fail(f"{template} has no experience heading in its text layer")


@pytest.mark.slow
@pytest.mark.parametrize("template", TEMPLATES)
def test_contact_details_survive_the_print(rendered, template):
    """An unreachable candidate is the one parse failure that costs the job."""
    _, text = rendered[(template, "rich")]
    flat = text.replace("\n", " ")

    assert "@" in flat, f"{template} lost the email address"
    assert re.search(r"\d{3}", flat), f"{template} lost the phone number"


@pytest.mark.slow
def test_a_sparse_resume_fits_one_page(rendered):
    """A fresher with one internship must not print two pages of whitespace."""
    for template in TEMPLATES:
        pdf, _ = rendered[(template, "sparse")]
        doc = pymupdf.open(stream=pdf, filetype="pdf")
        try:
            assert doc.page_count == 1, f"{template} spread a sparse resume over {doc.page_count}"
        finally:
            doc.close()


@pytest.mark.slow
def test_overflow_is_visible_rather_than_cropped(rendered):
    """The long fixture cannot fit, by construction.

    What matters is that the content is still there on page two. Silently
    cropping to make the page count look right is the one thing the renderer
    must never do.
    """
    pdf, text = rendered[("standard", "long")]

    doc = pymupdf.open(stream=pdf, filetype="pdf")
    try:
        assert doc.page_count >= 2
        last_page_text = doc[doc.page_count - 1].get_text().strip()
    finally:
        doc.close()

    assert last_page_text, "the final page is blank, so content was dropped rather than flowed"
    assert len(text) > 2000


@pytest.mark.slow
def test_links_are_clickable_not_merely_blue(rendered):
    """A PDF that prints a URL as text makes a recruiter type it. Most will not."""
    pdf, _ = rendered[("standard", "rich")]

    doc = pymupdf.open(stream=pdf, filetype="pdf")
    try:
        links = [link for page in doc for link in page.get_links()]
    finally:
        doc.close()

    assert links, "no clickable links survived the print"
    assert any(link.get("uri", "").startswith("http") for link in links)
