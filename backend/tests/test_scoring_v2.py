"""Tests for the v2 ATS scorer.

The point of this file is not coverage, it is proof that the v2 score cannot be
raised by the two things v1 rewarded: repeating a keyword, and existing. Every
test below is a property of the scoring function, not a snapshot of a number.
"""

from __future__ import annotations

import pytest

from atsresume.models import (
    ExperienceYears,
    Importance,
    JobSpec,
    Keyword,
    Requirement,
    RequirementCategory,
    TailoredBullet,
    TailoredEducation,
    TailoredExperience,
    TailoredResume,
    TailoredSkillGroup,
    TailoredSummary,
)
from atsresume.pipeline import scoring as v1
from atsresume.pipeline import scoring_v2 as v2

# --------------------------------------------------------------------------- #
# Fixtures                                                                     #
# --------------------------------------------------------------------------- #


def build_job() -> JobSpec:
    """A backend posting that the conftest ``facts`` fixture plausibly answers.

    Module level rather than fixture-only so scripts/export_score_fixtures.py
    can freeze the same posting the tests reason about. Two definitions of the
    reference job would drift.
    """
    return JobSpec(
        company="Northwind Logistics",
        title="Backend Engineer",
        location="Bengaluru, India",
        experience_years=ExperienceYears(min=2.0, max=5.0, raw="2-5 years"),
        requirements=[
            Requirement(
                term="Node.js",
                category=RequirementCategory.FRAMEWORK,
                importance=Importance.REQUIRED,
                evidence="Strong Node.js experience",
            ),
            Requirement(
                term="PostgreSQL query optimisation and indexing",
                category=RequirementCategory.DATABASE,
                importance=Importance.REQUIRED,
                evidence="PostgreSQL query optimisation and indexing",
            ),
            Requirement(
                term="REST API design",
                category=RequirementCategory.ARCHITECTURE,
                importance=Importance.REQUIRED,
                evidence="Design and ship REST APIs",
            ),
            Requirement(
                term="Redis caching",
                category=RequirementCategory.DATABASE,
                importance=Importance.PREFERRED,
                evidence="Redis caching a plus",
            ),
            Requirement(
                term="Docker",
                category=RequirementCategory.CLOUD_DEVOPS,
                importance=Importance.PREFERRED,
                evidence="Containerised deployment",
            ),
        ],
        keywords=[
            Keyword(term="Node.js", variants=["Node", "NodeJS"], weight=5),
            Keyword(term="PostgreSQL", variants=["Postgres"], weight=5),
            Keyword(term="Redis", variants=[], weight=3),
            Keyword(term="REST", variants=["RESTful"], weight=4),
            Keyword(term="Express", variants=[], weight=2),
            Keyword(term="Docker", variants=[], weight=3),
            Keyword(term="Kubernetes", variants=["K8s"], weight=2),
            Keyword(term="Kafka", variants=[], weight=2),
        ],
    )


def make_doc(
    summary: str,
    skills: list[str],
    bullets: list[str],
    *,
    education: bool = True,
    headline: str = "Backend Engineer",
) -> TailoredResume:
    """A minimal but structurally complete tailored document."""
    return TailoredResume(
        headline=headline,
        summary=TailoredSummary(text=summary, source_ids=["SUMMARY"]),
        skills=(
            [TailoredSkillGroup(category="Backend", items=skills, source_ids=["S1"])]
            if skills
            else []
        ),
        experience=[
            TailoredExperience(
                source_id="E1",
                company="Acme Payments",
                title="Backend Engineer",
                location="Bengaluru",
                start_date="Jun 2023",
                end_date="Present",
                bullets=[TailoredBullet(text=t, source_ids=["E1.B1"]) for t in bullets],
            )
        ],
        education=(
            [
                TailoredEducation(
                    source_id="ED1",
                    institution="GTU",
                    degree="B.E. in Computer Engineering",
                    dates="2019 - 2023",
                )
            ]
            if education
            else []
        ),
    )


# Five documents, deliberately ordered from indefensible to excellent. Keyword
# coverage rises across them, but so does the quality of the writing, which is
# the spread v1 could not see.

D1_IRRELEVANT = make_doc(
    summary="Motivated team player and fast learner passionate about technology.",
    skills=["Microsoft Word", "Communication"],
    bullets=[
        "Helped the team with day to day activities as required.",
        "Worked on assigned tasks and reported progress to the manager.",
        "Responsible for maintaining documentation across the department.",
    ],
    education=False,
)

D2_WEAK = make_doc(
    summary="Backend developer with experience in web development.",
    skills=["Node.js", "JavaScript"],
    bullets=[
        "Worked on backend services written in Node.js.",
        "Responsible for fixing bugs reported by the support team.",
        "Assisted with releases and deployment activities.",
    ],
)

D3_DUTIES = make_doc(
    summary="Backend engineer working with Node.js, Express and PostgreSQL on REST services.",
    skills=["Node.js", "Express", "PostgreSQL", "Redis"],
    bullets=[
        "Developed REST endpoints for the settlement service.",
        "Maintained PostgreSQL tables used by the reporting jobs.",
        "Configured Docker images for the service.",
    ],
)

D4_GOOD = make_doc(
    summary=(
        "Backend engineer building REST APIs on Node.js and Express, with day to day "
        "PostgreSQL and Redis work on read-heavy settlement traffic."
    ),
    skills=["Node.js", "Express", "PostgreSQL", "Redis", "Docker"],
    bullets=[
        "Designed REST endpoints on Express for merchant settlement, cutting the payout "
        "reconciliation window from two days to four hours.",
        "Added a composite index to the PostgreSQL ledger table, reducing the nightly "
        "report query from 90 seconds to under three.",
        "Containerised the service with Docker so that releases stopped needing a manual "
        "host setup step.",
    ],
)

D5_STRONG = make_doc(
    summary=(
        "Backend engineer building REST APIs on Node.js, Express and Kafka, with deep "
        "PostgreSQL indexing and Redis caching work on read-heavy settlement traffic, "
        "deployed on Docker and Kubernetes."
    ),
    skills=["Node.js", "Express", "PostgreSQL", "Redis", "Docker", "Kubernetes", "Kafka"],
    bullets=[
        "Rewrote the settlement lookup behind a Redis cache with a 60 second TTL, cutting "
        "p95 latency from 800ms to 120ms.",
        "Added a partial index on the PostgreSQL ledger and rewrote the query plan, taking "
        "the nightly reconciliation job from 40 minutes to 6.",
        "Moved payout fan out onto a Kafka consumer with idempotency keys and exponential "
        "backoff retries, eliminating the duplicate payouts that manual replays caused.",
        "Split the deploy into a Kubernetes rolling update with a readiness probe, so that "
        "a bad release stopped taking the API down for 5 minutes.",
    ],
)

@pytest.fixture
def job() -> JobSpec:
    return build_job()



# The document best-of-N against v1 converges on: every posting term crammed
# into the skills list, then repeated through the bullets. It covers strictly
# more keywords than HONEST and is strictly worse to read.
STUFFED = make_doc(
    summary=(
        "Backend engineer skilled in Node.js, PostgreSQL, Redis, REST, Express, Docker, "
        "Kubernetes and Kafka, building REST APIs on Node.js and Express with PostgreSQL "
        "and Redis on read-heavy settlement traffic."
    ),
    skills=[
        "Node.js", "NodeJS", "PostgreSQL", "Postgres", "Redis", "REST", "RESTful",
        "Express", "Docker", "Kubernetes", "K8s", "Kafka",
    ],
    bullets=[
        "Designed REST APIs on Node.js and Express for merchant settlement using "
        "PostgreSQL, Redis, Docker, Kubernetes and Kafka, cutting the payout "
        "reconciliation window from two days to four hours.",
        "Worked on PostgreSQL, Redis and Kafka pipelines, reducing cost by 45%.",
        "Responsible for Node.js, Express, Docker and Kubernetes services, reducing "
        "cost by 45%.",
        "Leveraged REST, RESTful and Kafka best practices as a proven track record "
        "team player.",
    ],
)

HONEST = D4_GOOD

LADDER = [
    ("D1 irrelevant filler", D1_IRRELEVANT),
    ("D2 weak duties", D2_WEAK),
    ("D3 duty statements", D3_DUTIES),
    ("D4 good outcomes", D4_GOOD),
    ("D5 strong mechanisms", D5_STRONG),
]


# --------------------------------------------------------------------------- #
# Dynamic range                                                                #
# --------------------------------------------------------------------------- #


def test_dynamic_range_spreads(job, facts, capsys):
    scores = []
    with capsys.disabled():
        print("\n  v2 dynamic range")
        print(f"  {'document':<24}{'overall':>9}{'kw':>7}{'req':>7}{'evid':>7}{'spec':>7}{'pen':>7}")
        for name, doc in LADDER:
            b = v2.compute_breakdown(job, facts, doc)
            scores.append(b.overall)
            print(
                f"  {name:<24}{b.overall:>9.1f}{b.keyword_coverage:>7.0f}"
                f"{b.requirement_coverage:>7.0f}{b.evidence_density:>7.0f}"
                f"{b.specificity:>7.0f}{-b.penalty.total:>7.1f}"
            )

    assert scores == sorted(scores), f"ladder is not monotonic: {scores}"
    assert scores[0] < 45, f"weakest document scored {scores[0]}, expected under 45"
    assert scores[-1] > 80, f"strongest document scored {scores[-1]}, expected over 80"
    assert scores[-1] - scores[0] > 40, "dynamic range is still compressed"


def test_no_free_points_floor(job, facts):
    """Zero keyword matches must cap the score, however well written the prose.

    This is the v1 flaw stated as a test: v1 handed out 15 points for having
    sections and up to 15 for years of service before it looked at a single
    word of the document.
    """
    well_written_but_irrelevant = make_doc(
        summary="Pastry chef leading a brigade across two service periods.",
        skills=["Lamination", "Viennoiserie"],
        bullets=[
            "Rebuilt the morning bake schedule around proving times, cutting waste by 30%.",
            "Trained four commis on lamination so that the croissant line ran without me.",
            "Renegotiated the flour contract, reducing unit cost by 12%.",
        ],
    )
    b = v2.compute_breakdown(job, facts, well_written_but_irrelevant)
    assert b.keyword_coverage == 0.0
    assert b.overall < 35, f"scored {b.overall} with zero keyword matches"

    # And v1, for contrast, hands the same document a large floor for free.
    v1_report = v1.compute_ats_report(job, facts, well_written_but_irrelevant)
    assert v1_report.sub_scores.section_completeness == 100.0


# --------------------------------------------------------------------------- #
# Anti-stuffing — the critical test                                            #
# --------------------------------------------------------------------------- #


def test_stuffed_scores_below_honest(job, facts, capsys):
    """The test this scorer exists to pass.

    The stuffed variant is what best-of-N against v1 converges on: every job
    description term crammed into the skills list, then repeated across the
    bullets. It covers strictly more keywords than the honest document and it
    is strictly worse to read.
    """
    honest, stuffed = HONEST, STUFFED

    honest_b = v2.compute_breakdown(job, facts, honest)
    stuffed_b = v2.compute_breakdown(job, facts, stuffed)

    with capsys.disabled():
        print("\n  anti-stuffing")
        print(f"    honest  overall {honest_b.overall:>5.1f}  kw {honest_b.keyword_coverage:>5.1f}"
              f"  evid {honest_b.evidence_density:>5.1f}  spec {honest_b.specificity:>5.1f}"
              f"  penalty {honest_b.penalty.total:>4.1f}")
        print(f"    stuffed overall {stuffed_b.overall:>5.1f}  kw {stuffed_b.keyword_coverage:>5.1f}"
              f"  evid {stuffed_b.evidence_density:>5.1f}  spec {stuffed_b.specificity:>5.1f}"
              f"  penalty {stuffed_b.penalty.total:>4.1f}")

    # The stuffing genuinely does raise raw keyword coverage. It must still lose.
    assert stuffed_b.keyword_coverage >= honest_b.keyword_coverage
    assert stuffed_b.penalty.total > honest_b.penalty.total
    assert stuffed_b.overall < honest_b.overall, (
        f"stuffed {stuffed_b.overall} >= honest {honest_b.overall}; the scorer is gameable"
    )

    # v1, by contrast, rewards the stuffing. Recorded, not asserted as a gate,
    # because v1 is another agent's file and may move.
    v1_honest = v1.compute_ats_report(job, facts, honest).overall
    v1_stuffed = v1.compute_ats_report(job, facts, stuffed).overall
    with capsys.disabled():
        print(f"    (v1 for contrast: honest {v1_honest:.1f} vs stuffed {v1_stuffed:.1f})")


# --------------------------------------------------------------------------- #
# Saturation                                                                   #
# --------------------------------------------------------------------------- #


def test_keyword_coverage_saturates(job, facts):
    once = make_doc(
        summary="Backend engineer working on PostgreSQL.",
        skills=["Node.js"],
        bullets=["Tuned a slow report query, cutting it from 90 seconds to three."],
    )
    five_times = make_doc(
        summary="PostgreSQL engineer. PostgreSQL, PostgreSQL.",
        skills=["Node.js", "PostgreSQL"],
        bullets=["Tuned a slow PostgreSQL report query, cutting it from 90 seconds to three."],
    )

    a = v2.compute_breakdown(job, facts, once)
    b = v2.compute_breakdown(job, facts, five_times)

    assert b.keyword_counts["PostgreSQL"] >= 5
    assert a.keyword_counts["PostgreSQL"] == 1
    assert a.keyword_coverage == b.keyword_coverage, "further mentions bought coverage"
    # And the repetition is actively worse overall, via the stuffing penalty.
    assert b.overall < a.overall


# --------------------------------------------------------------------------- #
# Evidence density                                                             #
# --------------------------------------------------------------------------- #


def test_duties_score_below_outcomes_with_identical_keywords(job, facts):
    keywords = "Node.js, Express, PostgreSQL, Redis, Docker"
    duties = make_doc(
        summary=f"Backend engineer. {keywords}. REST and Kubernetes and Kafka.",
        skills=["Node.js", "Express", "PostgreSQL", "Redis", "Docker"],
        bullets=[
            "Developed REST endpoints for the settlement service.",
            "Maintained the PostgreSQL schema for the ledger.",
            "Configured the Docker build for the service.",
        ],
    )
    outcomes = make_doc(
        summary=f"Backend engineer. {keywords}. REST and Kubernetes and Kafka.",
        skills=["Node.js", "Express", "PostgreSQL", "Redis", "Docker"],
        bullets=[
            "Developed REST endpoints for the settlement service, cutting the manual "
            "reconciliation step entirely.",
            "Maintained the PostgreSQL schema for the ledger, adding an index that took the "
            "nightly job from 40 minutes to 6.",
            "Configured the Docker build so that a release no longer needed a host setup step.",
        ],
    )

    d = v2.compute_breakdown(job, facts, duties)
    o = v2.compute_breakdown(job, facts, outcomes)

    assert d.keyword_coverage == o.keyword_coverage, "the comparison is not controlled"
    assert d.evidence_density < o.evidence_density
    assert d.overall < o.overall


def test_qualitative_outcome_counts_as_evidence(job, facts):
    """A bullet with no number but a real consequence is not zero-evidence.

    The tailoring prompt explicitly tells the model to state a qualitative
    outcome when the source resume carries no figure. Scoring figures only would
    punish the model for obeying, and push it towards inventing metrics.
    """
    qualitative = make_doc(
        summary="Backend engineer on Node.js services.",
        skills=["Node.js"],
        bullets=[
            "Replaced the nightly export with a webhook so that finance stopped chasing "
            "yesterday's numbers.",
            "Introduced idempotency keys on the payout endpoint, eliminating the duplicate "
            "transfers that retries used to cause.",
        ],
    )
    assert v2.score_evidence_density(qualitative) == 100.0

    numeric = make_doc(
        summary="Backend engineer on Node.js services.",
        skills=["Node.js"],
        bullets=[
            "Cut the nightly export from 40 minutes to 6.",
            "Reduced duplicate transfers by 98%.",
        ],
    )
    assert v2.score_evidence_density(numeric) == v2.score_evidence_density(qualitative)


# --------------------------------------------------------------------------- #
# Specificity, penalties, warnings                                             #
# --------------------------------------------------------------------------- #


def test_specificity_rewards_mechanism_and_ignores_ceremony():
    mechanism = make_doc(
        summary="",
        skills=[],
        bullets=[
            "Added a composite index on the ledger table, cutting the report query in half.",
            "Moved payouts onto a queue with exponential backoff retries.",
        ],
    )
    ceremony = make_doc(
        summary="",
        skills=[],
        bullets=[
            "Helped add a composite index on the ledger table.",
            "Worked on the payout queue with the platform team.",
        ],
    )
    assert v2.score_specificity(mechanism) == 100.0
    # Same mechanisms named, but the openers claim proximity rather than work.
    assert v2.score_specificity(ceremony) == 0.0


def test_repeated_figure_is_penalised(job, facts):
    distinct = make_doc(
        summary="Backend engineer on Node.js and PostgreSQL.",
        skills=["Node.js", "PostgreSQL"],
        bullets=[
            "Cut the report query by 45%.",
            "Reduced the payout backlog by 62%.",
        ],
    )
    borrowed = make_doc(
        summary="Backend engineer on Node.js and PostgreSQL.",
        skills=["Node.js", "PostgreSQL"],
        bullets=[
            "Cut the report query by 45%.",
            "Reduced the payout backlog by 45%.",
        ],
    )
    a = v2.compute_breakdown(job, facts, distinct)
    b = v2.compute_breakdown(job, facts, borrowed)
    assert a.penalty.repeated_figures == 0.0
    assert b.penalty.repeated_figures > 0.0
    assert b.overall < a.overall


def test_penalties_are_bounded(job, facts):
    worst = make_doc(
        summary=(
            "Highly motivated team player and fast learner with a proven track record, "
            "passionate about Node.js Node.js Node.js PostgreSQL PostgreSQL PostgreSQL "
            "Redis Redis Redis REST REST REST Docker Docker Docker Kafka Kafka Kafka "
            "Kubernetes Kubernetes Kubernetes Express Express Express."
        ),
        skills=["Node.js", "PostgreSQL", "Redis", "REST", "Docker", "Kafka", "Kubernetes"],
        bullets=[
            "Helped with Node.js work, reducing cost by 45%.",
            "Worked on PostgreSQL work, reducing cost by 45%.",
            "Assisted with Redis work, reducing cost by 45%.",
            "Participated in Docker work, reducing cost by 45%.",
        ],
    )
    b = v2.compute_breakdown(job, facts, worst)
    assert b.penalty.total <= v2.PENALTIES["total_cap"]
    assert b.penalty.stuffing <= v2.PENALTIES["stuffing_cap"]
    assert b.penalty.repeated_figures <= v2.PENALTIES["repeated_figure_cap"]
    assert b.penalty.filler <= v2.PENALTIES["filler_cap"]
    assert 0.0 <= b.overall <= 100.0


def test_section_warnings_are_a_checklist_not_a_score(tailored):
    assert v2.section_warnings(tailored) == []

    stripped = tailored.model_copy(deep=True)
    stripped.education = []
    stripped.skills = []
    warnings = v2.section_warnings(stripped)
    assert any("education" in w.lower() for w in warnings)
    assert any("skills" in w.lower() for w in warnings)
    # And none of it moves the number.
    assert "section_completeness" not in v2.WEIGHTS
    assert set(v2.WEIGHTS) == {
        "keyword_coverage",
        "requirement_coverage",
        "evidence_density",
        "specificity",
        "experience_match",
    }
    assert abs(sum(v2.WEIGHTS.values()) - 1.0) < 1e-9


def test_recoverable_keywords_survive_from_v1(job, facts):
    """A term the tailored doc dropped but the original resume carries."""
    dropped = make_doc(
        summary="Backend engineer building REST APIs on Node.js and Express.",
        skills=["Node.js", "Express"],
        bullets=["Shipped the settlement API, cutting the manual reconciliation step."],
    )
    report = v2.compute_ats_report(job, facts, dropped)
    # facts carries PostgreSQL and Redis in its skills group; the tailored doc does not.
    assert "PostgreSQL" in report.recoverable_keywords
    assert "Redis" in report.recoverable_keywords
    # Kafka is in neither, so it is a genuine gap rather than an editing task.
    assert "Kafka" in report.missing_keywords


# --------------------------------------------------------------------------- #
# Determinism and drop-in shape                                                #
# --------------------------------------------------------------------------- #


def test_deterministic(job, facts, tailored):
    reports = [v2.compute_ats_report(job, facts, tailored).model_dump() for _ in range(10)]
    assert all(r == reports[0] for r in reports)


def test_drop_in_shape_matches_v1(job, facts, tailored):
    a = v1.compute_ats_report(job, facts, tailored)
    b = v2.compute_ats_report(job, facts, tailored)
    assert type(a) is type(b)
    assert a.model_dump().keys() == b.model_dump().keys()
    assert a.sub_scores.model_dump().keys() == b.sub_scores.model_dump().keys()
    assert b.recommendations, "the breakdown line must always be present"
    assert b.recommendations[0].startswith("Breakdown")


# --------------------------------------------------------------------------- #
# Regression harness — observation, not a gate                                 #
# --------------------------------------------------------------------------- #


def test_v1_v2_comparison(job, facts, tailored, capsys):
    """Run both scorers over the same documents and print the comparison.

    This asserts only that both complete. It exists so that a change to either
    scorer shows up as a visible movement in the table rather than silently.
    """
    documents = [("conftest tailored", tailored), *LADDER]

    with capsys.disabled():
        print("\n  v1 vs v2")
        print(f"  {'document':<24}{'v1':>8}{'v2':>8}{'delta':>8}   v2 breakdown")
        for name, doc in documents:
            r1 = v1.compute_ats_report(job, facts, doc)
            b2 = v2.compute_breakdown(job, facts, doc)
            print(
                f"  {name:<24}{r1.overall:>8.1f}{b2.overall:>8.1f}"
                f"{b2.overall - r1.overall:>8.1f}   "
                f"kw {b2.keyword_coverage:.0f} / req {b2.requirement_coverage:.0f} / "
                f"evid {b2.evidence_density:.0f} / spec {b2.specificity:.0f} / "
                f"exp {b2.experience_match:.0f} / gate {b2.quality_gate:.2f} / "
                f"pen -{b2.penalty.total:.1f}"
            )
            assert 0.0 <= r1.overall <= 100.0
            assert 0.0 <= b2.overall <= 100.0
