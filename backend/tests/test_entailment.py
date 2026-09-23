"""The entailment pass.

Two halves. The offline half pins the plumbing: the mapping from a model
finding to a TruthViolation, the no-call shortcut on empty input, and the
promise that a failed call degrades to [] instead of taking the run down. It
stubs ``structured`` so the default suite never spends money.

The live half is the only thing that actually tests the prompt, because the
prompt's whole job is a judgement call no stub can stand in for. Four honest
rewrites that must come back clean, four fabrications that must not. Run them
with ``-m live``.
"""

from __future__ import annotations

import pytest

from atsresume.llm import LLMError
from atsresume.models import ViolationCode
from atsresume.truth import entailment
from atsresume.truth.entailment import (
    EntailmentFinding,
    EntailmentReport,
    check_entailment,
)


def _stub(monkeypatch, report: EntailmentReport) -> dict:
    """Replace the LLM call with a canned answer, recording how it was called."""
    seen: dict = {"calls": 0, "user": "", "system": "", "step": ""}

    def fake_structured(*, system: str, user: str, schema, step: str = "analyze", **kwargs):
        seen["calls"] += 1
        seen["system"] = system
        seen["user"] = user
        seen["step"] = step
        assert schema is EntailmentReport
        return report

    monkeypatch.setattr(entailment, "structured", fake_structured)
    return seen


def test_finding_maps_onto_a_violation(monkeypatch):
    seen = _stub(
        monkeypatch,
        EntailmentReport(
            findings=[
                EntailmentFinding(
                    index=1,
                    unsupported_span="Led a team of engineers",
                    reason="The source describes reviewing code, not leading anyone.",
                )
            ]
        ),
    )

    violations = check_entailment(
        [
            ("Experience / Acme / bullet 1", "Built REST APIs in Node.js.", "Designed REST APIs."),
            (
                "Experience / Acme / bullet 2",
                "Reviewed code before merge and debugged production issues with Sentry.",
                "Led a team of engineers across three time zones, owning the service end to end.",
            ),
        ]
    )

    assert seen["calls"] == 1
    assert seen["step"] == "analyze"
    assert len(violations) == 1
    violation = violations[0]
    assert violation.code is ViolationCode.UNSUPPORTED_CLAIM
    assert violation.severity == "error"
    assert violation.location == "Experience / Acme / bullet 2"
    assert violation.offending == "Led a team of engineers"
    assert "Led a team of engineers" in violation.detail
    assert "not leading anyone" in violation.detail


def test_all_pairs_are_numbered_in_one_batched_call(monkeypatch):
    seen = _stub(monkeypatch, EntailmentReport())

    violations = check_entailment(
        [("A", "source a", "rewrite a"), ("B", "source b", "rewrite b")]
    )

    assert violations == []
    assert seen["calls"] == 1
    assert "PAIR 0" in seen["user"] and "PAIR 1" in seen["user"]
    assert "source b" in seen["user"] and "rewrite b" in seen["user"]


def test_clean_report_produces_no_violations(monkeypatch):
    _stub(monkeypatch, EntailmentReport(findings=[]))
    assert check_entailment([("A", "source", "rewrite")]) == []


@pytest.mark.parametrize("span", ["", "   ", "NONE", "none"])
def test_an_empty_or_none_span_is_not_a_violation(monkeypatch, span):
    _stub(
        monkeypatch,
        EntailmentReport(findings=[EntailmentFinding(index=0, unsupported_span=span, reason="")]),
    )
    assert check_entailment([("A", "source", "rewrite")]) == []


@pytest.mark.parametrize("index", [-1, 5])
def test_a_finding_for_a_pair_that_does_not_exist_is_dropped(monkeypatch, index):
    _stub(
        monkeypatch,
        EntailmentReport(
            findings=[EntailmentFinding(index=index, unsupported_span="invented", reason="x")]
        ),
    )
    assert check_entailment([("A", "source", "rewrite")]) == []


def test_empty_input_returns_nothing_without_calling_the_model(monkeypatch):
    def explode(**kwargs):
        raise AssertionError("check_entailment called the model for an empty document")

    monkeypatch.setattr(entailment, "structured", explode)
    assert check_entailment([]) == []


def test_an_llm_failure_degrades_to_no_findings(monkeypatch, caplog):
    def fail(**kwargs):
        raise LLMError("Rate limited by the API. Retry in a moment.")

    monkeypatch.setattr(entailment, "structured", fail)

    with caplog.at_level("WARNING"):
        assert check_entailment([("A", "source", "rewrite")]) == []
    assert "Entailment check skipped" in caplog.text


def test_a_missing_reason_still_gives_a_readable_detail(monkeypatch):
    _stub(
        monkeypatch,
        EntailmentReport(
            findings=[EntailmentFinding(index=0, unsupported_span="across 12 markets", reason="")]
        ),
    )
    violation = check_entailment([("Experience / Acme", "Shipped the checkout flow.", "x")])[0]
    assert violation.detail.startswith("'across 12 markets' is not supported")


# --------------------------------------------------------------------------- #
# The prompt itself. Costs money; deselected by default.                       #
# --------------------------------------------------------------------------- #

HONEST = [
    pytest.param(
        "Terminology swap to the posting's vocabulary",
        "Implemented role-based access control for the internal admin panel, with "
        "per-endpoint permission checks.",
        "Built RBAC for the internal admin panel, enforcing permissions at every endpoint.",
        id="honest-terminology-swap",
    ),
    pytest.param(
        "Two source bullets compressed into one line",
        "Added Redis caching to the settlement lookup endpoint. Wrote PostgreSQL indexes for "
        "the reconciliation queries.",
        "Cut settlement read latency with a Redis cache layer and PostgreSQL indexes on the "
        "reconciliation path.",
        id="honest-compression",
    ),
    pytest.param(
        "Stronger verb, detail dropped, nothing added",
        "Worked on containerising three services with Docker and helped set up GitHub Actions "
        "for the team's builds.",
        "Containerised three services with Docker and automated builds in GitHub Actions.",
        id="honest-stronger-verb",
    ),
    pytest.param(
        "An implicit outcome made explicit",
        "Introduced a pytest suite covering the payment reconciliation module, which had no "
        "tests before.",
        "Established pytest coverage for the previously untested payment reconciliation module, "
        "catching regressions before release.",
        id="honest-implicit-outcome",
    ),
]

FABRICATED = [
    pytest.param(
        "Invented team leadership",
        "Reviewed code before merge and debugged production issues with Sentry.",
        "Led a team of four engineers, setting the review standard and the on-call rotation.",
        id="fabricated-leadership",
    ),
    pytest.param(
        "Invented ownership and on-call",
        "Contributed REST endpoints to the merchant settlement service alongside two other "
        "engineers.",
        "Owned the merchant settlement service end to end, including its production on-call.",
        id="fabricated-ownership",
    ),
    pytest.param(
        "Invented scale",
        "Built the currency formatting helpers used by the checkout page.",
        "Built the currency layer powering checkout across 12 markets.",
        id="fabricated-scale",
    ),
    pytest.param(
        "Invented duration",
        "Backend Engineer, Acme Payments, Jan 2024 to Aug 2024. Built REST APIs for settlement.",
        "Built and maintained settlement REST APIs over three years at Acme Payments.",
        id="fabricated-duration",
    ),
]


@pytest.mark.live
@pytest.mark.parametrize("label,source,rewritten", HONEST)
def test_live_honest_rewrites_are_left_alone(label, source, rewritten):
    violations = check_entailment([(label, source, rewritten)])
    assert violations == [], f"false positive on {label}: {[v.detail for v in violations]}"


@pytest.mark.live
@pytest.mark.parametrize("label,source,rewritten", FABRICATED)
def test_live_fabricated_claims_are_caught(label, source, rewritten):
    violations = check_entailment([(label, source, rewritten)])
    assert len(violations) == 1, f"missed fabrication in {label}"
    assert violations[0].code is ViolationCode.UNSUPPORTED_CLAIM
    assert violations[0].location == label


@pytest.mark.live
def test_live_a_mixed_document_flags_only_the_fabrications():
    """The batched shape, end to end: honest and invented lines in one call."""
    pairs = [(p.values[0], p.values[1], p.values[2]) for p in HONEST + FABRICATED]
    violations = check_entailment(pairs)
    flagged = {v.location for v in violations}
    assert flagged == {p.values[0] for p in FABRICATED}
