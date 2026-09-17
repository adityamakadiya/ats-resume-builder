"""Persistence.

Every test runs against a throwaway database. A suite that writes to the real
one would corrupt a user's history to check that writing works.
"""

from __future__ import annotations

import copy

import pytest

from atsresume import store
from atsresume.config import get_settings
from atsresume.models import AtsReport, GapAnalysis, JobSpec, Strategy, SubScores, TruthReport


@pytest.fixture(autouse=True)
def temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(get_settings(), "db_path", str(tmp_path / "test.db"))
    store.init()
    yield


def _run_kwargs(facts, tailored, **overrides):
    payload = {
        "raw_text": "Priya Nair\nBackend Engineer\nBuilt REST APIs in Node.js.",
        "facts": facts,
        "job": JobSpec(company="Acme Payments", title="Backend Engineer"),
        "gaps": GapAnalysis(),
        "tailored": tailored,
        "truth": TruthReport(passed=True, error_count=0, warning_count=0),
        "report": AtsReport(
            overall=72.5,
            sub_scores=SubScores(
                keyword_match=80, skills_coverage=70, section_completeness=100, experience_match=50
            ),
        ),
        "strategy": Strategy(
            should_apply="yes",
            fit_estimate="Good",
            biggest_strength="s",
            biggest_gap="g",
            cover_letter_worthwhile=False,
            cover_letter_rationale="r",
            outreach_angle="o",
        ),
        "jd_text": "A job description long enough to be real. " * 20,
        "jd_source": "pasted",
        "repair_attempted": False,
        "seconds": 91.2,
        "cost_usd": 0.18,
    }
    payload.update(overrides)
    return payload


def test_facts_round_trip(facts):
    raw = "Priya Nair\nBackend engineer who built things."
    assert store.get_facts(raw) is None
    store.put_facts(raw, facts)
    assert store.get_facts(raw) == facts


def test_storing_the_same_resume_twice_does_not_duplicate_it(facts):
    raw = "Priya Nair\nBackend engineer."
    first = store.put_facts(raw, facts)
    second = store.put_facts(raw, facts)
    assert first == second


def test_changing_the_extraction_contract_invalidates_stored_facts(facts, monkeypatch):
    """Facts shaped for an older prompt must not be served against a newer one."""
    raw = "Priya Nair\nBackend engineer."
    store.put_facts(raw, facts)
    assert store.get_facts(raw) is not None

    monkeypatch.setattr(store, "_extraction_version", lambda: "differentv")
    assert store.get_facts(raw) is None


def test_a_run_is_saved_and_listed(facts, tailored):
    run_id = store.save_run(**_run_kwargs(facts, tailored))
    listed = store.list_runs()
    assert len(listed) == 1
    assert listed[0].id == run_id
    assert listed[0].company == "Acme Payments"
    assert listed[0].ats_score == 72.5
    assert listed[0].status == "draft"
    assert listed[0].candidate == "Priya Nair"


def test_a_run_round_trips_whole(facts, tailored):
    run_id = store.save_run(**_run_kwargs(facts, tailored))
    detail = store.get_run(run_id)
    assert detail is not None
    assert detail["tailored"]["headline"] == tailored.headline
    assert detail["report"]["overall"] == 72.5
    assert detail["facts"]["contact"]["name"] == "Priya Nair"


def test_edits_survive(facts, tailored):
    """The whole point: a hand-edited resume must outlive a browser refresh."""
    run_id = store.save_run(**_run_kwargs(facts, tailored))
    edited = copy.deepcopy(tailored)
    edited.experience[0].bullets[0].text = "Hand edited after the fact."

    assert store.update_run(run_id, tailored=edited)
    reopened = store.get_run(run_id)
    assert reopened["tailored"]["experience"][0]["bullets"][0]["text"] == "Hand edited after the fact."


def test_status_and_notes_are_recorded(facts, tailored):
    run_id = store.save_run(**_run_kwargs(facts, tailored))
    store.update_run(run_id, status="applied", notes="Referred by a friend.")
    detail = store.get_run(run_id)
    assert detail["status"] == "applied"
    assert detail["notes"] == "Referred by a friend."


def test_many_runs_share_one_resume(facts, tailored):
    """One resume against many postings is the normal pattern, and the history
    should show that rather than a copy of the resume per application."""
    for company in ("Acme", "Globex", "Initech"):
        store.save_run(
            **_run_kwargs(facts, tailored, job=JobSpec(company=company, title="Backend Engineer"))
        )
    assert len(store.list_runs()) == 3
    with store.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM resumes").fetchone()[0] == 1


def test_deleting_a_run_leaves_the_resume(facts, tailored):
    run_id = store.save_run(**_run_kwargs(facts, tailored))
    assert store.delete_run(run_id)
    assert store.get_run(run_id) is None
    with store.connect() as connection:
        assert connection.execute("SELECT COUNT(*) FROM resumes").fetchone()[0] == 1


def test_missing_rows_report_rather_than_raise():
    assert store.get_run(9999) is None
    assert store.get_resume(9999) is None
    assert not store.update_run(9999, status="applied")
    assert not store.delete_run(9999)


def test_runs_come_back_newest_first(facts, tailored):
    for company in ("First", "Second", "Third"):
        store.save_run(
            **_run_kwargs(facts, tailored, job=JobSpec(company=company, title="Engineer"))
        )
    assert [r.company for r in store.list_runs()] == ["Third", "Second", "First"]


def test_the_original_text_is_kept_for_the_guard(facts, tailored):
    """Reconstructing the resume from extracted facts loses whatever the
    extractor dropped, and the guard checks against what was actually written."""
    raw = "Priya Nair\nA line the extractor happened to miss entirely."
    resume_id = store.put_facts(raw, facts)
    loaded = store.get_resume(resume_id)
    assert loaded is not None
    assert loaded[1] == raw
