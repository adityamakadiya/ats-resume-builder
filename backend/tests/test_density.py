"""Fitting to one page.

These tests render real PDFs, which is slow, so the expensive ones are marked
and the cheap arithmetic is tested separately. The expensive ones still earn
their place: the whole feature is a claim about what comes out of the renderer,
and a mock of the renderer cannot check that claim.
"""

from __future__ import annotations

import copy

import pytest

from atsresume.render.density import (
    FLOOR_PT,
    LADDER,
    TIGHTEST,
    excess_lines,
    measure,
    rung_for,
)
from atsresume.render.rendercv_adapter import render_pdf


def test_the_ladder_only_ever_gets_tighter():
    """A rung that is roomier than the one above it would make the ladder
    non-monotonic, and rung_for would then pick a rung that does not fit."""
    for tighter, looser in zip(LADDER[1:], LADDER[:-1], strict=True):
        assert tighter.margin_in <= looser.margin_in
        assert tighter.body_pt <= looser.body_pt
        assert tighter.line_spacing_em <= looser.line_spacing_em
        assert tighter.space_between_entries_cm <= looser.space_between_entries_cm
        assert tighter.capacity > looser.capacity


def test_type_never_goes_below_the_legibility_floor():
    """The point of the floor is that it is not negotiable. A resume set in
    7pt occupies one page and fails the person reading it."""
    assert all(rung.body_pt >= FLOOR_PT for rung in LADDER)


def test_margins_are_spent_before_type():
    """The first rungs should be buying space from the margins, not the words.

    This is the design decision the whole module exists to make, so it is
    asserted rather than left to a comment.
    """
    assert LADDER[1].margin_in < LADDER[0].margin_in
    assert LADDER[1].body_pt >= LADDER[0].body_pt - 0.5
    # Halfway down the ladder the margin has given up more, proportionally,
    # than the type has.
    mid = LADDER[len(LADDER) // 2]
    margin_lost = 1 - mid.margin_in / LADDER[0].margin_in
    type_lost = 1 - mid.body_pt / LADDER[0].body_pt
    assert margin_lost > type_lost


def test_a_document_that_fits_asks_for_no_compression():
    assert rung_for(0.5) == 0
    assert rung_for(1.0) == 0


def test_overflow_picks_a_rung_that_holds_it():
    for overflow in (1.1, 1.25, 1.4, 1.55, 1.7):
        rung = rung_for(overflow)
        assert LADDER[rung].capacity >= overflow
        # And not more than it needs: the rung above must be too small.
        if rung > 0:
            assert LADDER[rung - 1].capacity < overflow * 1.02


def test_impossible_overflow_stops_at_the_tightest_rung():
    assert rung_for(9.0) == TIGHTEST


def test_footers_are_off():
    """A page number in the bottom margin is indistinguishable from content to
    anything measuring text extent, and it broke calibration when it was on."""
    page = LADDER[0].design("classic")["page"]
    assert page["show_footer"] is False
    assert page["show_top_note"] is False


def test_the_theme_keeps_its_own_identity():
    """The ladder sets spacing and size. If it set fonts or colours too, every
    template would converge on the same look and the picker would be pointless."""
    design = LADDER[3].design("moderncv")
    assert design["theme"] == "moderncv"
    assert "font_family" not in design["typography"]
    assert "colors" not in design


# --------------------------------------------------------------------------- #
# Against the real renderer                                                    #
# --------------------------------------------------------------------------- #


@pytest.mark.slow
def test_a_normal_resume_stays_roomy(sample_facts, sample_tailored):
    """A resume that already fits must not be compressed for no reason."""
    result = render_pdf(sample_tailored, sample_facts, theme="engineeringresumes")
    assert result.pages == 1
    assert result.fitted
    assert result.density == 0


@pytest.mark.slow
def test_an_overflowing_resume_is_brought_onto_one_page(sample_facts, sample_tailored):
    big = copy.deepcopy(sample_tailored)
    for exp in big.experience:
        exp.bullets = exp.bullets * 3

    result = render_pdf(big, sample_facts, theme="engineeringresumes")
    assert result.pages == 1, "three times the bullets should still fit on one page"
    assert result.fitted
    assert result.density > 0, "and it should have had to tighten to get there"


@pytest.mark.slow
def test_content_is_never_deleted_to_make_it_fit(sample_facts, sample_tailored):
    """The feature is typographic. If it ever starts dropping bullets to hit a
    page count it has become the thing this product exists to prevent."""
    import pymupdf

    big = copy.deepcopy(sample_tailored)
    for exp in big.experience:
        exp.bullets = exp.bullets * 3

    result = render_pdf(big, sample_facts, theme="engineeringresumes")
    with pymupdf.open(stream=result.pdf, filetype="pdf") as document:
        text = " ".join(page.get_text() for page in document)
    text = " ".join(text.split())

    for exp in big.experience:
        for bullet in exp.bullets:
            opening = " ".join(bullet.text.split()[:5])
            assert opening in text, f"dropped: {opening}"


@pytest.mark.slow
def test_a_resume_that_cannot_fit_says_so_and_says_how_much(sample_facts, sample_tailored):
    huge = copy.deepcopy(sample_tailored)
    for exp in huge.experience:
        exp.bullets = exp.bullets * 12

    result = render_pdf(huge, sample_facts, theme="engineeringresumes")
    assert result.pages > 1
    assert not result.fitted
    assert result.density == TIGHTEST, "it should have tried everything first"
    assert result.warnings, "and it must not fail silently"
    assert "Nothing was deleted" in result.warnings[0]
    # The advice has to be proportionate. "Cut a bullet" is useless here.
    assert "lines" in result.warnings[0]


@pytest.mark.slow
def test_fitting_can_be_turned_off(sample_facts, sample_tailored):
    big = copy.deepcopy(sample_tailored)
    for exp in big.experience:
        exp.bullets = exp.bullets * 3

    result = render_pdf(big, sample_facts, theme="engineeringresumes", fit_one_page=False)
    assert result.pages > 1
    assert result.density == 0


@pytest.mark.slow
def test_every_offered_theme_can_fit_the_sample(sample_facts, sample_tailored):
    """A template that cannot produce one page from an ordinary resume should
    not be on the menu."""
    from atsresume.render.rendercv_adapter import THEMES

    for theme in THEMES:
        result = render_pdf(sample_tailored, sample_facts, theme=theme)
        assert result.pages == 1, f"{theme} could not fit the sample"


def test_excess_lines_is_zero_when_it_already_fits():
    assert excess_lines(b"", 1.0) == 0
    assert excess_lines(b"", 0.4) == 0


@pytest.mark.slow
def test_measure_reads_a_real_render(sample_facts, sample_tailored):
    result = render_pdf(sample_tailored, sample_facts, theme="engineeringresumes")
    pages, extent = measure(result.pdf)
    assert pages == 1
    assert 0 < extent <= 1.02
