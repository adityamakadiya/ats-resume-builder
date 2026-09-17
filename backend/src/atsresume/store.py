"""SQLite persistence for resumes, runs and applications.

Until now nothing survived a request. Every tailored resume was thrown away the
moment the browser moved on, which meant no history, no way to reopen a draft,
no way to compare today's output against last week's, and a facts cache living
in a temp directory the operating system clears.

Plain ``sqlite3``, no ORM. The schema is three tables and the queries are short;
an ORM would add a dependency, a migration system and an abstraction over
something already simple.

Connections are opened per call rather than shared. FastAPI runs blocking
handlers in a thread pool, SQLite connections are not safe to move between
threads, and connection setup on a local file costs microseconds. WAL mode lets
reads proceed while a write is in flight.
"""

from __future__ import annotations

import hashlib
import json
import logging
import sqlite3
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .config import get_settings
from .models import (
    AtsReport,
    GapAnalysis,
    JobSpec,
    ResumeFacts,
    Strategy,
    TailoredResume,
    TruthReport,
)

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS resumes (
    id           INTEGER PRIMARY KEY,
    fingerprint  TEXT NOT NULL UNIQUE,  -- hash of extracted text + extraction contract
    name         TEXT NOT NULL DEFAULT '',
    raw_text     TEXT NOT NULL,
    facts_json   TEXT NOT NULL,
    created_at   REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
    id               INTEGER PRIMARY KEY,
    resume_id        INTEGER NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    company          TEXT NOT NULL DEFAULT '',
    title            TEXT NOT NULL DEFAULT '',
    jd_text          TEXT NOT NULL DEFAULT '',
    jd_source        TEXT NOT NULL DEFAULT '',
    job_json         TEXT NOT NULL,
    gaps_json        TEXT NOT NULL,
    tailored_json    TEXT NOT NULL,
    truth_json       TEXT NOT NULL,
    report_json      TEXT NOT NULL,
    strategy_json    TEXT NOT NULL,
    ats_score        REAL NOT NULL DEFAULT 0,
    guard_passed     INTEGER NOT NULL DEFAULT 0,
    repair_attempted INTEGER NOT NULL DEFAULT 0,
    seconds          REAL NOT NULL DEFAULT 0,
    cost_usd         REAL NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'draft',
    notes            TEXT NOT NULL DEFAULT '',
    created_at       REAL NOT NULL,
    updated_at       REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at DESC);
CREATE INDEX IF NOT EXISTS runs_resume  ON runs(resume_id);
"""

# Where an application actually is. Kept as free text in the column so a new
# state does not need a migration, but these are what the UI offers.
STATUSES = ("draft", "applied", "screening", "interviewing", "offer", "rejected", "abandoned")


def db_path() -> Path:
    settings = get_settings()
    path = Path(settings.db_path).expanduser()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def connect():
    connection = sqlite3.connect(db_path(), timeout=10)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA foreign_keys=ON")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init() -> None:
    with connect() as connection:
        connection.executescript(SCHEMA)


def _extraction_version() -> str:
    """Changes whenever the extraction contract does, invalidating stored facts."""
    from .pipeline.prompts import RESUME_EXTRACTION

    material = RESUME_EXTRACTION + json.dumps(ResumeFacts.model_json_schema(), sort_keys=True)
    return hashlib.sha256(material.encode()).hexdigest()[:12]


def fingerprint(raw_text: str) -> str:
    digest = hashlib.sha256(raw_text.strip().encode()).hexdigest()[:24]
    return f"{_extraction_version()}-{digest}"


# --------------------------------------------------------------------------- #
# Resumes                                                                      #
# --------------------------------------------------------------------------- #


def get_facts(raw_text: str) -> ResumeFacts | None:
    """The facts cache, now durable instead of living in a temp directory."""
    if not get_settings().cache_facts:
        return None
    with connect() as connection:
        row = connection.execute(
            "SELECT facts_json FROM resumes WHERE fingerprint = ?", (fingerprint(raw_text),)
        ).fetchone()
    if row is None:
        return None
    try:
        return ResumeFacts.model_validate_json(row["facts_json"])
    except Exception:
        logger.info("Discarding unreadable stored facts")
        return None


def put_facts(raw_text: str, facts: ResumeFacts) -> int:
    """Store the facts and return the resume id. Idempotent on fingerprint."""
    now = time.time()
    with connect() as connection:
        connection.execute(
            """INSERT INTO resumes (fingerprint, name, raw_text, facts_json, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(fingerprint) DO UPDATE SET facts_json = excluded.facts_json""",
            (fingerprint(raw_text), facts.contact.name, raw_text, facts.model_dump_json(), now),
        )
        row = connection.execute(
            "SELECT id FROM resumes WHERE fingerprint = ?", (fingerprint(raw_text),)
        ).fetchone()
    return int(row["id"])


def get_resume(resume_id: int) -> tuple[ResumeFacts, str] | None:
    """Facts and the original text, which the truth guard needs."""
    with connect() as connection:
        row = connection.execute(
            "SELECT facts_json, raw_text FROM resumes WHERE id = ?", (resume_id,)
        ).fetchone()
    if row is None:
        return None
    return ResumeFacts.model_validate_json(row["facts_json"]), row["raw_text"]


# --------------------------------------------------------------------------- #
# Runs                                                                         #
# --------------------------------------------------------------------------- #


@dataclass
class RunSummary:
    """Enough to render a history row without loading four JSON blobs."""

    id: int
    company: str
    title: str
    ats_score: float
    guard_passed: bool
    status: str
    created_at: float
    candidate: str = ""


def save_run(
    *,
    raw_text: str,
    facts: ResumeFacts,
    job: JobSpec,
    gaps: GapAnalysis,
    tailored: TailoredResume,
    truth: TruthReport,
    report: AtsReport,
    strategy: Strategy,
    jd_text: str,
    jd_source: str,
    repair_attempted: bool,
    seconds: float,
    cost_usd: float,
) -> int:
    resume_id = put_facts(raw_text, facts)
    now = time.time()
    with connect() as connection:
        cursor = connection.execute(
            """INSERT INTO runs (
                   resume_id, company, title, jd_text, jd_source,
                   job_json, gaps_json, tailored_json, truth_json, report_json, strategy_json,
                   ats_score, guard_passed, repair_attempted, seconds, cost_usd,
                   created_at, updated_at)
               VALUES (?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?, ?,?)""",
            (
                resume_id,
                job.company,
                job.title,
                jd_text,
                jd_source,
                job.model_dump_json(),
                gaps.model_dump_json(),
                tailored.model_dump_json(),
                truth.model_dump_json(),
                report.model_dump_json(),
                strategy.model_dump_json(),
                report.overall,
                int(truth.passed),
                int(repair_attempted),
                seconds,
                cost_usd,
                now,
                now,
            ),
        )
    return int(cursor.lastrowid or 0)


def list_runs(limit: int = 50) -> list[RunSummary]:
    with connect() as connection:
        rows = connection.execute(
            """SELECT r.id, r.company, r.title, r.ats_score, r.guard_passed, r.status,
                      r.created_at, res.name AS candidate
               FROM runs r JOIN resumes res ON res.id = r.resume_id
               ORDER BY r.created_at DESC LIMIT ?""",
            (limit,),
        ).fetchall()
    return [
        RunSummary(
            id=row["id"],
            company=row["company"],
            title=row["title"],
            ats_score=row["ats_score"],
            guard_passed=bool(row["guard_passed"]),
            status=row["status"],
            created_at=row["created_at"],
            candidate=row["candidate"],
        )
        for row in rows
    ]


def get_run(run_id: int) -> dict[str, Any] | None:
    """The whole run, decoded, so a client can reopen it in the editor."""
    with connect() as connection:
        row = connection.execute(
            """SELECT r.*, res.facts_json, res.raw_text
               FROM runs r JOIN resumes res ON res.id = r.resume_id
               WHERE r.id = ?""",
            (run_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "id": row["id"],
        "company": row["company"],
        "title": row["title"],
        "status": row["status"],
        "notes": row["notes"],
        "ats_score": row["ats_score"],
        "repair_attempted": bool(row["repair_attempted"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "facts": json.loads(row["facts_json"]),
        "job": json.loads(row["job_json"]),
        "gaps": json.loads(row["gaps_json"]),
        "tailored": json.loads(row["tailored_json"]),
        "truth": json.loads(row["truth_json"]),
        "report": json.loads(row["report_json"]),
        "strategy": json.loads(row["strategy_json"]),
    }


def update_run(
    run_id: int,
    *,
    tailored: TailoredResume | None = None,
    status: str | None = None,
    notes: str | None = None,
) -> bool:
    """Save edits back. The tailored document is what the editor holds, so this
    is how a hand-edited resume survives a refresh."""
    sets: list[str] = ["updated_at = ?"]
    values: list[Any] = [time.time()]
    if tailored is not None:
        sets.append("tailored_json = ?")
        values.append(tailored.model_dump_json())
    if status is not None:
        sets.append("status = ?")
        values.append(status)
    if notes is not None:
        sets.append("notes = ?")
        values.append(notes)
    values.append(run_id)

    with connect() as connection:
        cursor = connection.execute(f"UPDATE runs SET {', '.join(sets)} WHERE id = ?", values)
    return cursor.rowcount > 0


def delete_run(run_id: int) -> bool:
    with connect() as connection:
        cursor = connection.execute("DELETE FROM runs WHERE id = ?", (run_id,))
    return cursor.rowcount > 0
