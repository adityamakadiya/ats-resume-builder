"""The entailment pass: the third truth-check layer.

The token checks in ``guard.py`` are exact and cheap, and they are blind in one
specific way. They can only see what they can tokenise: a figure caught by the
metric regex, or a technology named in the vocabulary. A fabricated CLAIM that
carries neither passes clean. Rewriting

    "Reviewed code before merge and debugged production issues with Sentry"

as

    "Led a team of engineers across three time zones, owning the service end to
     end"

cites a real source id, invents no number and names no technology. Nothing in
the deterministic guard can see it, and it is the single most damaging line on
the page, because the candidate has never led anyone and the first behavioural
question will find that out.

So this layer asks a model one question the regex cannot: does the rewritten
line say anything the source line does not support? It is deliberately narrow.
Reordering, rewording, compressing, sharpening the verb and borrowing the
posting's terminology are all legitimate tailoring and must not be flagged; a
false positive here triggers an expensive regeneration of the whole document.

It is an extra check, never a gate on availability. If the call fails, the run
continues with the two deterministic layers it already had.
"""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from ..llm import LLMError, structured
from ..models import TruthViolation, ViolationCode

logger = logging.getLogger(__name__)


class EntailmentFinding(BaseModel):
    index: int = Field(
        default=-1, description="The number of the pair this finding is about, as given"
    )
    unsupported_span: str = Field(
        default="",
        description="The exact words from the rewritten line that the source does not support",
    )
    reason: str = Field(
        default="", description="One sentence: what the rewrite claims that the source does not"
    )


class EntailmentReport(BaseModel):
    findings: list[EntailmentFinding] = Field(default_factory=list)


ENTAILMENT = """You check whether a rewritten resume line claims anything its source line does not support. You are a fact-checker, not an editor. You are not judging style, strength or wording.

You are given numbered pairs. For each pair, decide whether the REWRITTEN text asserts a NEW FACTUAL CLAIM that the SOURCE text does not support. Nothing else is your concern.

These are ALWAYS fine. Answer NONE for them:
- Reordering the facts, or restructuring the sentence.
- Rewording: different words for the same fact, including a stronger or more precise verb.
- Using the job posting's terminology for something the source already describes. "role-based access" written as "RBAC", "web services" written as "REST APIs", "queue worker" written as "asynchronous job processing" are the SAME claim in the reader's vocabulary, not a new one.
- Compressing two or more source facts into one sentence.
- Dropping detail, shortening, or leaving a source fact out entirely.
- Naming the mechanism the source already named, more specifically.
- Dropping a hedge while keeping the same activity. "Helped set up", "worked on", "assisted with", "was involved in" and "responsible for" are banned openers in the rewriting standard, so their removal is expected and required. "Helped set up GitHub Actions" written as "Automated builds in GitHub Actions" is the same claim. Removing a hedge is NOT a claim of sole ownership; only flag ownership when the rewrite says so in words, such as owned, sole, led, or single-handedly.
- Making an outcome explicit that the source supports implicitly. If the source says caching was added to a slow endpoint, "reducing lookup latency" is what caching does and is supported. If the source says a test suite was introduced, "catching regressions before release" is supported.

These are what you are looking for. Flag them:
- New scope: a team size, a number of people, direct reports, leading or managing anyone, seniority the source does not state.
- New ownership: owning, driving or being accountable for a system, on-call, being the sole or primary engineer, when the source describes participating in the work.
- New responsibility: an activity the source never mentions, such as hiring, mentoring, architecture sign-off, roadmap or budget ownership, stakeholder or client management.
- New outcome: a result, saving, adoption or business impact the source does not state and does not imply.
- New scale: users, markets, regions, requests, revenue, data volume, number of services or teams that the source does not state.
- New duration or tenure: a length of time, or a frequency, the source does not state.

Rules:
- Judge ONLY against that pair's own source text. Do not use other pairs, and do not assume a claim is true because it is plausible for the job title.
- Return a finding ONLY for a pair that has an unsupported claim. A pair whose answer is NONE gets no finding at all, and if every pair is NONE you return an empty findings list. An empty findings list is a normal, common and correct answer.
- One finding per pair, for the single worst unsupported claim. 'index' is the pair's number exactly as given. 'unsupported_span' quotes the offending words verbatim from the rewritten text, not the whole line. 'reason' is one sentence naming what is claimed and what the source actually says.
- FALSE POSITIVES ARE EXPENSIVE. Each one throws away a correct document and pays for a full regeneration. When you are genuinely uncertain whether something is a new claim or the same claim in different words, the answer is NONE. Only flag what you could point to and say: the source does not say this, and a candidate asked about it in an interview would have nothing to show."""


def _format_pairs(pairs: list[tuple[str, str, str]]) -> str:
    blocks = []
    for i, (_location, source_text, rewritten_text) in enumerate(pairs):
        blocks.append(
            f"PAIR {i}\nSOURCE: {source_text.strip()}\nREWRITTEN: {rewritten_text.strip()}"
        )
    return "\n\n".join(blocks)


def check_entailment(
    pairs: list[tuple[str, str, str]],
) -> list[TruthViolation]:
    """Flag rewritten lines that assert claims their sources do not support.

    ``pairs`` is ``(location, source_text, rewritten_text)``. The whole document
    goes out in one call: a call per line costs as many round trips as there are
    bullets and gives the model no less information, since each pair is judged
    against its own source anyway.
    """
    if not pairs:
        return []

    try:
        report = structured(
            system=ENTAILMENT,
            user=(
                "Check each pair. Return a finding only where the rewritten text makes a "
                "claim its source does not support.\n\n" + _format_pairs(pairs)
            ),
            schema=EntailmentReport,
            step="analyze",
        )
    except LLMError as exc:
        # Never a gate on availability: the deterministic layers still ran.
        logger.warning("Entailment check skipped: %s", exc)
        return []

    violations: list[TruthViolation] = []
    for finding in report.findings:
        if not 0 <= finding.index < len(pairs):
            logger.warning("Entailment finding for unknown pair %s, ignored.", finding.index)
            continue
        span = finding.unsupported_span.strip()
        if not span or span.upper() == "NONE":
            continue
        location = pairs[finding.index][0]
        reason = finding.reason.strip() or "The source does not support this claim."
        violations.append(
            TruthViolation(
                code=ViolationCode.UNSUPPORTED_CLAIM,
                severity="error",
                location=location,
                detail=f"'{span}' is not supported by the cited source. {reason}",
                offending=span,
            )
        )
    return violations
