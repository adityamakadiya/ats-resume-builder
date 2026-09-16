"""The ATS score.

It is computed rather than asked of the model precisely so it can be tested.
These are the properties that make it worth trusting.
"""

from __future__ import annotations

import copy

from atsresume.models import (
    ExperienceYears,
    Importance,
    JobSpec,
    Keyword,
    Requirement,
    RequirementCategory,
)
from atsresume.pipeline.scoring import (
    compute_ats_report,
    resume_text_of,
    score_experience_match,
    score_keywords,
)


def job(**overrides) -> JobSpec:
    base = {
        "company": "Acme",
        "title": "Backend Engineer",
        "requirements": [
            Requirement(
                term="Node.js",
                category=RequirementCategory.FRAMEWORK,
                importance=Importance.REQUIRED,
                evidence="Strong Node.js",
            ),
            Requirement(
                term="Kafka",
                category=RequirementCategory.TOOLING,
                importance=Importance.PREFERRED,
                evidence="Kafka a bonus",
            ),
        ],
        "keywords": [
            Keyword(term="Node.js", variants=["NodeJS"], weight=5),
            Keyword(term="PostgreSQL", variants=["Postgres"], weight=4),
            Keyword(term="Kafka", variants=[], weight=2),
        ],
        "experience_years": ExperienceYears(min=2, max=4, raw="2-4 years"),
    }
    base.update(overrides)
    return JobSpec(**base)


def test_variants_count_as_matches():
    """"Postgres" on the resume must satisfy a JD asking for "PostgreSQL"."""
    outcome = score_keywords(job(), resume="built services on postgres and nodejs")
    assert "PostgreSQL" in outcome.matched
    assert "Node.js" in outcome.matched


def test_keywords_are_weighted_by_importance():
    """Missing the weight-5 term must cost more than missing the weight-2 one."""
    missing_heavy = score_keywords(job(), resume="postgresql and kafka").score
    missing_light = score_keywords(job(), resume="node.js and postgresql").score
    assert missing_light > missing_heavy


def test_substring_matches_are_rejected():
    """Without word boundaries "Go" matches "Google" and every score inflates."""
    spec = job(keywords=[Keyword(term="Go", variants=[], weight=5)])
    assert score_keywords(spec, resume="worked with google cloud storage").score == 0.0
    assert score_keywords(spec, resume="wrote services in go").score == 100.0


def test_required_outweighs_preferred(tailored, facts):
    from atsresume.pipeline.scoring import score_skills_coverage

    has_required = score_skills_coverage(job(), "we used node.js heavily")
    has_preferred = score_skills_coverage(job(), "we used kafka heavily")
    assert has_required > has_preferred


def test_experience_shortfall_scales_with_the_gap():
    spec = job()
    from atsresume.models import Contact, ResumeFacts

    def at(years: float) -> float:
        facts = ResumeFacts(contact=Contact(name="X"), total_years_experience=years)
        return score_experience_match(spec, facts)

    assert at(2) == 100.0
    assert at(1) == 50.0
    assert at(0.5) < at(1) < at(2)


def test_unstated_years_do_not_punish_a_parsing_gap():
    from atsresume.models import Contact, ResumeFacts

    facts = ResumeFacts(contact=Contact(name="X"), total_years_experience=0)
    assert score_experience_match(job(), facts) == 50.0


def test_score_is_deterministic(tailored, facts):
    a = compute_ats_report(job(), facts, tailored)
    b = compute_ats_report(job(), facts, tailored)
    assert a.overall == b.overall
    assert a.model_dump() == b.model_dump()


def test_recoverable_keywords_are_separated_from_truly_missing(tailored, facts):
    """A term the original resume carries but the rewrite dropped is a free win,
    and must never be reported as a skills gap."""
    # Remove every mention of PostgreSQL from the rewrite while leaving it in
    # the source facts, which is exactly the situation being detected.
    stripped = copy.deepcopy(tailored)
    stripped.skills = []
    stripped.summary.text = "Backend engineer working on merchant settlement."
    stripped.experience[0].bullets[0].text = "Designed REST APIs for merchant settlement."

    report = compute_ats_report(job(), facts, stripped)
    assert "PostgreSQL" in report.recoverable_keywords
    assert "PostgreSQL" not in report.missing_keywords
    # Kafka is in neither resume, so it is a real gap.
    assert "Kafka" in report.missing_keywords


def test_overall_stays_in_range(tailored, facts):
    report = compute_ats_report(job(), facts, tailored)
    assert 0.0 <= report.overall <= 100.0
    for value in report.sub_scores.model_dump().values():
        assert 0.0 <= value <= 100.0


def test_empty_job_does_not_divide_by_zero(tailored, facts):
    spec = JobSpec(company="", title="", requirements=[], keywords=[])
    report = compute_ats_report(spec, facts, tailored)
    assert report.overall >= 0.0


def test_resume_text_includes_other_sections(tailored):
    from atsresume.models import TailoredBullet, TailoredOtherSection

    draft = copy.deepcopy(tailored)
    draft.other_sections = [
        TailoredOtherSection(
            source_id="O1",
            heading="Open Source",
            bullets=[TailoredBullet(text="Maintains a Kafka client library", source_ids=["O1.B1"])],
        )
    ]
    assert "kafka" in resume_text_of(draft)


def test_phrase_requirements_are_matched_by_content_words():
    """A posting writes requirements as sentences. Matching them verbatim never
    succeeds, which drove skills coverage to 28 while keywords sat at 79."""
    from atsresume.pipeline.scoring import _covers

    resume = normalise_for_test(
        "Wrote PostgreSQL queries and added indexes, tuning query performance "
        "for the reconciliation module. Designed REST APIs in Node.js."
    )
    assert _covers("PostgreSQL query optimization and indexing", resume)
    assert _covers("Designing and scaling RESTful APIs", resume)
    # Absent capability still reads as absent.
    assert not _covers("Distributed tracing", resume)
    assert not _covers("Kubernetes orchestration", resume)


def normalise_for_test(text: str) -> str:
    from atsresume.truth.vocabulary import normalise

    return normalise(text)
