"""Pipeline steps, in the order they run."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

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
from ..truth.guard import run_truth_guard
from . import prompts
from .scoring import compute_ats_report

logger = logging.getLogger(__name__)


def _block(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


def extract_resume_facts(raw_resume_text: str) -> ResumeFacts:
    settings = get_settings()
    return structured(
        system=prompts.RESUME_EXTRACTION,
        user="Extract structured facts from this resume.\n\n"
        + _block("resume", raw_resume_text),
        schema=ResumeFacts,
        effort=settings.effort_extract,
    )


def extract_job_spec(jd_text: str, source_note: str) -> JobSpec:
    settings = get_settings()
    return structured(
        system=prompts.JD_EXTRACTION,
        user=f"Decompose this job description.\n\nSource: {source_note}\n\n"
        + _block("job_description", jd_text),
        schema=JobSpec,
        effort=settings.effort_analyze,
    )


def analyze_gaps(job: JobSpec, facts: ResumeFacts) -> GapAnalysis:
    settings = get_settings()
    return structured(
        system=prompts.GAP_ANALYSIS,
        user="Compare this candidate against this role.\n\n"
        + _block("job_spec", job.model_dump_json(indent=2))
        + "\n\n"
        + _block("resume_facts", facts.model_dump_json(indent=2)),
        schema=GapAnalysis,
        effort=settings.effort_analyze,
    )


@dataclass
class TailorOutcome:
    tailored: TailoredResume
    truth: TruthReport
    repair_attempted: bool


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
    settings = get_settings()
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

    tailored = structured(
        system=prompts.TAILOR,
        user=brief,
        schema=TailoredResume,
        effort=settings.effort_tailor,
    )
    truth = run_truth_guard(tailored, facts, raw_resume_text, jd_terms)
    repair_attempted = False

    if not truth.passed:
        repair_attempted = True
        findings = "\n".join(
            f'- [{v.code.value}] {v.location}: {v.detail}\n  Line: "{v.offending}"'
            for v in truth.violations
            if v.severity == "error"
        )
        logger.info("Truth guard rejected the first draft (%d errors)", truth.error_count)

        tailored = structured(
            system=prompts.TAILOR,
            user="\n\n".join(
                [
                    brief,
                    "Your previous draft failed verification against the uploaded resume:\n"
                    + findings,
                    "Rewrite it. For each failing line, either restate it using only what its "
                    "sources actually say, or drop it. Do not try to justify a figure or a "
                    "technology that is not in the original resume.",
                ]
            ),
            schema=TailoredResume,
            effort=settings.effort_tailor,
        )
        truth = run_truth_guard(tailored, facts, raw_resume_text, jd_terms)

    return TailorOutcome(tailored=tailored, truth=truth, repair_attempted=repair_attempted)


def strategize(
    job: JobSpec,
    gaps: GapAnalysis,
    tailored: TailoredResume,
    report: AtsReport,
) -> Strategy:
    settings = get_settings()
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
        effort=settings.effort_analyze,
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
