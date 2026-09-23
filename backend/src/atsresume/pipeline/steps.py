"""Pipeline steps, in the order they run."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field

from .. import store
from ..config import get_settings
from ..llm import structured
from ..models import (
    AtsReport,
    GapAnalysis,
    JobSpec,
    ResumeFacts,
    Strategy,
    TailoredResume,
    TruthReport,
)
from ..truth.entailment import check_entailment
from ..truth.guard import entailment_pairs, merge_violations, run_truth_guard
from . import prompts
from .sanitize import sanitize
from .score import compute_ats_report

logger = logging.getLogger(__name__)


def _block(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


def extract_resume_facts(raw_resume_text: str) -> ResumeFacts:
    cached = store.get_facts(raw_resume_text)
    if cached is not None:
        return cached

    facts = structured(
        system=prompts.RESUME_EXTRACTION,
        user="Extract structured facts from this resume.\n\n"
        + _block("resume", raw_resume_text),
        schema=ResumeFacts,
        step="extract",
    )
    store.put_facts(raw_resume_text, facts)
    return facts


def extract_job_spec(jd_text: str, source_note: str) -> JobSpec:
    return structured(
        system=prompts.JD_EXTRACTION,
        user=f"Decompose this job description.\n\nSource: {source_note}\n\n"
        + _block("job_description", jd_text),
        schema=JobSpec,
        step="analyze",
    )


def analyze_gaps(job: JobSpec, facts: ResumeFacts) -> GapAnalysis:
    return structured(
        system=prompts.GAP_ANALYSIS,
        user="Compare this candidate against this role.\n\n"
        + _block("job_spec", job.model_dump_json(indent=2))
        + "\n\n"
        + _block("resume_facts", facts.model_dump_json(indent=2)),
        schema=GapAnalysis,
        step="gaps",
    )


@dataclass
class TailorOutcome:
    tailored: TailoredResume
    truth: TruthReport
    repair_attempted: bool
    # Why the first draft was rejected, if it was. The repair round doubles the
    # cost of the most expensive step, so knowing which rule keeps tripping is
    # the difference between tuning the prompt and guessing at it.
    first_draft_violations: list[str] = field(default_factory=list)


def tailor_resume(
    job: JobSpec,
    facts: ResumeFacts,
    gaps: GapAnalysis,
    raw_resume_text: str,
) -> TailorOutcome:
    """Rewrite, then verify. A failing draft gets exactly one repair attempt.

    One, not many: a loop that keeps pushing until the guard passes is an
    optimiser applying pressure toward whatever wording slips past it, which is
    the opposite of what the guard is for. If a second draft still fails, the
    candidate is shown precisely which lines are unverifiable rather than handed
    a resume that reads well and cannot be defended in an interview.
    """
    jd_terms = job.all_terms()

    brief = "\n\n".join(
        [
            "Rewrite this candidate's resume for this role.",
            _block("job_spec", job.model_dump_json(indent=2)),
            _block("resume_facts", facts.model_dump_json(indent=2)),
            _block("gap_analysis", gaps.model_dump_json(indent=2)),
            "The gap analysis lists missing_keywords the candidate cannot truthfully claim. "
            "Do not use them.\n"
            "Surface every recoverable_keyword - those are already true and merely buried.",
        ]
    )

    def verify(draft: TailoredResume) -> TruthReport:
        """Token checks first, then entailment on what survives them.

        Ordering is a cost decision as much as a correctness one. The token
        checks are free and catch the loud fabrications; running the model over
        a draft that already has an invented metric in it would be paying to
        learn something we already know.
        """
        report = run_truth_guard(draft, facts, raw_resume_text, jd_terms)
        if not get_settings().enable_entailment:
            return report
        return merge_violations(report, check_entailment(entailment_pairs(draft, facts)))

    tailored = sanitize(
        structured(
            system=prompts.TAILOR,
            user=brief,
            schema=TailoredResume,
            step="tailor",
        )
    )
    truth = verify(tailored)
    repair_attempted = False
    first_draft_violations: list[str] = []

    if not truth.passed:
        repair_attempted = True
        # Log the detail, not the line. The detail names the term that tripped
        # the rule, which is the only part that says whether this was a real
        # catch or the guard being too eager.
        first_draft_violations = [
            f"{v.code.value}: {v.detail}" for v in truth.violations if v.severity == "error"
        ]
        findings = "\n".join(
            f'- [{v.code.value}] {v.location}: {v.detail}\n  Line: "{v.offending}"'
            for v in truth.violations
            if v.severity == "error"
        )
        logger.warning(
            "Truth guard rejected the first draft (%d errors): %s",
            truth.error_count,
            "; ".join(first_draft_violations[:5]),
        )

        repair_brief = "\n\n".join(
            [
                brief,
                "Your previous draft failed verification against the uploaded resume:\n" + findings,
                "Rewrite it. For each failing line, either restate it using only what its "
                "sources actually say, or drop it. Do not try to justify a figure or a "
                "technology that is not in the original resume.",
            ]
        )
        tailored = sanitize(
            structured(
                system=prompts.TAILOR,
                user=repair_brief,
                schema=TailoredResume,
                step="tailor",
            )
        )
        truth = verify(tailored)

    return TailorOutcome(
        tailored=tailored,
        truth=truth,
        repair_attempted=repair_attempted,
        first_draft_violations=first_draft_violations,
    )


def strategize(
    job: JobSpec,
    gaps: GapAnalysis,
    tailored: TailoredResume,
    report: AtsReport,
) -> Strategy:
    return structured(
        system=prompts.STRATEGY,
        user="Advise this candidate on this application.\n\n"
        + _block("job_spec", job.model_dump_json(indent=2))
        + "\n\n"
        + _block("gap_analysis", gaps.model_dump_json(indent=2))
        + "\n\n"
        + _block("tailored_resume", tailored.model_dump_json(indent=2))
        + "\n\n"
        + _block("computed_ats_score", report.model_dump_json(indent=2)),
        schema=Strategy,
        step="strategy",
    )


@dataclass
class PipelineResult:
    job: JobSpec
    facts: ResumeFacts
    gaps: GapAnalysis
    tailored: TailoredResume
    truth: TruthReport
    report: AtsReport
    strategy: Strategy
    repair_attempted: bool


def run_pipeline(raw_resume_text: str, jd_text: str, source_note: str) -> PipelineResult:
    """Full run. The two extractions are independent, so they overlap.

    The SDK client is thread-safe and both calls are I/O bound, so a two-worker
    pool halves the slowest serial segment for the cost of one import.
    """
    with ThreadPoolExecutor(max_workers=2) as pool:
        job_future = pool.submit(extract_job_spec, jd_text, source_note)
        facts_future = pool.submit(extract_resume_facts, raw_resume_text)
        job = job_future.result()
        facts = facts_future.result()

    gaps = analyze_gaps(job, facts)
    outcome = tailor_resume(job, facts, gaps, raw_resume_text)
    report = compute_ats_report(job, facts, outcome.tailored)
    strategy = strategize(job, gaps, outcome.tailored, report)

    return PipelineResult(
        job=job,
        facts=facts,
        gaps=gaps,
        tailored=outcome.tailored,
        truth=outcome.truth,
        report=report,
        strategy=strategy,
        repair_attempted=outcome.repair_attempted,
    )
