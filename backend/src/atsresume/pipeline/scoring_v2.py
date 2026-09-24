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
    "keyword_coverage": 0.30,
    "requirement_coverage": 0.18,
    # New. A recruiter reads the most recent title against the req title before
    # reading anything else, and rejects on it more often than on any other
    # single field. Nothing in v2 measured it: experience_match is a years
    # band, which is not the same question and is near-constant besides.
    "title_match": 0.12,
    "evidence_density": 0.20,
    "specificity": 0.15,
    # Down from 0.10. Years-in-band is the weakest of the relevance signals and
    # it was carrying weight that title match earns.
    "experience_match": 0.05,
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
# Where a term appears, and what that is worth                                 #
# --------------------------------------------------------------------------- #
#
# Coverage used to run over one flat string, so "Kubernetes" in the skills list
# counted exactly as much as "Kubernetes" in the job the candidate is doing
# right now. No recruiter reads those as the same claim, and the flat version
# rewards the cheapest possible edit: append the missing terms to the skills
# list and the score goes up without the resume being any more true.
#
# So every term is now worth the most valuable place it appears. Two axes:
#
#   evidenced vs claimed   a term inside a bullet is attached to something the
#                          candidate says they did; a term in a skills list or
#                          a summary is an assertion with nothing under it
#   recency                the same evidence ages
#
# A term in the current role still earns 1.0, so a resume whose present job is
# genuinely the job being applied for can still reach 100. Nothing here is a
# penalty; it is the absence of a bonus the flat version was giving away.

ZONE_CURRENT_ROLE = 1.00
# Older roles decay towards a floor rather than to nothing: five-year-old
# production experience with a tool is worth much less than current experience
# and much more than never having touched it.
ZONE_ROLE_DECAY = (1.00, 0.85, 0.72, 0.62)
ZONE_ROLE_FLOOR = 0.60
# Side projects are evidence, and usually recent, but unvalidated by an
# employer. Between an old role and a claim.
ZONE_PROJECT = 0.80
ZONE_EDUCATION = 0.60
# Claims. The summary is at least prose a human reads; a skills list is the
# cheapest line on the page to add a word to.
ZONE_SUMMARY = 0.55
ZONE_SKILLS = 0.50
ZONE_OTHER = 0.55

# --------------------------------------------------------------------------- #
# Titles and seniority                                                         #
# --------------------------------------------------------------------------- #

_PRESENT = re.compile(
    r"\b(present|current|currently|now|ongoing|to date|till date|date)\b",
    re.IGNORECASE,
)
_YEAR = re.compile(r"\b(19|20)\d{2}\b")

# The ladder, as postings use it. Absent marker means mid, which is what an
# unqualified "Software Engineer" means on both sides of the table.
SENIORITY_BANDS: dict[str, int] = {
    "intern": 0, "internship": 0, "trainee": 0, "graduate": 0, "fresher": 0,
    "junior": 1, "jr": 1, "entry": 1, "associate": 1,
    "mid": 2, "intermediate": 2,
    "senior": 3, "sr": 3,
    "staff": 4, "lead": 4, "principal": 5, "architect": 4, "manager": 4,
    "head": 5, "director": 6, "vp": 7, "chief": 8, "cto": 8, "ceo": 8,
}
DEFAULT_BAND = 2

# Penalty per level of distance, applied to the title score.
UNDERQUALIFIED_PER_LEVEL = 20.0
UNDERQUALIFIED_CAP = 55.0
# Asymmetric on purpose. Both directions get rejected, but a senior applying
# down is screened out for fit and salary, not for being unable to do it, and
# recovers if they want the role. A junior applying up does not recover.
OVERQUALIFIED_PER_LEVEL = 10.0
OVERQUALIFIED_CAP = 30.0

# Words that carry no role information. Dropping them stops "Engineer II at a
# Company" matching "Engineer" on the strength of the filler.
TITLE_STOPWORDS = frozenset(
    {
        "a", "an", "the", "and", "or", "of", "for", "to", "in", "at", "with",
        "i", "ii", "iii", "iv", "v", "1", "2", "3", "4", "5",
        "engineer2", "level", "grade", "band",
    }
)

# The posting states no title often enough that returning 0 would be a lie and
# returning 100 would be a gift. Neutral, and it says so in the recommendation.
TITLE_UNKNOWN = 70.0


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
    # term -> the zone it earned its weight in. Empty under flat scoring.
    # This is what lets the UI say "PostgreSQL is only in your skills list",
    # which is a more useful sentence than a number moving.
    placements: dict[str, str] = field(default_factory=dict)


@dataclass
class Zone:
    """A region of the resume, and what a term found there is worth.

    ``text`` is normalised at construction. ``_count`` normalises the needle
    and assumes the haystack already is, which is how ``resume_text_of``
    hands its output over; a zone built from raw strings matches nothing at
    all and every term silently falls through to "unplaced".
    """

    name: str
    text: str
    weight: float


def _is_present(end_date: str) -> bool:
    return bool(_PRESENT.search(end_date or ""))


def _latest_year(text: str) -> int:
    found = [int(m.group(0)) for m in _YEAR.finditer(text or "")]
    return max(found) if found else 0


def _experience_in_recency_order(tailored: TailoredResume) -> list:
    """Most recent role first.

    Resumes are conventionally reverse-chronological and the parser preserves
    document order, so the original index is the tie-breaker rather than the
    signal: a resume that is ordered correctly is unaffected, and one that is
    not gets read correctly anyway.
    """
    entries = list(tailored.experience)

    def key(pair):
        index, entry = pair
        current = 1 if _is_present(getattr(entry, "end_date", "")) else 0
        year = _latest_year(getattr(entry, "end_date", "") or "")
        return (-current, -year, index)

    return [entry for _, entry in sorted(enumerate(entries), key=key)]


def _role_weight(rank: int) -> float:
    if rank < len(ZONE_ROLE_DECAY):
        return ZONE_ROLE_DECAY[rank]
    return ZONE_ROLE_FLOOR


def _zone(name: str, text: str, weight: float) -> Zone | None:
    body = normalise(text)
    return Zone(name, body, weight) if body.strip() else None


def keyword_zones(tailored: TailoredResume) -> list[Zone]:
    """The document, cut into regions worth different amounts.

    Bullets are separated from the headings around them deliberately. A job
    title containing "Platform" should not make every term in that role look
    evidenced, and a company name should not match a keyword at all.
    """
    zones: list[Zone | None] = []

    head = " ".join(
        filter(None, [tailored.headline, getattr(tailored.summary, "text", "")])
    )
    zones.append(_zone("summary", head, ZONE_SUMMARY))

    for rank, exp in enumerate(_experience_in_recency_order(tailored)):
        weight = _role_weight(rank)
        body = " ".join(b.text for b in exp.bullets)
        # The title line is evidence of the role, so it earns the role's
        # weight; the company and dates are not evidence of anything.
        heading = " ".join(filter(None, [exp.title]))
        zones.append(_zone(f"experience[{rank}]", f"{heading} {body}", weight))

    for proj in tailored.projects:
        text = " ".join([proj.name, *(b.text for b in proj.bullets)])
        zones.append(_zone("project", text, ZONE_PROJECT))

    skills = " ".join(
        " ".join([group.category, *group.items]) for group in tailored.skills
    )
    zones.append(_zone("skills", skills, ZONE_SKILLS))

    edu = " ".join(
        " ".join(filter(None, [e.institution, e.degree])) for e in tailored.education
    )
    certs = " ".join(c.text for c in tailored.certifications)
    learned = " ".join(filter(None, [edu, certs]))
    zones.append(_zone("education", learned, ZONE_EDUCATION))

    other = " ".join(
        " ".join([sec.heading, *(b.text for b in sec.bullets)])
        for sec in tailored.other_sections
    )
    zones.append(_zone("other", other, ZONE_OTHER))

    return [z for z in zones if z is not None]


def score_keyword_coverage(
    job: JobSpec,
    resume: str,
    zones: list[Zone] | None = None,
) -> KeywordOutcomeV2:
    """Weighted coverage that saturates at the first mention.

    One occurrence earns the term's full weight and every further occurrence
    earns nothing, which is the whole point: repetition cannot buy points, so
    the only way to raise this number is to cover a term the document did not
    cover before.

    With ``zones``, a term earns the weight of the best place it appears
    rather than a flat full mark. Saturation is unchanged: the maximum is
    taken across zones, never a sum, so mentioning a term in all six regions
    is worth exactly what mentioning it in the best one is worth.

    ``zones=None`` keeps the flat behaviour, which is what the direct callers
    in the test suite and the fixture exporter use.
    """
    if not job.keywords:
        return KeywordOutcomeV2(matched=[], missing=[], counts={}, score=0.0)

    matched: list[str] = []
    missing: list[str] = []
    counts: dict[str, int] = {}
    placements: dict[str, str] = {}
    earned = possible = 0.0

    for keyword in job.keywords:
        weight = max(1.0, min(5.0, float(keyword.weight or 1)))
        possible += weight
        forms = [keyword.term, *keyword.variants]
        occurrences = sum(_count(form, resume) for form in forms)
        counts[keyword.term] = occurrences

        if not occurrences:
            missing.append(keyword.term)
            continue

        matched.append(keyword.term)

        if zones is None:
            earned += weight
            continue

        best = 0.0
        where = ""
        for zone in zones:
            if any(_count(form, zone.text) for form in forms):
                if zone.weight > best:
                    best, where = zone.weight, zone.name

        if best == 0.0:
            # Found in the flat text but in no zone: a company name, a date
            # line, something the zones deliberately exclude. Treat it as the
            # weakest kind of claim rather than as absent.
            best, where = ZONE_SKILLS, "unplaced"

        earned += weight * best
        placements[keyword.term] = where

    return KeywordOutcomeV2(
        matched=matched,
        missing=missing,
        counts=counts,
        score=(earned / possible * 100) if possible else 0.0,
        placements=placements,
    )


# --------------------------------------------------------------------------- #
# Title and seniority                                                          #
# --------------------------------------------------------------------------- #


def _title_tokens(title: str) -> tuple[frozenset[str], int | None]:
    """The role words, and the seniority the title declares."""
    words = [w for w in re.split(r"[^a-z0-9+#]+", normalise(title)) if w]
    band: int | None = None
    role: list[str] = []
    for word in words:
        if word in SENIORITY_BANDS:
            level = SENIORITY_BANDS[word]
            # The highest marker wins: "senior engineering manager" is a
            # manager, not a senior.
            band = level if band is None else max(band, level)
            continue
        if word in TITLE_STOPWORDS:
            continue
        role.append(word)
    return frozenset(role), band


def _most_recent_title(tailored: TailoredResume) -> str:
    order = _experience_in_recency_order(tailored)
    return order[0].title if order else ""


def score_title_match(job: JobSpec, tailored: TailoredResume) -> float:
    """How close the candidate's current title is to the one being filled.

    Two parts, because they fail differently. Role overlap asks whether this
    is the same kind of job; seniority distance asks whether it is the same
    rung. A backend engineer applying to a backend manager role scores full
    marks on the first and loses heavily on the second, which is exactly how
    that application gets read.

    Recall against the posting, not symmetric overlap: a longer candidate
    title is not worse for containing extra words. "Senior Backend Engineer,
    Payments" covers "Backend Engineer" completely.
    """
    target_role, target_band = _title_tokens(job.title)
    if not target_role:
        return TITLE_UNKNOWN

    current = _most_recent_title(tailored)
    cand_role, cand_band = _title_tokens(current)
    head_role, _ = _title_tokens(tailored.headline)

    def recall(tokens: frozenset[str]) -> float:
        if not tokens:
            return 0.0
        return len(target_role & tokens) / len(target_role) * 100.0

    # The headline is self-declared and rewritten by this very pipeline, so it
    # is worth slightly less than a title an employer actually gave.
    overlap = max(recall(cand_role), recall(head_role) * 0.9)

    required = DEFAULT_BAND if target_band is None else target_band
    held = DEFAULT_BAND if cand_band is None else cand_band
    gap = held - required

    if gap < 0:
        penalty = min(UNDERQUALIFIED_CAP, -gap * UNDERQUALIFIED_PER_LEVEL)
    elif gap > 0:
        penalty = min(OVERQUALIFIED_CAP, gap * OVERQUALIFIED_PER_LEVEL)
    else:
        penalty = 0.0

    return max(0.0, min(100.0, overlap - penalty))


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
    title_match: float
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
    keyword_placements: dict[str, str]
    warnings: list[str]

    def as_dict(self) -> dict:
        return asdict(self)

    def summary_line(self) -> str:
        return (
            f"Breakdown — keywords {self.keyword_coverage:.0f}, "
            f"requirements {self.requirement_coverage:.0f}, "
            f"title {self.title_match:.0f}, "
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

    zones = keyword_zones(tailored)
    keywords = score_keyword_coverage(job, tailored_text, zones)
    requirements = score_requirement_coverage(job, tailored_text)
    title = score_title_match(job, tailored)
    evidence = score_evidence_density(tailored)
    specificity = score_specificity(tailored)
    experience = score_experience_match(job, facts)

    # How much of this posting the document actually speaks to, 0-100.
    # Title match belongs here: a document for a different kind of job is not
    # relevant to this one however many of its nouns happen to overlap.
    relevance_weight = (
        WEIGHTS["keyword_coverage"]
        + WEIGHTS["requirement_coverage"]
        + WEIGHTS["title_match"]
    )
    relevance = (
        keywords.score * WEIGHTS["keyword_coverage"]
        + requirements * WEIGHTS["requirement_coverage"]
        + title * WEIGHTS["title_match"]
    ) / relevance_weight

    gate = QUALITY_GATE_FLOOR + (1.0 - QUALITY_GATE_FLOOR) * (relevance / 100.0)

    raw = (
        keywords.score * WEIGHTS["keyword_coverage"]
        + requirements * WEIGHTS["requirement_coverage"]
        + title * WEIGHTS["title_match"]
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
        title_match=round(title, 1),
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
        keyword_placements=keywords.placements,
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
            title_match=b.title_match,
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


# Zones that are a claim rather than evidence. A term sitting only in one of
# these is the cheapest real improvement available: it is already true, it is
# already on the page, and it only needs attaching to something that happened.
CLAIM_ZONES = frozenset({"skills", "summary", "education", "other", "unplaced"})


def stranded_terms(b: ScoreBreakdownV2) -> list[str]:
    """Matched terms that never appear in a bullet."""
    return sorted(
        term for term, where in b.keyword_placements.items() if where in CLAIM_ZONES
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
    stranded = stranded_terms(b)
    if stranded:
        out.append(
            "These are on the page but only as a claim — they appear in a list or the "
            "summary, never in a bullet describing work: "
            f"{', '.join(stranded[:6])}. Moving one into the experience it actually "
            "belongs to is worth more than adding a new term anywhere."
        )
    if b.title_match < 55:
        out.append(
            f"Your most recent title reads a long way from \"{job.title}\". That is the "
            "first line a screener compares and the most common reason a relevant "
            "resume is passed over. If the work genuinely matches, say so in the "
            "headline; if it does not, this posting is a stretch and worth weighing "
            "against a closer one."
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
