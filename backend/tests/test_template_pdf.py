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
FIXTURES = ("rich", "sparse", "long", "twopage", "threepage")

# The two shapes that exist to print on more than one sheet, and how many
# sheets each is tuned to take in every template. Before they existed, the
# only multi-page evidence in this suite was "page two of `long` is not
# blank", which a resume with a section heading stranded at the foot of page
# two satisfies perfectly. See packages/templates/src/fixtures.ts.
MULTIPAGE = {"twopage": 2, "threepage": 3}

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


# --------------------------------------------------------------------------- #
# Computed style                                                               #
# --------------------------------------------------------------------------- #
#
# The tests above read the text layer. This one reads the cascade, because a
# rule can fail to match without changing a single character of output.
#
# It exists because of a specific bug. Every skills rule was written as
# `.rz-skills > dt`, and the markup wraps each pair in a div so the pair stays
# together across a page break. The child combinator therefore matched nothing.
# The wrapper is `display: contents`, so the two-column grid still laid out
# correctly and the only visible symptom was a category label rendering at the
# same weight as its values, which reads as a design choice rather than a fault.
# jsdom cannot see it, a text-layer test cannot see it, and a person reviewing
# the stylesheet reads the selector they meant to write.


@pytest.mark.slow
@pytest.mark.parametrize("template", TEMPLATES)
def test_a_skill_category_is_distinguishable_from_its_items(template):
    """The label must not render identically to the values beside it."""
    from playwright.sync_api import sync_playwright

    path = HTML_DIR / f"{template}--rich.html"
    if not path.exists():
        pytest.skip("rendered template HTML is missing")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()
            page.goto(path.absolute().as_uri(), wait_until="load")
            measured = page.evaluate(
                """() => {
                    const dl = document.querySelector('.rz-skills');
                    if (!dl) return null;
                    const dt = dl.querySelector('dt');
                    const dd = dl.querySelector('dd');
                    if (!dt || !dd) return null;
                    const read = (el) => {
                        const s = getComputedStyle(el);
                        return { weight: Number(s.fontWeight), size: s.fontSize, colour: s.color };
                    };
                    return { dt: read(dt), dd: read(dd) };
                }"""
            )
        finally:
            browser.close()

    assert measured is not None, f"{template} has no skills list to check"

    label, value = measured["dt"], measured["dd"]
    distinguishable = (
        label["weight"] > value["weight"]
        or label["size"] != value["size"]
        or label["colour"] != value["colour"]
    )
    assert distinguishable, (
        f"{template}: a skill category renders identically to its items "
        f"({label}). A selector is not matching."
    )


# --------------------------------------------------------------------------- #
# More than one sheet of paper                                                 #
# --------------------------------------------------------------------------- #
#
# Everything above this line is about a single page, or about page two merely
# existing. That was the whole of the repository's multi-page evidence, and it
# is not enough: Standard printed standard--long with SKILLS at the foot of
# page two, "Languages: Go, Rust, Python, TypeScript, SQL, Bash" underneath it
# and the other three groups overleaf, and every assertion in this file passed.
#
# The break geometry is asserted in e2e/tier3/rendered-html.spec.ts, which can
# measure where each element landed. What that suite cannot see is the text
# layer, which is the thing a parser reads and the thing a page break can
# scramble: text is emitted page by page, so a break puts a hard boundary in
# the middle of the stream, and a layout that reflows across it can deliver
# the second half of a career before the first.

#: The section headings as they reach the text layer. `text-transform:
#: uppercase` is applied by the renderer and is baked into the glyphs, so the
#: DOM says "Skills" and the PDF says "SKILLS".
SECTION_HEADINGS = (
    "SUMMARY",
    "EXPERIENCE",
    "SKILLS",
    "PROJECTS",
    "EDUCATION",
    "CERTIFICATIONS",
    "TALKS",
    "PUBLICATIONS",
    "OPEN SOURCE",
)

#: How many lines of its own section a heading has to bring onto its page.
#:
#: Three. "SKILLS" plus one group is one line, which is the defect; a heading
#: plus a role is a dozen, which is obviously fine. The same number is used by
#: the break-quality suite in e2e/tier3/rendered-html.spec.ts, and the two
#: should move together if either moves.
MIN_LINES_UNDER_A_HEADING = 3

#: Employers in the order the document lists them, per multi-page fixture.
#: An employer is a good probe because it is unique, it appears exactly once,
#: and its position is the one thing a reader uses to date a career.
EMPLOYERS = {
    "twopage": (
        "Pallavi Retail Group",
        "Trailhead Mobility",
        "Sarovar Analytics",
        "Kalpataru Web Services",
    ),
    "threepage": (
        "Kaveri Financial",
        "Ellora Health Systems",
        "Meghdoot Commerce",
        "Chandan Media Networks",
        "Dhruva Interactive Labs",
        "Sahyadri Software Services",
    ),
}

#: The main column's own running order in Modern.
#:
#: Modern is two columns, and the text layer proves what the registry warns
#: about: the sidebar is emitted first, so SKILLS, EDUCATION and
#: CERTIFICATIONS all arrive before SUMMARY. That is a property of the layout
#: rather than of the page breaks, it is disclosed to the candidate at the
#: point they choose the template, and asserting it away here would mean
#: either failing forever or pretending the warning is unnecessary. What must
#: still hold, and what these tests check, is that each column is internally
#: in order and stays that way across every page turn.
MODERN_MAIN_COLUMN = ("SUMMARY", "EXPERIENCE", "PROJECTS", "TALKS")
MODERN_SIDEBAR = ("SKILLS", "EDUCATION", "CERTIFICATIONS")


def _pages_of(pdf: bytes) -> list[str]:
    doc = pymupdf.open(stream=pdf, filetype="pdf")
    try:
        return [page.get_text() for page in doc]
    finally:
        doc.close()


def _positions(text: str, markers) -> list[tuple[int, str]]:
    return [(text.find(m), m) for m in markers if text.find(m) != -1]


@pytest.mark.slow
@pytest.mark.parametrize(
    ("template", "fixture"), [(t, f) for t in TEMPLATES for f in MULTIPAGE]
)
def test_a_multi_page_fixture_prints_the_pages_it_is_named_for(rendered, template, fixture):
    """The fixtures are tuned, not guessed, and the tuning has to stay true.

    `twopage` and `threepage` were sized so that all three templates print the
    same number of sheets and fill the last one. If a metric shifts and the
    count moves, the e2e break-quality assertions start measuring a document
    of a different shape than the one they were written for, and they go quiet
    rather than red. Retune the fixture in packages/templates/src/fixtures.ts;
    do not edit this number.
    """
    pdf, _ = rendered[(template, fixture)]
    pages = _pages_of(pdf)

    assert len(pages) == MULTIPAGE[fixture], (
        f"{template}/{fixture} printed {len(pages)} pages, not {MULTIPAGE[fixture]}"
    )
    for index, page in enumerate(pages, start=1):
        assert page.strip(), f"{template}/{fixture} page {index} carries no text at all"


@pytest.mark.slow
@pytest.mark.parametrize(
    ("template", "fixture"), [(t, f) for t in TEMPLATES for f in MULTIPAGE]
)
def test_a_career_reads_in_order_across_the_page_turn(rendered, template, fixture):
    """Every employer once, in the order the document lists them.

    The failure this names is specific. A page break splits the text stream,
    and anything that reflows around it, a floated block, a grid row that
    moves, a column that fills in a different order on the second sheet, can
    deliver 2014 before 2022 or emit an employer on both sides of the break.
    A recruiter would notice; a parser would not, and would build a career
    history out of whatever order it got.
    """
    _, text = rendered[(template, fixture)]
    employers = EMPLOYERS[fixture]

    for employer in employers:
        assert text.count(employer) == 1, (
            f"{template}/{fixture} prints {employer!r} {text.count(employer)} times; "
            "a page boundary has either duplicated it or lost it"
        )

    found = _positions(text, employers)
    assert [name for _, name in found] == list(employers), (
        f"{template}/{fixture} reads the career out of order: "
        f"{[name for _, name in found]}"
    )


@pytest.mark.slow
@pytest.mark.parametrize(
    ("template", "fixture"), [(t, f) for t in TEMPLATES for f in MULTIPAGE]
)
def test_the_sections_read_in_order_across_the_page_turn(rendered, template, fixture):
    """The same question for the section headings, one column at a time."""
    _, text = rendered[(template, fixture)]

    expected = [MODERN_MAIN_COLUMN, MODERN_SIDEBAR] if template == "modern" else [SECTION_HEADINGS]

    for run in expected:
        found = _positions(text, run)
        assert len(found) >= 2, f"{template}/{fixture} has almost no headings to order"
        assert [name for _, name in found] == [name for name in run if name in text], (
            f"{template}/{fixture} reads its sections out of order: "
            f"{[name for _, name in found]}"
        )


@pytest.mark.slow
@pytest.mark.parametrize(("template", "fixture"), [(t, f) for t in TEMPLATES for f in FIXTURES])
def test_no_heading_is_stranded_at_the_foot_of_a_page(rendered, template, fixture):
    """The defect, read straight out of the printed file.

    Standard printed standard--long with SKILLS third from the bottom of page
    two: the heading, then "Languages", then "Go, Rust, Python, TypeScript,
    SQL, Bash", and the remaining three groups overleaf. Asserting only that
    the heading is not the very last line misses it, which is worth saying
    out loud because that is the test this one replaced and it passed against
    the broken stylesheet.

    So: a heading that does not finish its section on its own page has to
    carry at least three lines of it there. A section that finishes on the
    page is left alone however short it is, because a complete two-line
    section at the foot of a page is not stranded, it is just short.

    e2e/tier3 asserts the same thing against a model of Chromium's
    pagination, which is faster and can point at the offending element. This
    asserts it against the bytes a candidate downloads, which is slower and
    blunter and cannot be argued with. If the two ever disagree, this one is
    right.

    Run over every fixture rather than only the multi-page pair, because the
    original sighting was on `long`, which is not in that pair. A one-page
    fixture passes trivially and costs nothing, since Chromium has already
    printed it for the tests above.
    """
    pdf, _ = rendered[(template, fixture)]
    pages = _pages_of(pdf)

    # One flat stream of non-empty lines, each tagged with the sheet it was
    # printed on. The page tag is the only thing the text layer knows about
    # pagination, and it is all this needs.
    stream: list[tuple[int, str]] = []
    for number, page in enumerate(pages, start=1):
        for line in page.splitlines():
            if line.strip():
                stream.append((number, line.strip()))

    heads = [i for i, (_, line) in enumerate(stream) if line in SECTION_HEADINGS]

    stranded = []
    for position, index in enumerate(heads):
        page, heading = stream[index]
        end = heads[position + 1] if position + 1 < len(heads) else len(stream)
        body = stream[index + 1 : end]
        on_this_page = [line for number, line in body if number == page]

        if len(on_this_page) == len(body):
            continue  # the section finished where it started
        if len(on_this_page) < MIN_LINES_UNDER_A_HEADING:
            stranded.append(
                f"{heading!r} on page {page} keeps only {len(on_this_page)} of its "
                f"{len(body)} lines: {on_this_page}"
            )

    assert not stranded, (
        f"{template}/{fixture} strands a heading at the foot of a page, which makes the "
        f"reader turn over to find out what it was for: {stranded}"
    )
