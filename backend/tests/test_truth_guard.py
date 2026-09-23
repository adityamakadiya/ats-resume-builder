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


def test_jd_capability_phrases_are_not_treated_as_technologies():
    """A posting writes requirements as capability phrases, and the tailoring
    prompt tells the model to reuse the posting's wording. Seeding those phrases
    as technology names meant the guard rejected the rewrite for doing what it
    was asked, which cost a second Opus call on every single run."""
    vocabulary = build_vocabulary(
        [
            "multi-tenant data isolation",
            "designing and scaling RESTful APIs",
            "production experience",
            "Kubernetes",
            "Apache Kafka",
            "Nomad",
        ]
    )
    assert "kubernetes" in vocabulary
    assert "apache kafka" in vocabulary
    assert "nomad" in vocabulary
    assert "multi-tenant data isolation" not in vocabulary
    assert "designing and scaling restful apis" not in vocabulary
    assert "production experience" not in vocabulary


def test_a_rewrite_may_use_the_postings_phrasing(tailored, facts):
    """The exact false positive that was firing: the resume says 'multi-tenant
    isolation', the posting says 'multi-tenant data isolation'."""
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets[0].text = (
        "Architected multi-tenant data isolation with tenant-scoped PostgreSQL queries."
    )
    draft.experience[0].bullets[0].source_ids = ["E1.B1", "S1"]
    raw = RAW + "\n- Architected multi-tenant isolation with tenant-scoped queries."
    report = run_truth_guard(draft, facts, raw, jd_terms=["multi-tenant data isolation"])
    assert ViolationCode.UNSOURCED_TECH not in codes(report)


def test_seeding_discriminates_by_shape_not_by_blocklist():
    """A blocklist of generic words always leaks a new one.

    The first version blocked "multi-tenant data isolation" and then let
    "workflow automation" through on a real run, which rejected the draft and
    bought a second Opus call. A posting writes the difference between a
    technology and a capability in its capitalisation, and that is the signal
    now used.
    """
    vocabulary = set(
        build_vocabulary(
            [
                "Kubernetes", "Apache Kafka", "Nomad", "Node.js", "CI/CD", "gRPC",
                "workflow automation", "multi-tenant data isolation",
                "production experience", "end to end ownership", "event driven design",
            ]
        )
    )
    for name in ["kubernetes", "apache kafka", "nomad", "node.js", "ci/cd", "grpc"]:
        assert name in vocabulary, f"{name} is a technology name and must be watched"
    for phrase in [
        "workflow automation",
        "multi-tenant data isolation",
        "production experience",
        "end to end ownership",
        "event driven design",
    ]:
        assert phrase not in vocabulary, f"{phrase} is a capability, not a technology"


def test_a_rewrite_may_reuse_a_capability_phrase_from_the_posting(tailored, facts):
    """The exact false positive seen on a live LinkedIn run."""
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets[0].text = (
        "Cut manual publishing effort 45% through webhook-driven workflow automation."
    )
    draft.experience[0].bullets[0].source_ids = ["E1.B2"]
    raw = RAW + "\n- Cut manual publishing effort 45% with webhook-driven automation."
    report = run_truth_guard(draft, facts, raw, jd_terms=["workflow automation"])
    assert ViolationCode.UNSOURCED_TECH not in codes(report)


def test_source_ids_are_matched_without_regard_to_case(tailored, facts):
    """The model writes "summary" as often as "SUMMARY". Rejecting a correct
    citation over its capitalisation bought a repair round for nothing, and the
    eval suite hit it on the first run."""
    draft = copy.deepcopy(tailored)
    draft.summary.source_ids = ["summary", "e1.b1"]
    draft.experience[0].source_id = "e1"
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.UNKNOWN_SOURCE_ID not in codes(report)
    assert ViolationCode.ALTERED_EMPLOYER_FACT not in codes(report)


def test_the_postings_term_for_something_the_resume_names_differently(tailored, facts):
    """The prompt tells the model to prefer the posting's wording. The guard was
    then rejecting it for doing so: a resume saying "role-based access" against a
    posting saying "RBAC" is one claim, not two."""
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets[0].text = "Implemented JWT auth and RBAC for admin tooling."
    draft.experience[0].bullets[0].source_ids = ["E1.B1"]
    raw = RAW + "\n- Implemented JWT authentication and role-based access for admin tooling."
    report = run_truth_guard(draft, facts, raw, jd_terms=["RBAC", "JWT"])
    assert ViolationCode.UNSOURCED_TECH not in codes(report)


def test_morphology_does_not_count_as_fabrication(tailored, facts):
    """Every remaining false rejection the eval suite found was a word form.

    The posting says "settlements", the resume says "settlement". The posting
    says "containerization", the resume says "Containerised". These are one
    claim each, and rejecting the draft over them bought a repair round on
    every single eval case.
    """
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets[0].text = (
        "Containerization of four services, handling payout webhook retries for settlements."
    )
    draft.experience[0].bullets[0].source_ids = ["E1.B1"]
    raw = (
        RAW
        + "\n- Containerised four services with Docker."
        + "\n- Built a retry pipeline for failed payout webhooks on the settlement service."
    )
    report = run_truth_guard(
        draft, facts, raw, jd_terms=["Containerization", "Webhooks", "Settlements"]
    )
    assert ViolationCode.UNSOURCED_TECH not in codes(report), [
        v.detail for v in report.violations
    ]


def test_generic_and_domain_nouns_are_not_technologies():
    """A posting naming its own business domain is describing the job, not a
    tool a candidate could fake."""
    vocabulary = set(build_vocabulary(["Queue", "Settlements", "Reconciliation", "Kafka"]))
    assert "kafka" in vocabulary
    for noun in ["queue", "settlements", "reconciliation"]:
        assert noun not in vocabulary, f"{noun} is domain vocabulary, not a technology"


def test_owning_a_tool_is_claiming_what_it_does(tailored, facts):
    """A resume that says BullMQ has a job queue whether or not it writes the
    word. The eval caught the guard rejecting the posting's word for a thing the
    candidate demonstrably owns, which cost a repair round."""
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets[0].text = "Built the retry queue for failed payouts."
    draft.experience[0].bullets[0].source_ids = ["E1.B1"]
    raw = RAW + "\n- Built a retry pipeline on BullMQ with exponential backoff."
    report = run_truth_guard(draft, facts, raw, jd_terms=["Queue"])
    assert ViolationCode.UNSOURCED_TECH not in codes(report), [
        v.detail for v in report.violations
    ]


def test_implication_runs_one_way_only(tailored, facts):
    """Owning BullMQ lets you say "queue". Saying "queue" does not let you claim
    BullMQ, and a bidirectional rule would have opened exactly that hole."""
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets[0].text = "Built the payout pipeline on BullMQ."
    draft.experience[0].bullets[0].source_ids = ["E1.B1"]
    raw = RAW + "\n- Built a retry queue for failed payouts."
    report = run_truth_guard(draft, facts, raw, jd_terms=["BullMQ"])
    assert ViolationCode.UNSOURCED_TECH in codes(report)


# --------------------------------------------------------------------------- #
# Metric binding                                                               #
# --------------------------------------------------------------------------- #
#
# The first version of this guard accepted any figure whose digits appeared
# anywhere in the corpus. That licensed the commonest fabrication a model
# commits on a resume: taking a real number and attaching it to an achievement
# it did not come from. The tailoring prompt asks against it in prose; these
# tests are what actually enforce it.


def test_metric_relocated_to_another_achievement_is_caught(tailored, facts):
    """45% is real, but it belongs to the Redis caching work in E1.B2.

    Citing only E1.B1 and claiming it for the REST API work is a fabrication,
    even though the digits appear in the uploaded resume.
    """
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets.append(
        TailoredBullet(
            text="Shipped merchant settlement endpoints, lifting throughput by 45%.",
            source_ids=["E1.B1"],
        )
    )
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.UNSOURCED_METRIC in codes(report)


def test_a_summary_may_aggregate_a_figure_from_the_wider_resume(tailored, facts):
    """A summary speaks for the whole document, so the corpus is its source.

    This is the one place the looser rule is correct: a summary that says the
    candidate cut response time by 45% is restating the resume, not inventing.
    """
    draft = copy.deepcopy(tailored)
    draft.summary.text = "Backend engineer who cut settlement response time by 45%."
    draft.summary.source_ids = ["SUMMARY"]
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.UNSOURCED_METRIC not in codes(report)


def test_the_same_figure_may_not_be_claimed_by_two_bullets(tailored, facts):
    """One achievement stretched across a page reads as padding, and is.

    The tailoring prompt says 'Do not reuse the same figure in two bullets'.
    Until now nothing checked it.
    """
    draft = copy.deepcopy(tailored)
    draft.experience[0].bullets.append(
        TailoredBullet(
            text="Tuned the reconciliation query path, cutting response time by 45%.",
            source_ids=["E1.B2"],
        )
    )
    report = run_truth_guard(draft, facts, RAW)
    assert ViolationCode.DUPLICATED_METRIC in codes(report)


def test_a_summary_restating_a_bullets_figure_is_not_a_duplicate(tailored, facts):
    """Uniqueness is a rule about bullets competing with each other.

    The shipped fixture already has 45% in both the summary and a bullet, which
    is exactly how a good resume reads. If this fires, the rule is too wide.
    """
    report = run_truth_guard(tailored, facts, RAW)
    assert ViolationCode.DUPLICATED_METRIC not in codes(report)
    assert report.passed, [v.detail for v in report.violations]
