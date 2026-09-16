"""The guard is the only thing standing between the model and a resume the
candidate cannot defend in an interview, so it gets the most tests."""

from __future__ import annotations

import copy

from atsresume.models import TailoredBullet, ViolationCode
from atsresume.truth.guard import run_truth_guard
from atsresume.truth.vocabulary import build_vocabulary, terms_present

RAW = """Priya Nair
Backend Engineer | Bengaluru | priya@example.com

EXPERIENCE
Acme Payments - Backend Engineer (Jun 2023 - Present)
- Built REST APIs in Node.js and Express for the merchant settlement service.
- Added Redis caching to the settlement lookup endpoint, cutting response time by 45%.

SKILLS
Backend: Node.js, Express, PostgreSQL, Redis
"""


def codes(report) -> set[ViolationCode]:
    return {v.code for v in report.violations}


def test_honest_rewrite_passes(tailored, facts):
    report = run_truth_guard(tailored, facts, RAW)
    assert report.passed, [v.detail for v in report.violations]
    assert report.error_count == 0


def test_invented_technology_is_caught(tailored, facts):
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets.append(
        TailoredBullet(
            text="Deployed the settlement service on Kubernetes with Terraform-managed infrastructure.",
            source_ids=["E1.B1"],
        )
    )
    report = run_truth_guard(draft, facts, RAW)
    assert not report.passed
    assert ViolationCode.UNSOURCED_TECH in codes(report)


def test_invented_metric_is_caught(tailored, facts):
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets.append(
        TailoredBullet(
            text="Scaled the settlement pipeline to 12000 transactions per second.",
            source_ids=["E1.B2"],
        )
    )
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.UNSOURCED_METRIC in codes(report)


def test_title_inflation_is_caught(tailored, facts):
    draft = copy.deepcopy(tailored)
    draft.experience[0].title = "Senior Backend Engineer"
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.ALTERED_EMPLOYER_FACT in codes(report)


def test_date_extension_is_caught(tailored, facts):
    """Stretching a start date backwards is the quietest lie on a resume."""
    draft = copy.deepcopy(tailored)
    draft.experience[0].start_date = "Jun 2021"
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.ALTERED_EMPLOYER_FACT in codes(report)


def test_company_rename_is_caught(tailored, facts):
    draft = copy.deepcopy(tailored)
    draft.experience[0].company = "Acme Payments International"
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.ALTERED_EMPLOYER_FACT in codes(report)


def test_unsourced_line_is_caught(tailored, facts):
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets.append(
        TailoredBullet(text="Led the platform team.", source_ids=[])
    )
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.UNSOURCED_LINE in codes(report)


def test_unknown_source_id_is_caught(tailored, facts):
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets[0].source_ids = ["E9.B9"]
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.UNKNOWN_SOURCE_ID in codes(report)


def test_metric_already_in_resume_is_allowed(tailored, facts):
    """45% is in the source, so restating it anywhere is honest."""
    draft = copy.deepcopy(tailored)
    draft.summary.text = "Backend engineer who cut settlement response time by 45%."
    draft.summary.source_ids = ["E1.B2"]
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.UNSOURCED_METRIC not in codes(report)


def test_jd_terms_extend_the_watched_vocabulary(tailored, facts):
    """A technology outside the built-in list is invisible until the JD names it.

    This is the whole reason the vocabulary is seeded per-application: a static
    list cannot know about whatever shipped last quarter.
    """
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets.append(
        TailoredBullet(text="Ran the workloads on Nomad.", source_ids=["E1.B1"])
    )

    without = ViolationCode.UNSOURCED_TECH in codes(run_truth_guard(draft, facts, RAW))
    with_jd = ViolationCode.UNSOURCED_TECH in codes(
        run_truth_guard(draft, facts, RAW, jd_terms=["Nomad"])
    )
    assert not without, "Nomad is not in the built-in vocabulary, so it starts invisible"
    assert with_jd, "once the JD names Nomad, inventing it must be caught"


def test_the_tech_check_is_about_fabrication_not_emphasis(facts, tailored):
    """Where the line is drawn, stated explicitly because it is a design choice.

    UNSOURCED_TECH means "absent from the uploaded resume", so it is evaluated
    against everything the candidate ever claimed, not against the narrowed
    sources of the individual line. A headline that leans on a technology used
    in an old role is a stretch of emphasis, not a fabrication, and flagging it
    would make the guard noisy enough to be ignored — which is how a guard
    stops protecting anyone.

    Source narrowing still does real work on the other checks: metrics, unknown
    ids, and unsourced lines are all judged per-line.
    """
    from atsresume.models import ExperienceFact

    facts.experience.append(
        ExperienceFact(
            id="E2",
            company="Old Corp",
            title="Intern",
            start_date="Jan 2022",
            end_date="May 2022",
            tech=["Kubernetes"],
        )
    )
    draft = copy.deepcopy(tailored)
    draft.headline = "Backend Engineer specialising in Kubernetes"
    assert ViolationCode.UNSOURCED_TECH not in codes(run_truth_guard(draft, facts, RAW))

    # But a technology claimed nowhere at all is still caught in the headline.
    draft.headline = "Backend Engineer specialising in Terraform"
    assert ViolationCode.UNSOURCED_TECH in codes(run_truth_guard(draft, facts, RAW))


def test_word_boundaries_prevent_false_positives():
    """'Go' must not match 'Google', or every resume trips the guard."""
    vocabulary = build_vocabulary()
    assert "go" not in terms_present("Worked with Google Cloud Storage", vocabulary)
    assert "go" in terms_present("Wrote services in Go and Python", vocabulary)


def test_alias_matching(tailored, facts):
    """Postgres and PostgreSQL are the same claim written two ways."""
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets[0].text = "Tuned Postgres queries for the settlement service."
    draft.experience[0].bullets[0].source_ids = ["E1.B1", "S1"]
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.UNSOURCED_TECH not in codes(report)


def test_empty_resume_does_not_crash():
    from atsresume.models import Contact, ResumeFacts, TailoredResume, TailoredSummary

    empty_facts = ResumeFacts(contact=Contact(name="Nobody"))
    empty_tailored = TailoredResume(headline="", summary=TailoredSummary(text=""))
    report = run_truth_guard(empty_tailored, empty_facts, "")
    assert report.passed
