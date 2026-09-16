"""The truth guard.

Any model asked to optimise a resume for a job description will drift into
adding the keywords the description asks for. That is what gets a candidate
caught in an interview, and asking the model nicely not to do it is not a
control. So truthfulness is enforced here, after generation, deterministically.

Every rewritten line cites the ids of the resume facts it derives from, and each
citation is checked against the original text. Four things get caught:

    UNSOURCED_LINE        a line with no traceable origin
    UNKNOWN_SOURCE_ID     a citation to a fact that does not exist
    UNSOURCED_METRIC      a figure that was not in the uploaded resume
    UNSOURCED_TECH        a technology the candidate never claimed
    ALTERED_EMPLOYER_FACT a changed company, title, or employment date

The last one matters most in practice: employment details are the first thing a
recruiter verifies, and a promoted title is the fastest way to lose an offer.
"""

from __future__ import annotations

import re

from ..models import (
    ResumeFacts,
    TailoredResume,
    TruthReport,
    TruthViolation,
    ViolationCode,
)
from .vocabulary import build_vocabulary, normalise, terms_present

# Percentages, multipliers, durations, throughput, money, and any bare number of
# two digits or more. Single bare digits are skipped on purpose: "3 microservices"
# is usually a restatement, and flagging it buries the real findings in noise.
_METRIC = re.compile(
    r"""
    (?:\d[\d,.]*\s?
       (?:%|percent|x\b|ms\b|s\b|sec\b|seconds\b|min\b|minutes\b|hours?\b|days?\b
         |weeks?\b|months?\b|years?\b|k\b|m\b|b\b|mb\b|gb\b|tb\b|rps\b|qps\b|tps\b
         |req/s|users?\b|customers?\b|clients?\b))
  | (?:[$₹€£]\s?\d[\d,.]*)
  | (?:\b\d{2,}\b)
    """,
    re.IGNORECASE | re.VERBOSE,
)

_DIGITS = re.compile(r"[^0-9]")


def _metrics(text: str) -> list[str]:
    return [m.group(0).strip().lower() for m in _METRIC.finditer(text)]


def _digits_of(value: str) -> str:
    return _DIGITS.sub("", value)


def build_fact_index(facts: ResumeFacts) -> dict[str, str]:
    """Every citable fact, by id."""
    index: dict[str, str] = {}
    if facts.summary:
        index["SUMMARY"] = facts.summary
    if facts.headline:
        index["HEADLINE"] = facts.headline

    for exp in facts.experience:
        index[exp.id] = " ".join(
            [exp.company, exp.title, exp.location, exp.start_date, exp.end_date, *exp.tech]
        )
        for bullet in exp.bullets:
            index[bullet.id] = bullet.text
    for proj in facts.projects:
        index[proj.id] = " ".join([proj.name, proj.description, *proj.tech])
        for bullet in proj.bullets:
            index[bullet.id] = bullet.text
    for edu in facts.education:
        index[edu.id] = " ".join([edu.institution, edu.degree, edu.dates, edu.details])
    for group in facts.skills:
        index[group.id] = " ".join([group.category, *group.items])
    for cert in facts.certifications:
        index[cert.id] = cert.text
    for section in facts.other_sections:
        index[section.id] = section.heading
        for bullet in section.bullets:
            index[bullet.id] = bullet.text
    return index


def run_truth_guard(
    tailored: TailoredResume,
    facts: ResumeFacts,
    raw_resume_text: str,
    jd_terms: list[str] | None = None,
) -> TruthReport:
    violations: list[TruthViolation] = []
    index = build_fact_index(facts)
    vocabulary = build_vocabulary(jd_terms)

    corpus = normalise(" \n ".join(index.values()) + " \n " + raw_resume_text)
    corpus_tech = terms_present(corpus, vocabulary)
    corpus_digits = {d for d in (_digits_of(m) for m in _metrics(corpus)) if d}

    def check_line(location: str, text: str, source_ids: list[str]) -> None:
        if not text.strip():
            return

        if not source_ids:
            violations.append(
                TruthViolation(
                    code=ViolationCode.UNSOURCED_LINE,
                    location=location,
                    detail="Rewritten line cites no source in the uploaded resume.",
                    offending=text,
                )
            )

        for source_id in source_ids:
            if source_id not in index:
                violations.append(
                    TruthViolation(
                        code=ViolationCode.UNKNOWN_SOURCE_ID,
                        location=location,
                        detail=f"Cites '{source_id}', which is not an extracted resume fact.",
                        offending=text,
                    )
                )

        source_text = " ".join(index[s] for s in source_ids if s in index)
        source_digits = {d for d in (_digits_of(m) for m in _metrics(source_text)) if d}

        for metric in _metrics(text):
            digits = _digits_of(metric)
            if digits and digits not in source_digits and digits not in corpus_digits:
                violations.append(
                    TruthViolation(
                        code=ViolationCode.UNSOURCED_METRIC,
                        location=location,
                        detail=f"The figure '{metric}' does not appear anywhere in the uploaded resume.",
                        offending=text,
                    )
                )

        for tech in terms_present(text, vocabulary):
            if tech not in corpus_tech:
                violations.append(
                    TruthViolation(
                        code=ViolationCode.UNSOURCED_TECH,
                        location=location,
                        detail=(
                            f"'{tech}' is presented as the candidate's experience but is absent "
                            "from the uploaded resume."
                        ),
                        offending=text,
                    )
                )

    # A headline speaks for the candidate's current level and claimed stack, so
    # it may draw on the most recent role and the skills section — not on every
    # role ever held, which would let it borrow a technology from years ago and
    # call it a specialisation.
    headline_sources = ["HEADLINE"]
    if facts.experience:
        headline_sources.append(facts.experience[0].id)
    headline_sources.extend(group.id for group in facts.skills)
    check_line("Headline", tailored.headline, [s for s in headline_sources if s in index])

    for location, text, source_ids in tailored.all_lines():
        check_line(location, text, source_ids)

    # Verifiable employment details must survive the rewrite untouched.
    by_id = {exp.id: exp for exp in facts.experience}
    for block in tailored.experience:
        fact = by_id.get(block.source_id)
        if fact is None:
            violations.append(
                TruthViolation(
                    code=ViolationCode.UNKNOWN_SOURCE_ID,
                    location=f"Experience / {block.company}",
                    detail=f"Cites '{block.source_id}', which is not an extracted role.",
                    offending=f"{block.title} at {block.company}",
                )
            )
            continue

        drift: list[str] = []
        for label, was, now in (
            ("company", fact.company, block.company),
            ("title", fact.title, block.title),
            ("start", fact.start_date, block.start_date),
            ("end", fact.end_date, block.end_date),
        ):
            if normalise(was) != normalise(now):
                drift.append(f"{label} '{was}' -> '{now}'")
        if drift:
            violations.append(
                TruthViolation(
                    code=ViolationCode.ALTERED_EMPLOYER_FACT,
                    location=f"Experience / {fact.company}",
                    detail="Verifiable employment details were changed: " + "; ".join(drift) + ".",
                    offending="; ".join(drift),
                )
            )

    errors = sum(1 for v in violations if v.severity == "error")
    return TruthReport(
        passed=errors == 0,
        error_count=errors,
        warning_count=len(violations) - errors,
        violations=violations,
    )
