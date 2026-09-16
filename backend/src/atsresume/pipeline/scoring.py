"""The ATS score, computed in code.

A score the model invents drifts between runs, cannot be regression-tested, and
cannot be explained to the candidate when it moves from 70 to 74. This one is
reproducible, and every point is traceable to a specific term.

The shape follows Resume-Matcher's weighted composite, with four changes that
matter:

* keywords count for what the job description said they are worth, not equally
* a required skill outweighs a preferred one
* declared synonyms count as matches, so "Postgres" satisfies "PostgreSQL"
* years of experience is scored, which nobody else does and every recruiter does

It is an expert estimate of how a keyword-and-parse screen plus a recruiter's
first pass will treat the resume. It is not a reading from a commercial ATS and
nothing here claims to be one.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..models import (
    AtsReport,
    Importance,
    JobSpec,
    ResumeFacts,
    SubScores,
    TailoredResume,
)
from ..truth.vocabulary import canonical, normalise

WEIGHTS = {
    "keyword_match": 0.45,
    "skills_coverage": 0.25,
    "section_completeness": 0.15,
    "experience_match": 0.15,
}

SECTION_MARKERS = {
    "summary": ("summary", "objective", "profile", "about"),
    "experience": ("experience", "work history", "employment"),
    "education": ("education", "academic", "degree"),
    "skills": ("skills", "technologies", "competencies", "technical"),
}


def _contains(term: str, haystack: str) -> bool:
    """Whole-word containment.

    Substring matching is the classic bug here: without boundaries "R" matches
    "React", "Go" matches "Google", and "C" matches almost everything, which
    inflates the score exactly where it should be strict.
    """
    needle = normalise(term)
    if not needle:
        return False
    return re.search(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", haystack) is not None


# Words that carry no matching signal in a requirement phrase.
_STOPWORDS = frozenset(
    {
        "and", "or", "the", "a", "an", "of", "for", "with", "in", "on", "to", "by",
        "using", "used", "strong", "solid", "hands", "experience", "knowledge",
        "working", "good", "excellent", "proven", "including", "such", "as", "etc",
        "ability", "understanding", "familiarity", "exposure", "plus", "must", "have",
    }
)


_SUFFIXES = ("ations", "ation", "ingly", "ings", "ing", "ies", "ied", "ed", "es", "s")


def _stem(word: str) -> str:
    """Crude suffix stripping, enough to tie 'indexes' to 'indexing'.

    A real stemmer would be more accurate and would mean carrying NLTK for one
    function. The failure mode of getting this slightly wrong is a requirement
    scored a little generously, which is bounded; the failure mode of no
    stemming at all was measured, and it was skills coverage reading 28 while
    keyword coverage read 79 on the same resume.
    """
    for suffix in _SUFFIXES:
        if len(word) - len(suffix) >= 4 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


# A phrase is covered when most of its content words are, not all of them. A
# posting saying "PostgreSQL query optimization and indexing" is satisfied by a
# resume that wrote queries and added indexes without using the word
# "optimization", and a recruiter would agree.
_COVERAGE_THRESHOLD = 2 / 3


def _covers(term: str, haystack: str) -> bool:
    """Whether the resume covers a requirement, which is often a whole sentence.

    Single-word requirements keep the strict whole-word rule — that is where
    substring matching does real damage. Multi-word requirements are scored on
    how much of their content they find, because matching a sentence verbatim
    essentially never succeeds.
    """
    if _contains(term, haystack):
        return True

    tokens = [t for t in normalise(term).split() if len(t) > 2 and t not in _STOPWORDS]
    if len(tokens) < 2:
        return False

    # Canonicalise both sides through the same alias map the truth guard uses,
    # so "RESTful" and "REST" are one term here as they are everywhere else.
    hay_stems = {_stem(canonical(word)) for word in haystack.split()}
    hits = sum(
        1
        for token in tokens
        if _stem(canonical(token)) in hay_stems or _contains(token, haystack)
    )
    return hits / len(tokens) >= _COVERAGE_THRESHOLD


def resume_text_of(tailored: TailoredResume) -> str:
    parts = [tailored.headline, tailored.summary.text]
    for group in tailored.skills:
        parts.append(group.category)
        parts.extend(group.items)
    for exp in tailored.experience:
        parts.extend([exp.title, exp.company, exp.location])
        parts.extend(b.text for b in exp.bullets)
    for proj in tailored.projects:
        parts.append(proj.name)
        parts.extend(b.text for b in proj.bullets)
    for edu in tailored.education:
        parts.extend([edu.degree, edu.institution])
    parts.extend(c.text for c in tailored.certifications)
    for section in tailored.other_sections:
        parts.append(section.heading)
        parts.extend(b.text for b in section.bullets)
    return normalise(" \n ".join(p for p in parts if p))


def facts_text_of(facts: ResumeFacts) -> str:
    parts = [facts.headline, facts.summary]
    for exp in facts.experience:
        parts.extend([exp.company, exp.title, *exp.tech])
        parts.extend(b.text for b in exp.bullets)
    for proj in facts.projects:
        parts.extend([proj.name, proj.description, *proj.tech])
        parts.extend(b.text for b in proj.bullets)
    for group in facts.skills:
        parts.append(group.category)
        parts.extend(group.items)
    for edu in facts.education:
        parts.extend([edu.institution, edu.degree, edu.details])
    parts.extend(c.text for c in facts.certifications)
    for section in facts.other_sections:
        parts.append(section.heading)
        parts.extend(b.text for b in section.bullets)
    return normalise(" \n ".join(p for p in parts if p))


@dataclass
class KeywordOutcome:
    matched: list[str]
    missing: list[str]
    score: float


def score_keywords(job: JobSpec, resume: str) -> KeywordOutcome:
    """Weighted keyword coverage. A declared variant counts as the term itself."""
    if not job.keywords:
        return KeywordOutcome(matched=[], missing=[], score=0.0)

    matched: list[str] = []
    missing: list[str] = []
    earned = possible = 0.0

    for keyword in job.keywords:
        weight = max(1.0, min(5.0, float(keyword.weight or 1)))
        possible += weight
        forms = [keyword.term, *keyword.variants]
        if any(_contains(form, resume) for form in forms):
            matched.append(keyword.term)
            earned += weight
        else:
            missing.append(keyword.term)

    return KeywordOutcome(
        matched=matched,
        missing=missing,
        score=(earned / possible * 100) if possible else 0.0,
    )


def score_skills_coverage(job: JobSpec, resume: str) -> float:
    """Required skills count double; a 'nice to have' should not mask a must-have."""
    if not job.requirements:
        return 0.0
    earned = possible = 0.0
    for req in job.requirements:
        weight = 2.0 if req.importance == Importance.REQUIRED else 1.0
        possible += weight
        if _covers(req.term, resume):
            earned += weight
    return (earned / possible * 100) if possible else 0.0


def score_section_completeness(tailored: TailoredResume) -> float:
    present = 0
    if tailored.summary.text.strip():
        present += 1
    if tailored.experience or tailored.projects:
        present += 1
    if tailored.education:
        present += 1
    if tailored.skills:
        present += 1
    return present / len(SECTION_MARKERS) * 100


def score_experience_match(job: JobSpec, facts: ResumeFacts) -> float:
    """How the candidate's years read against the band the JD asked for.

    Under-shooting is penalised in proportion to the shortfall. Over-shooting is
    not penalised to zero — being more senior than advertised is a negotiation
    problem, not a screening failure — but it does cost something, because
    over-qualification genuinely does get filtered.
    """
    wanted_min = job.experience_years.min or 0.0
    years = facts.total_years_experience or 0.0

    if wanted_min <= 0:
        return 75.0  # nothing stated; neutral rather than free marks
    if years <= 0:
        return 50.0  # unknowable from the resume; do not punish a parsing gap

    if years >= wanted_min:
        wanted_max = job.experience_years.max or 0.0
        if wanted_max and years > wanted_max + 3:
            return 80.0
        return 100.0

    shortfall = (wanted_min - years) / wanted_min
    return max(0.0, 100.0 * (1.0 - shortfall))


def compute_ats_report(
    job: JobSpec,
    facts: ResumeFacts,
    tailored: TailoredResume,
) -> AtsReport:
    tailored_text = resume_text_of(tailored)
    original_text = facts_text_of(facts)

    keywords = score_keywords(job, tailored_text)
    skills = score_skills_coverage(job, tailored_text)
    sections = score_section_completeness(tailored)
    experience = score_experience_match(job, facts)

    overall = (
        keywords.score * WEIGHTS["keyword_match"]
        + skills * WEIGHTS["skills_coverage"]
        + sections * WEIGHTS["section_completeness"]
        + experience * WEIGHTS["experience_match"]
    )

    # A keyword the tailored resume dropped but the original resume does carry
    # is the cheapest possible win: it is already true, it is just not on the
    # page any more.
    recoverable = [
        term
        for term in keywords.missing
        if _contains(term, original_text)
        or any(
            _contains(v, original_text)
            for kw in job.keywords
            if kw.term == term
            for v in kw.variants
        )
    ]
    truly_missing = [t for t in keywords.missing if t not in recoverable]

    return AtsReport(
        overall=round(overall, 1),
        sub_scores=SubScores(
            keyword_match=round(keywords.score, 1),
            skills_coverage=round(skills, 1),
            section_completeness=round(sections, 1),
            experience_match=round(experience, 1),
        ),
        matched_keywords=keywords.matched,
        missing_keywords=truly_missing,
        recoverable_keywords=recoverable,
        recommendations=_recommendations(
            keywords.score, skills, sections, experience, truly_missing, recoverable, job, facts
        ),
    )


def _recommendations(
    keyword_score: float,
    skills_score: float,
    section_score: float,
    experience_score: float,
    missing: list[str],
    recoverable: list[str],
    job: JobSpec,
    facts: ResumeFacts,
) -> list[str]:
    out: list[str] = []

    if recoverable:
        out.append(
            "Put these back — your original resume already claims them, the tailored version "
            f"dropped them: {', '.join(recoverable[:6])}."
        )
    if keyword_score < 60 and missing:
        out.append(
            "Keyword coverage is low. These cannot be added truthfully, so treat them as a "
            f"skills gap rather than an editing task: {', '.join(missing[:6])}."
        )
    if skills_score < 60:
        required = [r.term for r in job.requirements if r.importance == Importance.REQUIRED]
        out.append(
            "Several stated must-haves are unmet"
            + (f" ({', '.join(required[:5])})" if required else "")
            + ". A recruiter screens on these first."
        )
    if section_score < 100:
        out.append(
            "A standard section is missing. Parsers segment on Summary, Experience, "
            "Education and Skills headings; an absent one reads as an absent qualification."
        )
    if experience_score < 70:
        wanted = job.experience_years.raw or f"{job.experience_years.min:g}+ years"
        out.append(
            f"The posting asks for {wanted} and the resume shows about "
            f"{facts.total_years_experience:g}. Lead with depth and shipped outcomes rather "
            "than tenure."
        )
    if not out:
        out.append("No mechanical gaps found. The remaining leverage is in the writing.")
    return out
