"""Rendering.

Most of these guard the boundary with rendercv, which validates emails, phone
numbers and dates for real. A resume that trips one of those validators must
still produce a PDF: losing a phone number is recoverable, failing the request
is not.

The last test is the end-to-end proof — it renders and then reads the PDF back
through the project's own layout reader, so the output is checked with the same
tool that judges an uploaded resume.
"""

from __future__ import annotations

import copy

import pytest

from atsresume.ingest.pdf_layout import read_pdf
from atsresume.models import Link
from atsresume.render.rendercv_adapter import (
    THEMES,
    RenderError,
    _dates_block,
    _parse_date,
    _phone,
    _social_networks,
    build_cv_dict,
    render_pdf,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Jun 2023", "2023-06"),
        ("June 2023", "2023-06"),
        ("Sept 2018", "2018-09"),
        ("2023-06", "2023-06"),
        ("06/2023", "2023-06"),
        ("2023", "2023"),
        ("Present", None),
        ("", None),
        ("sometime last year", None),
        ("3023", None),
    ],
)
def test_date_parsing(raw, expected):
    assert _parse_date(raw) == expected


def test_present_becomes_an_open_range():
    assert _dates_block("Jun 2023", "Present") == {"start_date": "2023-06", "end_date": "present"}


def test_unparseable_dates_fall_back_to_free_text():
    """Emitting a half-parsed range would silently change the candidate's
    employment dates, which is the exact thing the truth guard exists to stop."""
    block = _dates_block("Summer 2021", "Winter 2022")
    assert "start_date" not in block
    assert block["date"] == "Summer 2021 - Winter 2022"


def test_partially_parseable_range_also_falls_back():
    block = _dates_block("Jun 2023", "whenever")
    assert block == {"date": "Jun 2023 - whenever"}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+91 97379 32872", "tel:+919737932872"),
        ("+1 (555) 123-4567", "tel:+15551234567"),
        ("9737932872", "tel:+919737932872"),
        ("97379", ""),
        ("", ""),
        ("call me", ""),
    ],
)
def test_phone_normalisation(raw, expected):
    assert _phone(raw) == expected


def test_social_links_are_split_by_what_rendercv_accepts(facts):
    facts.contact.links = [
        Link(label="LinkedIn", url="https://linkedin.com/in/priyanair"),
        Link(label="GitHub", url="https://github.com/priyanair"),
        Link(label="Blog", url="https://priya.dev"),
        Link(label="Other", url="https://some.other/thing"),
    ]
    networks, website, custom = _social_networks(facts)
    assert {"network": "LinkedIn", "username": "priyanair"} in networks
    assert {"network": "GitHub", "username": "priyanair"} in networks
    assert website == "https://priya.dev"
    assert custom and custom[0]["placeholder"] == "some.other/thing"


def test_invalid_contact_details_are_dropped_not_fatal(tailored, facts):
    facts.contact.email = "not-an-email"
    facts.contact.phone = "ring me"
    cv = build_cv_dict(tailored, facts)
    assert "email" not in cv
    assert "phone" not in cv
    assert cv["name"] == "Priya Nair"


def test_section_order_is_respected(tailored, facts):
    draft = copy.deepcopy(tailored)
    draft.section_order = ["experience", "summary", "skills", "education"]
    sections = list(build_cv_dict(draft, facts)["sections"])
    assert sections.index("Experience") < sections.index("Summary")


def test_other_sections_keep_their_heading(tailored, facts):
    from atsresume.models import TailoredBullet, TailoredOtherSection

    draft = copy.deepcopy(tailored)
    draft.other_sections = [
        TailoredOtherSection(
            source_id="O1",
            heading="Open Source",
            bullets=[TailoredBullet(text="Maintains a Redis client library", source_ids=["O1.B1"])],
        )
    ]
    sections = build_cv_dict(draft, facts)["sections"]
    assert "Open Source" in sections
    assert sections["Open Source"] == ["Maintains a Redis client library"]


def test_empty_sections_are_omitted(tailored, facts):
    draft = copy.deepcopy(tailored)
    draft.skills = []
    draft.education = []
    sections = build_cv_dict(draft, facts)["sections"]
    assert "Technical Skills" not in sections
    assert "Education" not in sections


@pytest.mark.slow
def test_render_produces_an_ats_clean_pdf(tailored, facts):
    """End to end, then verified with the project's own reader."""
    result = render_pdf(tailored, facts, company="Acme Payments")

    assert result.pdf[:5] == b"%PDF-"
    assert len(result.pdf) > 1000
    assert result.filename == "Priya-Nair-Resume-Acme-Payments.pdf"

    layout = read_pdf(result.pdf)
    assert layout.style.column_count == 1, "the output must not be two-column"
    assert layout.page_count <= 2
    assert "Priya Nair" in layout.text
    assert "Acme Payments" in layout.text
    # The rewritten bullet must survive as extractable text, unbroken.
    assert "Designed REST APIs on Node.js and Express" in layout.text
    assert not [w for w in layout.text.split("\n") if w.endswith("-")], "hyphen break in output"


@pytest.mark.slow
def test_placeholder_company_is_left_out_of_the_filename(tailored, facts):
    result = render_pdf(tailored, facts, company="Unspecified")
    assert result.filename == "Priya-Nair-Resume.pdf"


@pytest.mark.slow
def test_a_resume_with_no_dates_still_renders(tailored, facts):
    draft = copy.deepcopy(tailored)
    draft.experience[0].start_date = "a while back"
    draft.experience[0].end_date = "recently"
    result = render_pdf(draft, facts)
    assert result.pdf[:5] == b"%PDF-"


@pytest.mark.slow
@pytest.mark.parametrize("theme", sorted(THEMES))
def test_every_offered_theme_is_ats_clean(theme, tailored, facts):
    """A theme is only on the menu if it survives this.

    resumebench ships a two-column template flagged safe:false with the note
    "Some parsers read it out of order". That is the failure this project
    measured and built column detection to catch, so a theme that produces it
    must not be offered however good it looks. Each one is rendered and then
    read back through this project's own PDF reader.
    """
    result = render_pdf(tailored, facts, theme=theme)
    layout = read_pdf(result.pdf)

    assert layout.style.column_count == 1, f"{theme} renders in columns"
    assert layout.page_count <= 2, f"{theme} runs to {layout.page_count} pages"
    assert "Priya Nair" in layout.text, f"{theme} lost the candidate's name"
    assert "Designed REST APIs on Node.js and Express" in layout.text, f"{theme} lost a bullet"
    broken = [line for line in layout.text.split("\n") if line.endswith("-")]
    assert not broken, f"{theme} breaks a word across a line: {broken[:2]}"


def test_an_unknown_theme_is_refused_before_rendering(tailored, facts):
    """Better a clear message than rendercv's own validation error."""
    with pytest.raises(RenderError, match="not an available theme"):
        render_pdf(tailored, facts, theme="sidebar")
