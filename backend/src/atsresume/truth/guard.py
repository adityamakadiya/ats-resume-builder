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
from .vocabulary import build_vocabulary, implied_by, normalise, terms_present


class _CaseInsensitiveIndex(dict):
    """Fact ids, matched without regard to case."""

    def __setitem__(self, key: str, value: str) -> None:
        super().__setitem__(key.upper(), value)

    def __getitem__(self, key: str) -> str:
        return super().__getitem__(key.upper())

    def __contains__(self, key: object) -> bool:
        return isinstance(key, str) and super().__contains__(key.upper())

    def get(self, key: str, default=None):  # type: ignore[override]
        return super().get(key.upper(), default)

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

# Lines that speak for the document rather than for one achievement, and may
# therefore draw a figure from anywhere in it.
_AGGREGATING_LOCATIONS = ("Summary", "Headline")


def _metrics(text: str) -> list[str]:
    return [m.group(0).strip().lower() for m in _METRIC.finditer(text)]


def _digits_of(value: str) -> str:
    return _DIGITS.sub("", value)


def build_fact_index(facts: ResumeFacts) -> dict[str, str]:
    """Every citable fact, by id.

    Keys are upper-cased on lookup because the model writes "summary" as often
    as "SUMMARY", and rejecting a correct citation over its capitalisation buys
    a repair round for nothing.
    """
    index: _CaseInsensitiveIndex = _CaseInsensitiveIndex()
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
    # Owning a tool is claiming what it does, so the corpus covers the
    # capabilities its technologies imply as well as the names themselves.
    corpus_tech |= implied_by(corpus_tech)
    corpus_digits = {d for d in (_digits_of(m) for m in _metrics(corpus)) if d}

    # Which bullet has already claimed a given figure, so the same number cannot
    # be spread across a page as if it were several achievements.
    claimed_by: dict[str, str] = {}

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

        # A summary speaks for the whole document, so it may restate a figure
        # from any part of it. A bullet speaks only for its own achievement, and
        # must find its figures in the facts it actually cites. Accepting the
        # corpus everywhere was the guard's largest hole: a real 45% earned by
        # one piece of work licensed a fabricated 45% on a different one.
        aggregates = location.startswith(_AGGREGATING_LOCATIONS)
        is_bullet = " / bullet " in location

        for metric in _metrics(text):
            digits = _digits_of(metric)
            if not digits:
                continue

            if digits not in source_digits and not (aggregates and digits in corpus_digits):
                elsewhere = digits in corpus_digits
                violations.append(
                    TruthViolation(
                        code=ViolationCode.UNSOURCED_METRIC,
                        location=location,
                        detail=(
                            f"The figure '{metric}' appears elsewhere in the resume but not in "
                            f"the facts this line cites ({', '.join(source_ids) or 'none'})."
                            if elsewhere
                            else f"The figure '{metric}' does not appear anywhere in the "
                            "uploaded resume."
                        ),
                        offending=text,
                    )
                )
                continue

            # Uniqueness is a rule about bullets competing with one another. A
            # summary restating a bullet's number is how a good resume reads.
            if is_bullet:
                first = claimed_by.get(digits)
                if first is not None and first != location:
                    violations.append(
                        TruthViolation(
                            code=ViolationCode.DUPLICATED_METRIC,
                            location=location,
                            detail=(
                                f"The figure '{metric}' is already claimed at {first}. One "
                                "achievement stretched across two bullets reads as padding."
                            ),
                            offending=text,
                        )
                    )
                else:
                    claimed_by.setdefault(digits, location)

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
    by_id = {exp.id.upper(): exp for exp in facts.experience}
    for block in tailored.experience:
        fact = by_id.get(block.source_id.upper())
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
