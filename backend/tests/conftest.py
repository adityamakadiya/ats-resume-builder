"""Shared fixtures.

The PDFs are generated rather than committed so the tests state exactly what
layout they are exercising. PyMuPDF writes them, which also means the fixtures
exercise the same library the reader uses.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pymupdf
import pytest

from atsresume.models import (
    Bullet,
    Contact,
    EducationFact,
    ExperienceFact,
    ResumeFacts,
    SkillGroup,
    TailoredBullet,
    TailoredEducation,
    TailoredExperience,
    TailoredResume,
    TailoredSkillGroup,
    TailoredSummary,
)


def make_pdf(items: list[tuple[str, float, float]], size: tuple[float, float] = (595, 842)) -> bytes:
    """items are (text, x, y) with y measured from the top, as PyMuPDF does."""
    doc = pymupdf.open()
    page = doc.new_page(width=size[0], height=size[1])
    for text, x, y in items:
        page.insert_text((x, y), text, fontsize=10, fontname="helv")
    data = doc.tobytes()
    doc.close()
    return data


@pytest.fixture
def two_column_pdf() -> bytes:
    """A sidebar resume whose content is written row by row across the gutter.

    This is what Word tables and HTML-to-PDF converters produce, and it is the
    layout that interleaves under naive extraction.
    """
    left_x, right_x = 40.0, 250.0
    rows = [
        ("SKILLS", "EXPERIENCE"),
        ("JavaScript", "Backend Engineer at Acme Payments"),
        ("TypeScript", "Bengaluru, India, Jun 2023 to Present"),
        ("PostgreSQL", "Built REST APIs in Node.js for settlement"),
        ("Redis", "Added Redis caching cutting latency by half"),
        ("Docker", "Wrote PostgreSQL indexes for reconciliation"),
        ("Express", "Implemented JWT authentication for admin tools"),
        ("BullMQ", "Containerised three services and set up CI"),
        ("Git", "Owned the settlement service end to end"),
        ("CONTACT", "EDUCATION"),
        ("priya@example.com", "B.E. Computer Engineering GTU"),
        ("Bengaluru", "Graduated 2023 with distinction"),
    ]
    items: list[tuple[str, float, float]] = []
    y = 80.0
    for left, right in rows:
        items.append((left, left_x, y))
        items.append((right, right_x, y))
        y += 18.0
    return make_pdf(items)


@pytest.fixture
def single_column_pdf() -> bytes:
    lines = [
        "PRIYA NAIR",
        "Backend Engineer building payment settlement services",
        "EXPERIENCE",
        "Acme Payments   Bengaluru, India",
        "Backend Engineer   Jun 2023 - Present",
        "Built REST APIs in Node.js and Express for merchant settlement",
        "Added Redis caching to the settlement lookup endpoint",
        "Wrote PostgreSQL queries and added indexes for reconciliation",
        "Implemented JWT authentication for internal admin tooling",
        "Containerised three services with Docker and set up GitHub Actions",
        "EDUCATION",
        "B.E. Computer Engineering, GTU, 2019 - 2023",
    ]
    return make_pdf([(text, 56.0, 80.0 + i * 18.0) for i, text in enumerate(lines)])


@pytest.fixture
def hyphenated_pdf() -> bytes:
    lines = [
        "Architected multi-tenant isolation across 141 backend mod-",
        "ules and 860 API routes, with exponential-",
        "backoff retries on every queue worker",
    ]
    return make_pdf([(text, 56.0, 100.0 + i * 18.0) for i, text in enumerate(lines)])


@pytest.fixture
def facts() -> ResumeFacts:
    return ResumeFacts(
        contact=Contact(
            name="Priya Nair",
            email="priya@example.com",
            phone="+91 98765 43210",
            location="Bengaluru, India",
        ),
        headline="Backend Engineer",
        summary="Backend engineer with two years building web services.",
        experience=[
            ExperienceFact(
                id="E1",
                company="Acme Payments",
                title="Backend Engineer",
                location="Bengaluru",
                start_date="Jun 2023",
                end_date="Present",
                bullets=[
                    Bullet(
                        id="E1.B1",
                        text="Built REST APIs in Node.js and Express for the merchant settlement service.",
                    ),
                    Bullet(
                        id="E1.B2",
                        text="Added Redis caching to the settlement lookup endpoint, cutting response time by 45%.",
                    ),
                ],
                tech=["Node.js", "Express", "Redis"],
            )
        ],
        education=[
            EducationFact(
                id="ED1",
                institution="GTU",
                degree="B.E. in Computer Engineering",
                dates="2019 - 2023",
            )
        ],
        skills=[
            SkillGroup(id="S1", category="Backend", items=["Node.js", "Express", "PostgreSQL", "Redis"])
        ],
        total_years_experience=2.0,
    )


@pytest.fixture
def tailored() -> TailoredResume:
    return TailoredResume(
        headline="Backend Engineer",
        # Long enough to be representative: real runs produce 40-60 words, and a
        # one-line fixture quietly understates what every scorer is judging.
        summary=TailoredSummary(
            text=(
                "Backend engineer with two years building REST APIs on Node.js and Express "
                "for merchant settlement. Strongest in PostgreSQL query tuning and Redis "
                "caching on read-heavy endpoints, having cut settlement lookup response "
                "time by 45%."
            ),
            source_ids=["SUMMARY", "E1.B1", "E1.B2", "S1"],
        ),
        skills=[
            TailoredSkillGroup(
                category="Backend",
                items=["Node.js", "Express", "PostgreSQL", "Redis"],
                source_ids=["S1"],
            )
        ],
        experience=[
            TailoredExperience(
                source_id="E1",
                company="Acme Payments",
                title="Backend Engineer",
                location="Bengaluru",
                start_date="Jun 2023",
                end_date="Present",
                bullets=[
                    TailoredBullet(
                        text="Designed REST APIs on Node.js and Express for merchant settlement, "
                        "cutting lookup response time 45% with a Redis cache layer.",
                        source_ids=["E1.B1", "E1.B2"],
                        keywords=["REST APIs", "Node.js", "Redis"],
                    )
                ],
            )
        ],
        education=[
            TailoredEducation(
                source_id="ED1",
                institution="GTU",
                degree="B.E. in Computer Engineering",
                dates="2019 - 2023",
            )
        ],
        section_order=["summary", "skills", "experience", "education"],
    )


# The calibration sample, shared with scripts/calibrate_density.py and the
# thumbnail generator. Using the same document everywhere means a change to it
# shows up in the tests, the ladder and the pictures at once, rather than the
# three drifting apart.
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))


@pytest.fixture(scope="session")
def sample_facts() -> ResumeFacts:
    from sample import facts as _facts

    return _facts()


@pytest.fixture(scope="session")
def sample_tailored() -> TailoredResume:
    from sample import tailored as _tailored

    return _tailored()
