"""Disk cache for extracted resume facts.

One resume against many postings is the normal way this gets used, and the
extraction step is the one part of the pipeline whose input does not change
between those runs. Re-paying for it every time is the easiest money in the
pipeline to stop spending.

Keyed on a hash of the extracted text rather than the uploaded bytes: the same
resume exported twice produces different files but identical text, and the text
is what the extraction actually sees. Entries are versioned by the prompt and
schema so a change to either invalidates the cache instead of silently serving
facts shaped for the old contract.
"""

from __future__ import annotations

import hashlib
import json
import logging
import tempfile
from pathlib import Path

from .config import get_settings
from .models import ResumeFacts

logger = logging.getLogger(__name__)

MAX_ENTRIES = 200


def _cache_dir() -> Path:
    settings = get_settings()
    directory = (
        Path(settings.cache_dir)
        if settings.cache_dir
        else Path(tempfile.gettempdir()) / "atsresume-cache"
    )
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _version() -> str:
    """Changes whenever the extraction contract does."""
    from .pipeline.prompts import RESUME_EXTRACTION

    material = RESUME_EXTRACTION + json.dumps(ResumeFacts.model_json_schema(), sort_keys=True)
    return hashlib.sha256(material.encode()).hexdigest()[:12]


def key_for(raw_text: str) -> str:
    digest = hashlib.sha256(raw_text.strip().encode()).hexdigest()[:24]
    return f"{_version()}-{digest}"


def get(raw_text: str) -> ResumeFacts | None:
    if not get_settings().cache_facts:
        return None
    path = _cache_dir() / f"{key_for(raw_text)}.json"
    if not path.exists():
        return None
    try:
        facts = ResumeFacts.model_validate_json(path.read_text(encoding="utf-8"))
    except Exception:
        # A stale or truncated entry is not worth a failed request.
        logger.info("Discarding unreadable cache entry %s", path.name)
        path.unlink(missing_ok=True)
        return None
    logger.info("Resume facts served from cache")
    return facts


def put(raw_text: str, facts: ResumeFacts) -> None:
    if not get_settings().cache_facts:
        return
    directory = _cache_dir()
    path = directory / f"{key_for(raw_text)}.json"
    try:
        # Write then rename, so a crash mid-write cannot leave a half file that
        # the next read has to recover from.
        with tempfile.NamedTemporaryFile(
            "w", dir=directory, suffix=".tmp", delete=False, encoding="utf-8"
        ) as handle:
            handle.write(facts.model_dump_json())
            temp = Path(handle.name)
        temp.replace(path)
    except OSError as exc:
        logger.info("Could not write cache entry: %s", exc)
        return

    entries = sorted(directory.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in entries[MAX_ENTRIES:]:
        stale.unlink(missing_ok=True)


def clear() -> int:
    directory = _cache_dir()
    removed = 0
    for entry in directory.glob("*.json"):
        entry.unlink(missing_ok=True)
        removed += 1
    return removed
