"""The scorers themselves.

An eval you cannot trust is worse than no eval, because it produces numbers
that feel like evidence. These fix the scorers against handmade pass and fail
cases so a green eval run means something.
"""

from __future__ import annotations

import copy

from atsresume.models import TailoredBullet
from evals.scorers import (
    ascii_only,
    bullets_were_rewritten,
    employers_unchanged,
    keyword_coverage,
    no_banned_openers,
    no_repeated_openers,
    score_all,
    sections_preserved,
    summary_present,
    surfaced_twice,
)


def test_a_good_rewrite_passes_everything(facts, tailored):
    findings = score_all(facts, tailored, ["Node.js", "PostgreSQL"])
    failed = [f.scorer for f in findings if not f.passed]
    assert not failed, failed


def test_a_dropped_section_is_caught(facts, tailored):
    draft = copy.deepcopy(tailored)
    draft.education = []
    assert not sections_preserved(facts, draft).passed


def test_an_invented_employer_is_caught(facts, tailored):
    draft = copy.deepcopy(tailored)
    draft.experience[0].company = "Stripe"
    finding = employers_unchanged(facts, draft)
    assert not finding.passed and "Stripe" in finding.detail


def test_a_verbatim_copy_is_caught(facts, tailored):
    """Without this a model scores well by changing nothing."""
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets[0].text = facts.experience[0].bullets[0].text
    finding = bullets_were_rewritten(facts, draft)
    assert not finding.passed
    assert "copied verbatim" in finding.detail


def test_repeated_opening_verbs_are_caught(tailored):
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets = [
        TailoredBullet(text="Designed the settlement API.", source_ids=["E1.B1"]),
        TailoredBullet(text="Designed the reconciliation job.", source_ids=["E1.B2"]),
    ]
    assert not no_repeated_openers(draft).passed


def test_banned_openers_are_caught(tailored):
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets[0].text = "Helped the team ship the settlement service."
    assert not no_banned_openers(draft).passed


def test_an_em_dash_is_caught(tailored):
    draft = copy.deepcopy(tailored)
    draft.headline = "Backend Engineer — Node.js"
    assert not ascii_only(draft).passed


def test_an_empty_summary_is_caught(tailored):
    draft = copy.deepcopy(tailored)
    draft.summary.text = "Backend engineer."
    assert not summary_present(draft).passed


def test_keyword_coverage_is_a_ratio(tailored):
    finding = keyword_coverage(tailored, ["Node.js", "PostgreSQL", "Kubernetes", "Kafka"])
    assert 0.0 < finding.value < 1.0
    assert "2/4" in finding.detail


def test_surfaced_twice_reports_rather_than_fails(tailored):
    """It is a signal about how well the prompt lands, not a rule. Failing a
    rewrite for it would push toward stuffing, which is the opposite of useful."""
    finding = surfaced_twice(tailored, ["Node.js", "PostgreSQL"])
    assert finding.passed
    assert 0.0 <= finding.value <= 1.0
