"""The renderer that makes the preview and the download the same document.

The slow tests here drive a real Chromium, because the entire point of this
component is what a real browser does with real CSS. Mocking the browser would
test that we can call a function we wrote.
"""

from __future__ import annotations

import pytest

from atsresume.render.html_pdf import (
    HtmlRenderError,
    _safe_filename,
    count_pdf_pages,
    render_html_to_pdf,
)

PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page {{ size: A4; margin: 0 }}
  body {{ margin: 0; font-family: Helvetica, Arial, sans-serif; }}
  .page {{ padding: 0.6in; }}
  h1 {{ font-size: 20pt; margin: 0 0 4pt; }}
  .filler {{ height: {filler}px; }}
</style></head>
<body><div class="page">
  <h1>Priya Nair</h1>
  <p>Backend Engineer, Bengaluru</p>
  <ul><li>Built REST APIs in Node.js for merchant settlement</li></ul>
  <div class="filler"></div>
</div></body></html>"""


# --------------------------------------------------------------------------- #
# Pure helpers                                                                 #
# --------------------------------------------------------------------------- #


def test_empty_html_is_refused_before_a_browser_starts():
    """Launching Chromium to discover there is nothing to draw costs seconds."""
    with pytest.raises(HtmlRenderError):
        render_html_to_pdf("   ")


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("resume", "resume.pdf"),
        ("Priya Nair - Backend.pdf", "Priya Nair - Backend.pdf"),
        ("", "resume.pdf"),
        ("   ", "resume.pdf"),
        ("../../etc/passwd", "etcpasswd.pdf"),
        ("resume\r\nX-Injected: yes", "resumeX-Injected yes.pdf"),
        ("résumé", "rsum.pdf"),
        ("a" * 400, "a" * 120 + ".pdf"),
    ],
)
def test_filenames_are_safe_to_put_in_a_header(given, expected):
    """Content-Disposition is a header.

    A newline in this value is response splitting, and a slash is a path the
    caller did not intend. Both are dropped rather than escaped, because a
    resume filename has no legitimate need for either.
    """
    assert _safe_filename(given) == expected


def test_page_counting_never_returns_zero():
    assert count_pdf_pages(b"not a pdf at all") == 1


# --------------------------------------------------------------------------- #
# Real browser                                                                 #
# --------------------------------------------------------------------------- #


@pytest.mark.slow
def test_a_short_document_renders_to_one_page_with_real_text():
    """The text layer is the whole reason to prefer this to a screenshot.

    A PDF of pictures scores zero in every parser on earth, and that failure is
    invisible until an employer's ATS reads it.
    """
    result = render_html_to_pdf(PAGE.format(filler=0), filename="priya.pdf")

    assert result.pdf.startswith(b"%PDF")
    assert result.pages == 1
    assert result.fitted
    assert result.filename == "priya.pdf"
    assert result.warnings == []

    import pymupdf

    doc = pymupdf.open(stream=result.pdf, filetype="pdf")
    try:
        text = "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()

    assert "Priya Nair" in text
    assert "Node.js" in text
    # Reading order matters as much as presence: a parser that finds the name
    # after the bullets attributes the bullets to nobody.
    assert text.index("Priya Nair") < text.index("Node.js")


@pytest.mark.slow
def test_overflow_is_reported_rather_than_silently_cropped():
    """Two pages is a fact about the document, not an error.

    The density ladder above this decides what to do about it. What it must not
    do is find out by opening the file.
    """
    result = render_html_to_pdf(PAGE.format(filler=2400))

    assert result.pages >= 2
    assert not result.fitted
    assert any("pages" in w for w in result.warnings)


@pytest.mark.slow
def test_the_renderer_has_no_network():
    """Untrusted HTML must not be able to make this service fetch anything.

    This component will eventually take HTML over the network, at which point
    a template that loads a remote image is a template that can be aimed at a
    private address. The document renders; the subresource does not load.
    """
    html = """<!doctype html><html><body>
      <p>Priya Nair</p>
      <img src="http://169.254.169.254/latest/meta-data/" alt="blocked">
      <img src="https://example.com/tracker.png" alt="blocked too">
    </body></html>"""

    result = render_html_to_pdf(html)

    assert result.pdf.startswith(b"%PDF")

    # Both were refused, and the result says so rather than leaving it to be
    # discovered by looking at the page. Chromium still draws its broken-image
    # glyph, so the absence of an embedded image is not what proves this.
    assert len(result.blocked_requests) == 2
    assert any("169.254.169.254" in r for r in result.blocked_requests)
    assert any("example.com" in r for r in result.blocked_requests)
    assert any("no network" in w for w in result.warnings)

    import pymupdf

    doc = pymupdf.open(stream=result.pdf, filetype="pdf")
    try:
        assert "Priya Nair" in "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()


@pytest.mark.slow
def test_javascript_does_not_run():
    """Templates are pure functions of a document. A template that needs to
    execute is a template whose output depends on timing, and the printed page
    would stop matching the preview."""
    html = """<!doctype html><html><body>
      <p id="x">static</p>
      <script>document.getElementById('x').textContent = 'dynamic'</script>
    </body></html>"""

    result = render_html_to_pdf(html)

    import pymupdf

    doc = pymupdf.open(stream=result.pdf, filetype="pdf")
    try:
        text = "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()

    assert "static" in text
    assert "dynamic" not in text
