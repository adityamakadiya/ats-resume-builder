"""Structural scorers for the eval harness.

Every one of these is deterministic and free. That is deliberate: a judge model
grading a writer model is two unmeasured things in a trenchcoat, and it cannot
tell you whether a prompt change helped without costing money to ask.

What they measure is the tailoring prompt's own contract. The prompt says never
return a bullet unchanged, never repeat an opening verb, never use a banned
opener, never emit an em dash, keep every populated section. Each of those is a
claim, and a claim nobody checks is a wish.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from atsresume.models import ResumeFacts, TailoredResume
from atsresume.pipeline.scoring import _contains, resume_text_of
from atsresume.truth.vocabulary import normalise

BANNED_OPENERS = {
    "helped", "assisted", "participated", "worked", "responsible",
    "spearheaded", "leveraged", "utilised", "utilized",
}


@dataclass
class Finding:
    scorer: str
    passed: bool
    value: float
    detail: str = ""


@dataclass
class CaseResult:
    case: str
    findings: list[Finding] = field(default_factory=list)
    ats_score: float = 0.0
    guard_passed: bool = False
    expect_guard_pass: bool = True
    repair_attempted: bool = False
    seconds: float = 0.0
    cost_usd: float = 0.0
    # Why the first draft was rejected. The repair round is the single most
    # expensive thing the pipeline does, so a run that reports "repaired" without
    # saying what for is not diagnostic.
    first_draft_violations: list[str] = field(default_factory=list)

    @property
    def failures(self) -> list[Finding]:
        return [f for f in self.findings if not f.passed]

    @property
    def as_expected(self) -> bool:
        """A guard failure on a hopeless pairing is the product working.

        Judging every case by "did the guard pass" measured the candidate rather
        than the system: a backend resume cannot honestly satisfy a
        computer-vision posting, so the model reaches and the guard stops it.
        What matters is whether the outcome changed.
        """
        return not self.failures and self.guard_passed == self.expect_guard_pass


def _bullets(tailored: TailoredResume) -> list[str]:
    out = [b.text for e in tailored.experience for b in e.bullets]
    out += [b.text for p in tailored.projects for b in p.bullets]
    out += [b.text for s in tailored.other_sections for b in s.bullets]
    return [b for b in out if b.strip()]


def _first_word(text: str) -> str:
    match = re.match(r"[A-Za-z']+", text.strip())
    return match.group(0).lower() if match else ""


# --------------------------------------------------------------------------- #
# Fidelity: did the rewrite keep what the candidate actually has?              #
# --------------------------------------------------------------------------- #


def sections_preserved(facts: ResumeFacts, tailored: TailoredResume) -> Finding:
    """A populated section must not vanish. Dropping one silently removes a
    qualification the candidate spent years earning."""
    lost = []
    if facts.experience and not tailored.experience:
        lost.append("experience")
    if facts.education and not tailored.education:
        lost.append("education")
    if facts.skills and not tailored.skills:
        lost.append("skills")
    if facts.projects and not tailored.projects:
        lost.append("projects")
    return Finding("sections_preserved", not lost, 0.0 if lost else 1.0, ", ".join(lost))


def employers_unchanged(facts: ResumeFacts, tailored: TailoredResume) -> Finding:
    """Company names in the rewrite must be a subset of the originals."""
    originals = {normalise(e.company) for e in facts.experience}
    invented = [e.company for e in tailored.experience if normalise(e.company) not in originals]
    return Finding("employers_unchanged", not invented, 0.0 if invented else 1.0, ", ".join(invented))


def contact_unchanged(facts: ResumeFacts, tailored: TailoredResume, original: ResumeFacts) -> Finding:
    """The renderer takes contact details from facts, so this catches the
    pipeline mutating them rather than the model."""
    same = facts.contact == original.contact
    return Finding("contact_unchanged", same, 1.0 if same else 0.0)


# --------------------------------------------------------------------------- #
# Craft: does it obey the writing standard the prompt sets?                    #
# --------------------------------------------------------------------------- #


def bullets_were_rewritten(facts: ResumeFacts, tailored: TailoredResume) -> Finding:
    """The prompt says returning a bullet unchanged is a failure, not a safe
    choice. Without this, a model can score well by copying."""
    originals = {normalise(b.text) for e in facts.experience for b in e.bullets}
    originals |= {normalise(b.text) for p in facts.projects for b in p.bullets}
    bullets = _bullets(tailored)
    if not bullets:
        return Finding("bullets_were_rewritten", False, 0.0, "no bullets")
    verbatim = [b for b in bullets if normalise(b) in originals]
    ratio = 1 - len(verbatim) / len(bullets)
    return Finding(
        "bullets_were_rewritten",
        not verbatim,
        ratio,
        f"{len(verbatim)}/{len(bullets)} copied verbatim",
    )


def no_repeated_openers(tailored: TailoredResume) -> Finding:
    """No two bullets in the same role may open with the same verb."""
    offenders: list[str] = []
    for exp in tailored.experience:
        seen: set[str] = set()
        for bullet in exp.bullets:
            word = _first_word(bullet.text)
            if word and word in seen:
                offenders.append(f"{exp.company}:{word}")
            seen.add(word)
    return Finding("no_repeated_openers", not offenders, 0.0 if offenders else 1.0, ", ".join(offenders))


def no_banned_openers(tailored: TailoredResume) -> Finding:
    offenders = [b for b in _bullets(tailored) if _first_word(b) in BANNED_OPENERS]
    return Finding(
        "no_banned_openers",
        not offenders,
        0.0 if offenders else 1.0,
        "; ".join(b[:40] for b in offenders[:3]),
    )


def ascii_only(tailored: TailoredResume) -> Finding:
    """An em dash is the clearest signal a document was machine-drafted, and
    non-ASCII punctuation makes literal keyword matching unreliable."""
    from atsresume.pipeline.sanitize import contains_tells

    offenders = contains_tells(tailored)
    return Finding(
        "ascii_only",
        not offenders,
        0.0 if offenders else 1.0,
        "; ".join(o[:40] for o in offenders[:3]),
    )


def summary_present(tailored: TailoredResume) -> Finding:
    """A recruiter reads the headline and summary first. An empty one wastes
    the only part of the page that is certain to be read."""
    words = len(tailored.summary.text.split())
    ok = 15 <= words <= 120
    return Finding("summary_present", ok, float(words), f"{words} words")


# --------------------------------------------------------------------------- #
# Match: does it actually carry the posting's language?                        #
# --------------------------------------------------------------------------- #


def keyword_coverage(tailored: TailoredResume, keywords: list[str]) -> Finding:
    """Reported, never failed.

    The first eval run failed this on two of three cases, and both were correct
    outputs: a backend resume against a computer-vision posting genuinely
    matches no keywords, and inventing some to pass would be the exact failure
    this project exists to prevent. A scorer must measure the system, not the
    candidate. Low coverage on a poor match is the system working.
    """
    if not keywords:
        return Finding("keyword_coverage", True, 1.0, "no keywords")
    text = resume_text_of(tailored)
    hits = sum(1 for k in keywords if _contains(k, text))
    return Finding("keyword_coverage", True, hits / len(keywords), f"{hits}/{len(keywords)}")


def surfaced_twice(tailored: TailoredResume, keywords: list[str]) -> Finding:
    """The prompt asks for a term the candidate has to appear in skills and in
    context, because a parser weights a term in a sentence above one in a list.
    Reported rather than enforced: how often it manages this is the signal."""
    skills_text = normalise(" ".join(i for g in tailored.skills for i in g.items))
    body = normalise(
        " ".join([tailored.summary.text, *(b for b in _bullets(tailored))])
    )
    both = [k for k in keywords if _contains(k, skills_text) and _contains(k, body)]
    present = [k for k in keywords if _contains(k, resume_text_of(tailored))]
    ratio = len(both) / len(present) if present else 0.0
    return Finding("surfaced_twice", True, ratio, f"{len(both)}/{len(present)} of matched terms")


ALL_SCORERS = (
    "sections_preserved",
    "employers_unchanged",
    "bullets_were_rewritten",
    "no_repeated_openers",
    "no_banned_openers",
    "ascii_only",
    "summary_present",
    "keyword_coverage",
    "surfaced_twice",
)


def score_all(
    facts: ResumeFacts, tailored: TailoredResume, keywords: list[str]
) -> list[Finding]:
    return [
        sections_preserved(facts, tailored),
        employers_unchanged(facts, tailored),
        bullets_were_rewritten(facts, tailored),
        no_repeated_openers(tailored),
        no_banned_openers(tailored),
        ascii_only(tailored),
        summary_present(tailored),
        keyword_coverage(tailored, keywords),
        surfaced_twice(tailored, keywords),
    ]
