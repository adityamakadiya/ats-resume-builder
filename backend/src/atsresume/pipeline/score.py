"""Which scorer runs.

v2 replaced v1 because v1 could be gamed: thirty of its hundred points were
free, and its two remaining terms measured the same thing, so a keyword-stuffed
draft outscored an honest one. Both are kept because a score is the number a
candidate makes decisions on, and changing how it is computed should be
reversible by an environment variable rather than a deploy.

Nothing else in the codebase should import a scorer module directly.
"""

from __future__ import annotations

from ..config import get_settings
from ..models import AtsReport, JobSpec, ResumeFacts, TailoredResume
from . import scoring as _v1
from . import scoring_v2 as _v2


def compute_ats_report(
    job: JobSpec,
    facts: ResumeFacts,
    tailored: TailoredResume,
) -> AtsReport:
    if get_settings().scorer_version == "v1":
        return _v1.compute_ats_report(job, facts, tailored)
    return _v2.compute_ats_report(job, facts, tailored)


def section_warnings(tailored: TailoredResume) -> list[str]:
    """Hygiene notes for the UI checklist.

    v1 scored section completeness and always returned 100, which meant a
    missing Education section cost nothing and was never mentioned. It is a
    checklist item, not a dimension.
    """
    return _v2.section_warnings(tailored)
