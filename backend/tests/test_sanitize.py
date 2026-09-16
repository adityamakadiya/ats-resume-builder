"""Typographic cleanup.

The em dash is the clearest signal that a document was machine-drafted, and a
recruiter who spots one has a reason to discount the rest. The model reaches for
them constantly, so an instruction alone is not a control.
"""

from __future__ import annotations

import copy

import pytest

from atsresume.pipeline.sanitize import clean_text, contains_tells, sanitize


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("Cut latency — measured at p95 — by tuning", "Cut latency, measured at p95, by tuning"),
        ("exponential—backoff retries", "exponential-backoff retries"),
        ("multi–tenant isolation", "multi-tenant isolation"),
        ("doesn’t break", "doesn't break"),
        ("“the thing”", '"the thing"'),
        ("and so on…", "and so on..."),
        ("non breaking", "non breaking"),
        ("plain ascii text", "plain ascii text"),
    ],
)
def test_clean_text(raw, expected):
    assert clean_text(raw) == expected


def test_headline_uses_a_pipe_not_a_comma():
    """A title line reads as a list with commas; the pipe keeps the hierarchy."""
    assert (
        clean_text("Full Stack Engineer — TypeScript, Node.js", separator=" | ")
        == "Full Stack Engineer | TypeScript, Node.js"
    )


def test_sanitize_covers_every_authored_field(tailored):
    draft = copy.deepcopy(tailored)
    draft.headline = "Engineer — Node.js"
    draft.summary.text = "Built things — quickly."
    draft.skills[0].items = ["Node.js—ish", "Express"]
    draft.experience[0].bullets[0].text = "Cut latency — by half — with Redis."
    draft.experience[0].title = "Engineer – Backend"

    cleaned = sanitize(draft)
    assert contains_tells(cleaned) == []
    assert "—" not in cleaned.headline
    assert cleaned.headline == "Engineer | Node.js"
    assert cleaned.experience[0].bullets[0].text == "Cut latency, by half, with Redis."


def test_sanitize_is_idempotent(tailored):
    once = sanitize(copy.deepcopy(tailored))
    twice = sanitize(copy.deepcopy(once))
    assert once.model_dump() == twice.model_dump()


def test_clean_text_does_not_leave_doubled_punctuation():
    assert clean_text("Built the thing, — and shipped it") == "Built the thing, and shipped it"
