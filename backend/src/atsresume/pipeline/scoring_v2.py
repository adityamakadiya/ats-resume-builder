"""ATS scoring, version 2: a score that is hard to game by stuffing keywords.

Why this exists
---------------
``pipeline.scoring`` computes::

    overall = keywords*0.45 + skills*0.25 + sections*0.15 + experience*0.15

which reads as four dimensions and behaves as one and a half:

* ``score_section_completeness`` returns 100 on essentially every document the
  tailoring prompt produces, because that prompt mandates summary, skills,
  experience and education. It is a constant 15 points.
* ``score_experience_match`` returns 75 whenever the posting states no band and
  100 whenever the candidate clears the minimum, so it is near-constant too.
* ``score_keywords`` and ``score_skills_coverage`` both measure "do the job
  description's terms appear in the resume text". They are the same measurement
  taken twice, and they correlate almost perfectly.

Net effect: a nominally four-dimensional score is keyword overlap plus roughly
thirty free points, with a compressed dynamic range. Optimising against it —
best-of-N sampling, say — selects for keyword-stuffed resumes that score higher
and read worse. That is the flaw this module fixes.

What replaces it
----------------
Five dimensions, two of them genuinely new, plus bounded penalties::

    keyword_coverage     0.35   saturating: the second mention earns nothing
    requirement_coverage 0.20   required weighted 2x preferred
    evidence_density     0.20   share of bullets stating a concrete outcome
    specificity          0.15   share of bullets naming a real mechanism
    experience_match     0.10   kept, at a third of its old weight

    penalties                   keyword stuffing, repeated figures, filler
                                (each bounded, 15 points total at worst)

Section completeness is **not** a score term any more. A document either has the
standard sections or it does not, and that is a checklist for the UI, not a
number: see :func:`section_warnings`.

The relevance gate
------------------
Evidence and specificity measure how well the resume is *written*. Well-written
bullets about work that has nothing to do with the posting are worth very little
to this application, so those two terms are scaled by a gate that runs from 0.35
at zero job relevance to 1.0 at full relevance. This is what removes the free-
points floor: a document that matches none of the posting's terms cannot climb
past roughly 22 no matter how good its prose is.

Mapping onto ``SubScores``
--------------------------
``models.SubScores`` still has exactly four fields and another agent owns that
file, so :func:`compute_ats_report` maps the new dimensions onto the old slots::

    SubScores.keyword_match        <- keyword_coverage
    SubScores.skills_coverage      <- requirement_coverage
    SubScores.section_completeness <- evidence_density      (slot reused!)
    SubScores.experience_match     <- experience_match

``specificity``, the penalty breakdown and the gate have nowhere to live in that
model, so the full picture is available two other ways: :func:`compute_breakdown`
returns a :class:`ScoreBreakdownV2` dataclass with every number, and the first
entry in ``AtsReport.recommendations`` is a one-line human-readable breakdown.
When ``SubScores`` is widened later, the reused ``section_completeness`` slot is
the one to fix first — it currently carries evidence density, not sections.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

from ..models import (
    AtsReport,
    Importance,
    JobSpec,
    ResumeFacts,
    SubScores,
    TailoredResume,
)
from ..truth.vocabulary import normalise
from .scoring import (
    _contains,
    _covers,
    facts_text_of,
    resume_text_of,
    score_experience_match,
)

try:  # pragma: no cover - exercised implicitly by the import succeeding
    from ..truth.guard import _metrics
except ImportError:  # pragma: no cover - defensive; guard has no optional deps
    # Duplicated from truth/guard.py. If this branch ever runs, the two copies
    # will drift and evidence density will disagree with the truth guard about
    # what a metric is. Prefer fixing the import over editing this copy.
    _METRIC_FALLBACK = re.compile(
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

    def _metrics(text: str) -> list[str]:
        return [m.group(0).strip().lower() for m in _METRIC_FALLBACK.finditer(text)]


WEIGHTS = {
    "keyword_coverage": 0.35,
    "requirement_coverage": 0.20,
    "evidence_density": 0.20,
    "specificity": 0.15,
    "experience_match": 0.10,
}

PENALTIES = {
    # Per excess mention, per term, then capped. Small per unit on purpose: an
    # honest resume legitimately says "PostgreSQL" in the summary, the skills
    # list and one bullet, and should lose a rounding error for it, not a grade.
    "stuffing_per_excess": 0.5,
    "stuffing_per_term_cap": 2.0,
    "stuffing_cap": 8.0,
    # The same figure on two different bullets is the classic borrowed-metric
    # tell. The truth guard already errors on it; here it also costs points, so
    # a best-of-N selector never prefers the draft that does it.
    "repeated_figure_each": 1.5,
    "repeated_figure_cap": 4.0,
    "filler_each": 1.0,
    "filler_cap": 5.0,
    "total_cap": 15.0,
}

# Below this share of job relevance, prose quality stops earning full credit.
QUALITY_GATE_FLOOR = 0.35


# --------------------------------------------------------------------------- #
# Vocabularies                                                                 #
# --------------------------------------------------------------------------- #

# Ceremony openers. Same set as evals/scorers.py BANNED_OPENERS, restated here
# because evals/ is a test harness and src/ must not import from it.
BANNED_OPENERS = frozenset(
    {
        "helped", "assisted", "participated", "worked", "responsible",
        "spearheaded", "leveraged", "utilised", "utilized",
    }
)

# Subjective self-assessment. None of it is checkable, all of it is filler.
FILLER_PHRASES = (
    "team player", "hard working", "hardworking", "detail oriented",
    "detail-oriented", "self motivated", "self-motivated", "results driven",
    "results-driven", "go getter", "fast learner", "quick learner",
    "passionate about", "excellent communication", "strong work ethic",
    "think outside the box", "dynamic professional", "proven track record",
    "highly motivated", "good team player",
)

# A bullet that names one of these is describing how something actually works,
# not that it happened. This is the axis keyword matching cannot see.
MECHANISM_TERMS = frozenset(
    {
        "queue", "index", "indexes", "indexing", "cache", "caching", "replica",
        "replication", "partition", "partitioning", "sharding", "shard",
        "migration", "migrations", "retry", "retries", "backoff", "webhook",
        "cron", "worker", "workers", "pool", "pooling", "transaction",
        "transactions", "idempotency", "idempotent", "pagination", "paginated",
        "debounce", "throttle", "memoisation", "memoization", "lazy loading",
        "rate limit", "rate limiting", "circuit breaker", "batching", "batch",
        "streaming", "backpressure", "checkpoint", "rollback", "deadlock",
        "connection pool", "read replica", "materialised view",
        "materialized view", "query plan", "bulk insert", "upsert", "fan out",
        "pub sub", "dead letter", "bloom filter", "lru", "ttl", "compaction",
        "prefetch", "code splitting", "tree shaking", "virtualised list",
        "virtualized list", "server side rendering", "feature flag",
        "blue green", "canary", "autoscaling", "load balancer", "reverse proxy",
        "schema", "foreign key", "normalisation", "denormalised", "cursor",
        "polling", "long polling", "websocket", "middleware", "interceptor",
        "compression", "quantisation", "quantization", "embedding",
        "vector search", "chunking", "tokenisation", "tokenization",
    }
)

# A bullet with none of these and no figure is describing a duty, not a result.
OUTCOME_MARKERS = (
    "cutting", "reducing", "eliminating", "removing", "so that", "which let",
    "which meant", "enabling", "allowing", "preventing", "unblocking",
    "shortening", "freeing", "halving", "improving", "speeding up",
    "avoiding", "letting", "making it possible", "without needing",
    "instead of", "down from", "up from", "ahead of", "ending",
)


# --------------------------------------------------------------------------- #
# Text helpers                                                                 #
# --------------------------------------------------------------------------- #

_DIGITS = re.compile(r"[^0-9]")


def _count(term: str, haystack: str) -> int:
    """How many times a term appears as a whole word in normalised text."""
    needle = normalise(term)
    if not needle:
        return 0
    return len(re.findall(rf"(?<![a-z0-9]){re.escape(needle)}(?![a-z0-9])", haystack))


def bullet_texts(tailored: TailoredResume) -> list[str]:
    """Every experience and project bullet, in document order.

    Education, certifications and free-form sections are excluded on purpose:
    they are not where outcomes are claimed, and counting them would dilute both
    new dimensions with lines that were never supposed to carry a result.
    """
    out: list[str] = []
    for exp in tailored.experience:
        out.extend(b.text for b in exp.bullets)
    for proj in tailored.projects:
        out.extend(b.text for b in proj.bullets)
    return out


def _first_word(text: str) -> str:
    words = normalise(text).split()
    return words[0] if words else ""


def _has_outcome(bullet: str) -> bool:
    """A concrete outcome: a figure, or a stated qualitative consequence.

    The qualitative half matters. The tailoring prompt explicitly instructs the
    model to write a qualitative outcome when the source resume carries no
    number, so scoring figures alone would punish the model for following its
    own instructions and would push it towards inventing metrics.
    """
    if _metrics(bullet):
        return True
    hay = normalise(bullet)
    return any(re.search(rf"(?<![a-z]){re.escape(m)}(?![a-z])", hay) for m in OUTCOME_MARKERS)


def _has_mechanism(bullet: str) -> bool:
    hay = normalise(bullet)
    return any(
        re.search(rf"(?<![a-z0-9]){re.escape(term)}(?![a-z0-9])", hay)
        for term in MECHANISM_TERMS
    )


# --------------------------------------------------------------------------- #
# Dimensions                                                                   #
# --------------------------------------------------------------------------- #


@dataclass
class KeywordOutcomeV2:
    matched: list[str]
    missing: list[str]
    counts: dict[str, int]
    score: float


def score_keyword_coverage(job: JobSpec, resume: str) -> KeywordOutcomeV2:
    """Weighted coverage that saturates at the first mention.

    One occurrence earns the term's full weight and every further occurrence
    earns nothing, which is the whole point: repetition cannot buy points, so
    the only way to raise this number is to cover a term the document did not
    cover before.
    """
    if not job.keywords:
        return KeywordOutcomeV2(matched=[], missing=[], counts={}, score=0.0)

    matched: list[str] = []
    missing: list[str] = []
    counts: dict[str, int] = {}
    earned = possible = 0.0

    for keyword in job.keywords:
        weight = max(1.0, min(5.0, float(keyword.weight or 1)))
        possible += weight
        forms = [keyword.term, *keyword.variants]
        occurrences = sum(_count(form, resume) for form in forms)
        counts[keyword.term] = occurrences
        if occurrences:
            matched.append(keyword.term)
            earned += weight  # saturated: occurrences > 1 adds nothing
        else:
            missing.append(keyword.term)

    return KeywordOutcomeV2(
        matched=matched,
        missing=missing,
        counts=counts,
        score=(earned / possible * 100) if possible else 0.0,
    )


def score_requirement_coverage(job: JobSpec, resume: str) -> float:
    """Stated requirements, with a must-have worth twice a nice-to-have."""
    if not job.requirements:
        return 0.0
    earned = possible = 0.0
    for req in job.requirements:
        weight = 2.0 if req.importance == Importance.REQUIRED else 1.0
        possible += weight
        if _covers(req.term, resume):
            earned += weight
    return (earned / possible * 100) if possible else 0.0


def score_evidence_density(tailored: TailoredResume) -> float:
    """Share of experience and project bullets that state a concrete outcome."""
    bullets = bullet_texts(tailored)
    if not bullets:
        return 0.0
    return sum(1 for b in bullets if _has_outcome(b)) / len(bullets) * 100


def score_specificity(tailored: TailoredResume) -> float:
    """Share of bullets naming a mechanism rather than performing ceremony.

    A bullet opening with a ceremony verb scores zero even when it happens to
    name a mechanism, because "Helped with the caching layer" claims proximity
    to work, not the work.
    """
    bullets = bullet_texts(tailored)
    if not bullets:
        return 0.0
    hits = sum(
        1
        for b in bullets
        if _has_mechanism(b) and _first_word(b) not in BANNED_OPENERS
    )
    return hits / len(bullets) * 100


# --------------------------------------------------------------------------- #
# Penalties                                                                    #
# --------------------------------------------------------------------------- #


@dataclass
class PenaltyDetail:
    stuffing: float = 0.0
    repeated_figures: float = 0.0
    filler: float = 0.0
    total: float = 0.0
    notes: list[str] = field(default_factory=list)


def _stuffing_penalty(counts: dict[str, int]) -> tuple[float, list[str]]:
    """A term said more than twice across the document is being stuffed."""
    total = 0.0
    notes: list[str] = []
    for term in sorted(counts):
        excess = counts[term] - 2
        if excess <= 0:
            continue
        cost = min(
            PENALTIES["stuffing_per_term_cap"],
            excess * PENALTIES["stuffing_per_excess"],
        )
        total += cost
        notes.append(f"'{term}' appears {counts[term]} times")
    capped = min(PENALTIES["stuffing_cap"], total)
    return capped, notes


def _repeated_figure_penalty(bullets: list[str]) -> tuple[float, list[str]]:
    """The same number attached to two different achievements."""
    seen: dict[str, int] = {}
    for bullet in bullets:
        for digits in {_DIGITS.sub("", m) for m in _metrics(bullet)}:
            if digits:
                seen[digits] = seen.get(digits, 0) + 1
    repeated = sorted(d for d, n in seen.items() if n > 1)
    total = min(
        PENALTIES["repeated_figure_cap"],
        len(repeated) * PENALTIES["repeated_figure_each"],
    )
    notes = [f"the figure {d} appears on {seen[d]} different bullets" for d in repeated]
    return total, notes


def _filler_penalty(tailored: TailoredResume, resume_text: str) -> tuple[float, list[str]]:
    notes: list[str] = []
    count = 0
    for bullet in bullet_texts(tailored):
        opener = _first_word(bullet)
        if opener in BANNED_OPENERS:
            count += 1
            notes.append(f"bullet opens with '{opener}'")
    for phrase in FILLER_PHRASES:
        if normalise(phrase) in resume_text:
            count += 1
            notes.append(f"subjective filler: '{phrase}'")
    total = min(PENALTIES["filler_cap"], count * PENALTIES["filler_each"])
    return total, notes


def compute_penalties(
    tailored: TailoredResume,
    counts: dict[str, int],
    resume_text: str,
) -> PenaltyDetail:
    stuffing, n1 = _stuffing_penalty(counts)
    repeated, n2 = _repeated_figure_penalty(bullet_texts(tailored))
    filler, n3 = _filler_penalty(tailored, resume_text)
    total = min(PENALTIES["total_cap"], stuffing + repeated + filler)
    return PenaltyDetail(
        stuffing=stuffing,
        repeated_figures=repeated,
        filler=filler,
        total=total,
        notes=[*n1, *n2, *n3],
    )


# --------------------------------------------------------------------------- #
# Section hygiene — a checklist, not a score                                   #
# --------------------------------------------------------------------------- #


def section_warnings(tailored: TailoredResume) -> list[str]:
    """Hygiene notes for the UI to render as a checklist.

    v1 scored this and it was worth a constant fifteen points, because the
    tailoring prompt mandates every section it looked for. Presence of a section
    is binary and actionable, which makes it a warning, not a dimension.
    """
    out: list[str] = []
    if not tailored.summary.text.strip():
        out.append("No summary section. A recruiter reads this first.")
    if not tailored.skills:
        out.append("No skills section. Keyword screens look here before anywhere else.")
    if not tailored.experience and not tailored.projects:
        out.append("No experience or projects section. There is nothing to screen.")
    if not tailored.education:
        out.append("No education section. Many screens filter on a degree field.")
    if not tailored.headline.strip():
        out.append("No headline. The title line is what a title-match filter reads.")
    empty = [e.company for e in tailored.experience if not e.bullets]
    if empty:
        out.append(f"Experience entries with no bullets: {', '.join(empty)}.")
    return out


# --------------------------------------------------------------------------- #
# Composite                                                                    #
# --------------------------------------------------------------------------- #


@dataclass
class ScoreBreakdownV2:
    """Every number behind the overall score. Nothing here is rounded away."""

    overall: float
    keyword_coverage: float
    requirement_coverage: float
    evidence_density: float
    specificity: float
    experience_match: float
    relevance: float
    quality_gate: float
    penalty: PenaltyDetail
    matched_keywords: list[str]
    missing_keywords: list[str]
    recoverable_keywords: list[str]
    keyword_counts: dict[str, int]
    warnings: list[str]

    def as_dict(self) -> dict:
        return asdict(self)

    def summary_line(self) -> str:
        return (
            f"Breakdown — keywords {self.keyword_coverage:.0f}, "
            f"requirements {self.requirement_coverage:.0f}, "
            f"evidence {self.evidence_density:.0f}, "
            f"specificity {self.specificity:.0f}, "
            f"experience {self.experience_match:.0f}; "
            f"quality gate x{self.quality_gate:.2f}; "
            f"penalties -{self.penalty.total:.1f} "
            f"(stuffing {self.penalty.stuffing:.1f}, "
            f"repeated figures {self.penalty.repeated_figures:.1f}, "
            f"filler {self.penalty.filler:.1f})."
        )


def compute_breakdown(
    job: JobSpec,
    facts: ResumeFacts,
    tailored: TailoredResume,
) -> ScoreBreakdownV2:
    tailored_text = resume_text_of(tailored)
    original_text = facts_text_of(facts)

    keywords = score_keyword_coverage(job, tailored_text)
    requirements = score_requirement_coverage(job, tailored_text)
    evidence = score_evidence_density(tailored)
    specificity = score_specificity(tailored)
    experience = score_experience_match(job, facts)

    # How much of this posting the document actually speaks to, 0-100.
    relevance_weight = WEIGHTS["keyword_coverage"] + WEIGHTS["requirement_coverage"]
    relevance = (
        keywords.score * WEIGHTS["keyword_coverage"]
        + requirements * WEIGHTS["requirement_coverage"]
    ) / relevance_weight

    gate = QUALITY_GATE_FLOOR + (1.0 - QUALITY_GATE_FLOOR) * (relevance / 100.0)

    raw = (
        keywords.score * WEIGHTS["keyword_coverage"]
        + requirements * WEIGHTS["requirement_coverage"]
        + (
            evidence * WEIGHTS["evidence_density"]
            + specificity * WEIGHTS["specificity"]
        )
        * gate
        + experience * WEIGHTS["experience_match"]
    )

    penalty = compute_penalties(tailored, keywords.counts, tailored_text)
    overall = max(0.0, min(100.0, raw - penalty.total))

    # Kept verbatim from v1 in spirit: a term the tailored document dropped but
    # the original resume does carry is the cheapest win on the page, because it
    # is already true and only needs putting back.
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

    return ScoreBreakdownV2(
        overall=round(overall, 1),
        keyword_coverage=round(keywords.score, 1),
        requirement_coverage=round(requirements, 1),
        evidence_density=round(evidence, 1),
        specificity=round(specificity, 1),
        experience_match=round(experience, 1),
        relevance=round(relevance, 1),
        quality_gate=round(gate, 3),
        penalty=penalty,
        matched_keywords=keywords.matched,
        missing_keywords=truly_missing,
        recoverable_keywords=recoverable,
        keyword_counts=keywords.counts,
        warnings=section_warnings(tailored),
    )


def compute_ats_report(
    job: JobSpec,
    facts: ResumeFacts,
    tailored: TailoredResume,
) -> AtsReport:
    """Drop-in replacement for ``scoring.compute_ats_report``.

    Returns the same ``AtsReport``. See the module docstring for how the five v2
    dimensions are squeezed into the four ``SubScores`` fields — in particular
    ``section_completeness`` now carries **evidence density**, not sections.
    """
    b = compute_breakdown(job, facts, tailored)
    return AtsReport(
        overall=b.overall,
        sub_scores=SubScores(
            keyword_match=b.keyword_coverage,
            skills_coverage=b.requirement_coverage,
            # Not weighted any more. Reported as 100 because it always was on a
            # document this pipeline produces; section_warnings() is where a
            # genuinely missing section now surfaces.
            section_completeness=100.0,
            experience_match=b.experience_match,
            evidence_density=b.evidence_density,
            specificity=b.specificity,
            relevance_gate=b.quality_gate,
            penalty=b.penalty.total,
        ),
        matched_keywords=b.matched_keywords,
        missing_keywords=b.missing_keywords,
        recoverable_keywords=b.recoverable_keywords,
        recommendations=_recommendations(b, job, facts),
    )


def _recommendations(b: ScoreBreakdownV2, job: JobSpec, facts: ResumeFacts) -> list[str]:
    out: list[str] = [b.summary_line()]

    if b.recoverable_keywords:
        out.append(
            "Put these back — your original resume already claims them, the tailored version "
            f"dropped them: {', '.join(b.recoverable_keywords[:6])}."
        )
    if b.keyword_coverage < 60 and b.missing_keywords:
        out.append(
            "Keyword coverage is low. These cannot be added truthfully, so treat them as a "
            f"skills gap rather than an editing task: {', '.join(b.missing_keywords[:6])}."
        )
    if b.requirement_coverage < 60:
        required = [r.term for r in job.requirements if r.importance == Importance.REQUIRED]
        out.append(
            "Several stated must-haves are unmet"
            + (f" ({', '.join(required[:5])})" if required else "")
            + ". A recruiter screens on these first."
        )
    if b.evidence_density < 60:
        out.append(
            "Most bullets describe duties rather than results. Each one should end in what "
            "changed — a figure where the original resume has one, a stated consequence where "
            "it does not."
        )
    if b.specificity < 50:
        out.append(
            "The bullets say what was done but not how it worked. Name the mechanism — the "
            "index, the queue, the cache, the retry — because that is what a senior reader "
            "screens on and no keyword filter can fake it."
        )
    if b.experience_match < 70:
        wanted = job.experience_years.raw or f"{job.experience_years.min:g}+ years"
        out.append(
            f"The posting asks for {wanted} and the resume shows about "
            f"{facts.total_years_experience:g}. Lead with depth and shipped outcomes rather "
            "than tenure."
        )
    if b.penalty.total > 0:
        out.append(
            f"Lost {b.penalty.total:.1f} points to padding: {'; '.join(b.penalty.notes[:4])}."
        )
    for warning in b.warnings:
        out.append(warning)
    if len(out) == 1:
        out.append("No mechanical gaps found. The remaining leverage is in the writing.")
    return out
