"""A synthetic resume used for calibration and for the template thumbnails.

Invented, like the eval cases and for the same reason: a real resume checked
into a public repo is someone's phone number in a public repo.

It is deliberately slightly too long for one page at the loosest rung. That
makes it useful for calibration, where the point is to measure how much text
each rung holds, and honest as a thumbnail, where a sparse sample would make
every template look equally roomy.
"""

from __future__ import annotations

from atsresume.models import (
    Contact,
    Link,
    ResumeFacts,
    TailoredBullet,
    TailoredCertification,
    TailoredEducation,
    TailoredExperience,
    TailoredProject,
    TailoredResume,
    TailoredSkillGroup,
    TailoredSummary,
)


def _b(*texts: str) -> list[TailoredBullet]:
    return [TailoredBullet(text=t, source_ids=["E1"]) for t in texts]


def facts() -> ResumeFacts:
    return ResumeFacts(
        contact=Contact(
            name="Rohan Iyer",
            email="rohan.iyer@example.com",
            phone="+91 98765 43210",
            location="Pune, India",
            links=[
                Link(label="GitHub", url="https://github.com/example"),
                Link(label="LinkedIn", url="https://linkedin.com/in/example"),
            ],
        )
    )


def tailored() -> TailoredResume:
    return TailoredResume(
        headline="Backend Engineer | Distributed Systems | Payments",
        summary=TailoredSummary(
            text=(
                "Backend engineer with four years building payment and settlement systems "
                "on Node.js and Go. Took a reconciliation pipeline from nightly batch to "
                "near real time, and owns the queue infrastructure three teams depend on."
            ),
            source_ids=["SUMMARY"],
        ),
        skills=[
            TailoredSkillGroup(
                category="Languages",
                items=["Go", "TypeScript", "Python", "SQL"],
                source_ids=["S1"],
            ),
            TailoredSkillGroup(
                category="Infrastructure",
                items=["PostgreSQL", "Redis", "Kafka", "Docker", "Kubernetes", "AWS"],
                source_ids=["S2"],
            ),
            TailoredSkillGroup(
                category="Practices",
                items=["Distributed tracing", "Load testing", "CI/CD", "Incident response"],
                source_ids=["S3"],
            ),
        ],
        experience=[
            TailoredExperience(
                source_id="E1",
                company="Meridian Payments",
                title="Senior Backend Engineer",
                location="Pune, India",
                start_date="Mar 2023",
                end_date="Present",
                bullets=_b(
                    "Rebuilt the settlement reconciliation pipeline around Kafka, cutting the "
                    "close-of-day window from six hours to under twenty minutes.",
                    "Introduced idempotency keys across the payments API, eliminating the "
                    "duplicate-charge class of incident entirely.",
                    "Profiled and reindexed the ledger database, dropping p99 read latency "
                    "from 840ms to 96ms under production load.",
                    "Mentored three engineers through their first on-call rotation and wrote "
                    "the runbooks the team still uses.",
                ),
            ),
            TailoredExperience(
                source_id="E2",
                company="Harbourline Logistics",
                title="Backend Engineer",
                location="Bengaluru, India",
                start_date="Jul 2021",
                end_date="Feb 2023",
                bullets=_b(
                    "Designed the shipment tracking service handling 40k events per minute, "
                    "using Redis streams for ordering guarantees.",
                    "Migrated eleven services from a shared database to per-service schemas "
                    "with no customer-visible downtime.",
                    "Cut container image sizes by 70% and shortened the deploy cycle from "
                    "eighteen minutes to five.",
                ),
            ),
        ],
        projects=[
            TailoredProject(
                source_id="P1",
                name="Ledgerpeek",
                url="https://github.com/example/ledgerpeek",
                bullets=_b(
                    "Open-source double-entry ledger inspector, 900 stars, used as teaching "
                    "material by two fintech bootcamps."
                ),
            )
        ],
        education=[
            TailoredEducation(
                source_id="ED1",
                institution="College of Engineering, Pune",
                degree="B.E. in Computer Engineering",
                dates="2017 - 2021",
            )
        ],
        certifications=[
            TailoredCertification(source_id="C1", text="AWS Certified Solutions Architect, 2024")
        ],
        section_order=["summary", "skills", "experience", "projects", "education"],
    )
