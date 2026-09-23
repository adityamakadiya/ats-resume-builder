"""Domain models.

Two conventions run through this file, both learned the hard way against
Anthropic's strict JSON-schema mode:

1. Absent values are the empty string, not ``None``. Strict mode requires every
   property to appear in ``required``, so "optional" has to mean present-but-
   empty. Nullable unions also inflate the compiled grammar, and a wide model
   full of them gets rejected outright with "the compiled grammar is too large".

2. Provenance lives on the tailored document, never on the source facts. The
   facts are what the candidate claimed; the tailored lines cite them by id.
   That separation is what lets the truth guard verify mechanically.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Layer 1 — ResumeFacts: what the candidate actually claims                    #
# --------------------------------------------------------------------------- #


class Bullet(BaseModel):
    id: str = Field(description="Stable id, e.g. 'E1.B2' for experience 1, bullet 2")
    text: str = Field(description="The bullet copied from the resume, verbatim")


class Link(BaseModel):
    label: str
    url: str


class Contact(BaseModel):
    name: str
    email: str = Field(default="", description="Empty string if absent")
    phone: str = Field(default="", description="Empty string if absent")
    location: str = Field(default="", description="City and country. Empty string if absent")
    links: list[Link] = Field(default_factory=list)


class ExperienceFact(BaseModel):
    id: str = Field(description="Stable id, e.g. 'E1'")
    company: str
    title: str
    location: str = Field(default="", description="Empty string if absent")
    start_date: str = Field(description="As written on the resume, e.g. 'Jun 2023'")
    end_date: str = Field(description="As written, e.g. 'Present'")
    bullets: list[Bullet] = Field(default_factory=list)
    tech: list[str] = Field(
        default_factory=list, description="Technologies named in this role only"
    )


class ProjectFact(BaseModel):
    id: str = Field(description="Stable id, e.g. 'P1'")
    name: str
    description: str = Field(default="", description="Empty string if absent")
    url: str = Field(default="", description="Empty string if absent")
    bullets: list[Bullet] = Field(default_factory=list)
    tech: list[str] = Field(default_factory=list)


class EducationFact(BaseModel):
    id: str
    institution: str
    degree: str = Field(description="Degree and field as written, e.g. 'B.E. Computer Engineering'")
    dates: str = Field(default="", description="As written, e.g. '2019 - 2023'")
    details: str = Field(default="", description="Honours, GPA or coursework. Empty if absent")


class SkillGroup(BaseModel):
    id: str
    category: str = Field(description="e.g. 'Languages', 'Frameworks', 'Cloud & DevOps'")
    items: list[str] = Field(default_factory=list)


class Certification(BaseModel):
    id: str
    text: str = Field(description="The line as written, including issuer and date")


class OtherSection(BaseModel):
    """Anything the resume has that the fixed fields above do not model.

    Real resumes carry Publications, Open Source, Leadership, Patents. Losing
    them costs the candidate real signal, so they keep their heading.
    """

    id: str
    heading: str
    bullets: list[Bullet] = Field(default_factory=list)


class ResumeFacts(BaseModel):
    contact: Contact
    headline: str = Field(default="", description="Current professional title line. Empty if absent")
    summary: str = Field(default="", description="Existing summary text, verbatim. Empty if absent")
    experience: list[ExperienceFact] = Field(default_factory=list)
    projects: list[ProjectFact] = Field(default_factory=list)
    education: list[EducationFact] = Field(default_factory=list)
    skills: list[SkillGroup] = Field(default_factory=list)
    certifications: list[Certification] = Field(default_factory=list)
    other_sections: list[OtherSection] = Field(default_factory=list)
    total_years_experience: float = Field(
        default=0.0,
        description="From employment dates only. 0 if it cannot be computed from the resume.",
    )


# --------------------------------------------------------------------------- #
# Layer 2 — JobSpec: the JD, decomposed                                        #
# --------------------------------------------------------------------------- #


class RequirementCategory(StrEnum):
    LANGUAGE = "language"
    FRAMEWORK = "framework"
    DATABASE = "database"
    CLOUD_DEVOPS = "cloud_devops"
    SYSTEM_DESIGN = "system_design"
    ARCHITECTURE = "architecture"
    AI_ML = "ai_ml"
    TESTING = "testing"
    SECURITY = "security"
    DOMAIN = "domain"
    SOFT_SKILL = "soft_skill"
    TOOLING = "tooling"
    OTHER = "other"


class Importance(StrEnum):
    REQUIRED = "required"
    PREFERRED = "preferred"


class Requirement(BaseModel):
    term: str = Field(description="The skill exactly as the JD names it")
    category: RequirementCategory
    importance: Importance
    evidence: str = Field(description="The JD phrase this was taken from")


class Keyword(BaseModel):
    term: str
    variants: list[str] = Field(
        default_factory=list,
        description="Synonyms an ATS may also match, e.g. 'PostgreSQL' -> 'Postgres'",
    )
    weight: int = Field(description="1-5: how heavily an ATS or recruiter weights this")


class ExperienceYears(BaseModel):
    min: float = Field(default=0.0, description="0 if unstated")
    max: float = Field(default=0.0, description="0 if unstated")
    raw: str = Field(default="", description="As written, e.g. '2-4 years'")


class WorkMode(StrEnum):
    ONSITE = "onsite"
    HYBRID = "hybrid"
    REMOTE = "remote"
    UNSPECIFIED = "unspecified"


class Confidence(StrEnum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class ImplicitRequirement(BaseModel):
    requirement: str
    rationale: str


class JobSpec(BaseModel):
    company: str
    title: str
    location: str = Field(default="")
    work_mode: WorkMode = WorkMode.UNSPECIFIED
    employment_type: str = Field(default="")
    experience_years: ExperienceYears = Field(default_factory=ExperienceYears)
    requirements: list[Requirement] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    keywords: list[Keyword] = Field(default_factory=list)
    implicit_requirements: list[ImplicitRequirement] = Field(default_factory=list)
    compensation: str = Field(default="")
    extraction_confidence: Confidence = Confidence.HIGH
    extraction_notes: str = Field(default="")

    def all_terms(self) -> list[str]:
        """Every term this JD will be matched on, including keyword variants."""
        terms = [r.term for r in self.requirements]
        for kw in self.keywords:
            terms.append(kw.term)
            terms.extend(kw.variants)
        return terms


# --------------------------------------------------------------------------- #
# Layer 3 — Gap analysis                                                       #
# --------------------------------------------------------------------------- #


class Severity(StrEnum):
    BLOCKING = "blocking"
    SIGNIFICANT = "significant"
    MINOR = "minor"


class Match(BaseModel):
    jd_term: str
    source_ids: list[str] = Field(default_factory=list)
    note: str = Field(default="")


class MissingItem(BaseModel):
    jd_term: str
    severity: Severity
    note: str = Field(default="")


class Emphasis(BaseModel):
    source_id: str
    reason: str


class GapAnalysis(BaseModel):
    strong_matches: list[Match] = Field(default_factory=list)
    partial_matches: list[Match] = Field(default_factory=list)
    transferable: list[Match] = Field(default_factory=list)
    missing: list[MissingItem] = Field(default_factory=list)
    missing_keywords: list[str] = Field(
        default_factory=list,
        description="Cannot be claimed truthfully. Reported, never inserted.",
    )
    recoverable_keywords: list[str] = Field(
        default_factory=list,
        description="Already in the resume but buried. These are the real ATS wins.",
    )
    emphasize: list[Emphasis] = Field(default_factory=list)
    deemphasize: list[Emphasis] = Field(default_factory=list)
    recruiter_concerns: list[str] = Field(default_factory=list)
    ats_rejection_risks: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Layer 4 — TailoredResume                                                     #
# --------------------------------------------------------------------------- #


class TailoredBullet(BaseModel):
    text: str
    source_ids: list[str] = Field(
        default_factory=list,
        description="Ids from ResumeFacts this line derives from. Never empty.",
    )
    keywords: list[str] = Field(
        default_factory=list, description="JD keywords this line legitimately carries"
    )


class TailoredSummary(BaseModel):
    text: str
    source_ids: list[str] = Field(default_factory=list)


class TailoredSkillGroup(BaseModel):
    category: str
    items: list[str] = Field(default_factory=list)
    source_ids: list[str] = Field(default_factory=list)


class TailoredExperience(BaseModel):
    source_id: str = Field(description="The ExperienceFact id this block maps to")
    company: str
    title: str
    location: str = Field(default="")
    start_date: str
    end_date: str
    bullets: list[TailoredBullet] = Field(default_factory=list)


class TailoredProject(BaseModel):
    source_id: str
    name: str
    url: str = Field(default="")
    bullets: list[TailoredBullet] = Field(default_factory=list)


class TailoredEducation(BaseModel):
    source_id: str
    institution: str
    degree: str
    dates: str = Field(default="")


class TailoredCertification(BaseModel):
    source_id: str
    text: str


class TailoredOtherSection(BaseModel):
    source_id: str
    heading: str
    bullets: list[TailoredBullet] = Field(default_factory=list)


class TailoredResume(BaseModel):
    headline: str
    summary: TailoredSummary
    skills: list[TailoredSkillGroup] = Field(default_factory=list)
    experience: list[TailoredExperience] = Field(default_factory=list)
    projects: list[TailoredProject] = Field(default_factory=list)
    education: list[TailoredEducation] = Field(default_factory=list)
    certifications: list[TailoredCertification] = Field(default_factory=list)
    other_sections: list[TailoredOtherSection] = Field(default_factory=list)
    section_order: list[str] = Field(
        default_factory=list,
        description='Section keys in render order, most JD-relevant first',
    )
    rewrite_notes: list[str] = Field(
        default_factory=list, description="What was emphasised, reordered or cut, and why"
    )

    def all_lines(self) -> list[tuple[str, str, list[str]]]:
        """(location, text, source_ids) for every rewritten line. Used by the guard."""
        out: list[tuple[str, str, list[str]]] = []
        if self.summary.text:
            out.append(("Summary", self.summary.text, self.summary.source_ids))
        for g in self.skills:
            out.append((f"Skills / {g.category}", ", ".join(g.items), g.source_ids))
        for exp in self.experience:
            for i, b in enumerate(exp.bullets, 1):
                out.append((f"Experience / {exp.company} / bullet {i}", b.text, b.source_ids))
        for proj in self.projects:
            for i, b in enumerate(proj.bullets, 1):
                out.append((f"Project / {proj.name} / bullet {i}", b.text, b.source_ids))
        for sec in self.other_sections:
            for i, b in enumerate(sec.bullets, 1):
                out.append((f"{sec.heading} / bullet {i}", b.text, b.source_ids))
        return out


# --------------------------------------------------------------------------- #
# Layer 5 — Scoring (computed) and strategy (judged)                           #
# --------------------------------------------------------------------------- #


class SubScores(BaseModel):
    """The dimensions a score is built from, as the UI draws them.

    The first four are v1's. ``section_completeness`` is retained only so a
    stored run from before the rewrite still loads; it always returned 100 on a
    document this pipeline produced, which is why it is no longer weighted.

    The rest are v2's, defaulted so that old rows deserialise. ``evidence`` and
    ``specificity`` are what stop the score being keyword overlap wearing a
    four-dimensional costume: cramming terms into a bullet raises coverage while
    lowering both of them.
    """

    keyword_match: float
    skills_coverage: float
    section_completeness: float
    experience_match: float

    evidence_density: float = 0.0
    specificity: float = 0.0
    # How far evidence and specificity were scaled back for a document that is
    # well written but not about this job. Well-set prose about unrelated work
    # should not score like a match.
    relevance_gate: float = 1.0
    penalty: float = 0.0


class AtsReport(BaseModel):
    """Computed in code, never asked of the model.

    A number the model invents drifts between runs, cannot be regression-tested,
    and cannot be explained to the candidate. This one is reproducible and every
    component is traceable to a specific term.
    """

    overall: float
    sub_scores: SubScores
    matched_keywords: list[str] = Field(default_factory=list)
    missing_keywords: list[str] = Field(default_factory=list)
    recoverable_keywords: list[str] = Field(
        default_factory=list,
        description="In the original resume but absent from the tailored one — put them back",
    )
    recommendations: list[str] = Field(default_factory=list)


class ApplyVerdict(StrEnum):
    YES = "yes"
    YES_WITH_CAVEATS = "yes_with_caveats"
    PROBABLY_NOT = "probably_not"


class Strategy(BaseModel):
    should_apply: ApplyVerdict
    fit_estimate: str
    biggest_strength: str
    biggest_gap: str
    interview_emphasis: list[str] = Field(default_factory=list)
    cover_letter_worthwhile: bool
    cover_letter_rationale: str
    outreach_angle: str
    top_improvements: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Truth guard                                                                  #
# --------------------------------------------------------------------------- #


class ViolationCode(StrEnum):
    UNSOURCED_LINE = "UNSOURCED_LINE"
    UNKNOWN_SOURCE_ID = "UNKNOWN_SOURCE_ID"
    UNSOURCED_METRIC = "UNSOURCED_METRIC"
    UNSOURCED_TECH = "UNSOURCED_TECH"
    ALTERED_EMPLOYER_FACT = "ALTERED_EMPLOYER_FACT"
    # A figure that is real, but attached to an achievement it did not come
    # from. The commonest fabrication a language model commits on a resume, and
    # the one the tailoring prompt asks against without anything enforcing it.
    DUPLICATED_METRIC = "DUPLICATED_METRIC"
    # A claim carrying no metric and no vocabulary technology, which the token
    # checks are structurally unable to see. Caught by entailment instead.
    UNSUPPORTED_CLAIM = "UNSUPPORTED_CLAIM"


class TruthViolation(BaseModel):
    code: ViolationCode
    severity: str = "error"
    location: str
    detail: str
    offending: str


class TruthReport(BaseModel):
    passed: bool
    error_count: int
    warning_count: int
    violations: list[TruthViolation] = Field(default_factory=list)


# --------------------------------------------------------------------------- #
# Ingest                                                                       #
# --------------------------------------------------------------------------- #


class Margins(BaseModel):
    top: float
    right: float
    bottom: float
    left: float


class FontSizes(BaseModel):
    name: float
    heading: float
    body: float
    small: float


class ColumnBand(BaseModel):
    start: float
    end: float


class StyleProfile(BaseModel):
    """Measured from the uploaded PDF.

    Not used to render in v1 (rendercv owns that), but column_count decides
    whether the extracted text is trustworthy at all, and the rest is reported
    so the candidate knows how their file was read.
    """

    page_width: float
    page_height: float
    margins: Margins
    column_count: int
    column_bands: list[ColumnBand] = Field(default_factory=list)
    font_sizes: FontSizes
    body_line_height: float
    bullet_glyph: str = "•"
    accent_color: str = ""
    serif: bool = False
    fonts: list[str] = Field(default_factory=list)


class SourceKind(StrEnum):
    PDF = "pdf"
    DOCX = "docx"
    TEXT = "text"


class SourceDocument(BaseModel):
    kind: SourceKind
    raw_text: str
    page_count: int = 0
    style: StyleProfile | None = None
    notes: list[str] = Field(default_factory=list)
