"""Renders a TailoredResume to an ATS-clean PDF via rendercv.

rendercv is driven through its CLI rather than its Python functions. The
in-process entry points (``generate_typst`` / ``generate_pdf``) take a model
that carries private state — ``_input_file_path`` and resolved settings — so
calling them means depending on internals that can move between releases. The
CLI is the supported interface, it isolates rendercv's global state (temp dirs,
font registration, working directory) from the API process, and it can be given
a hard timeout. Roughly four seconds of subprocess overhead buys all of that.

Most of the work here is defensive. rendercv validates emails, phone numbers and
dates with real validators, and a resume that fails one of them must still
render — losing a phone number is acceptable, failing the whole request because
someone wrote "+91 (97379) 32872" is not.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from ..config import get_settings
from ..models import ResumeFacts, TailoredResume

logger = logging.getLogger(__name__)


class RenderError(RuntimeError):
    """Rendering failed in a way the candidate should be told about."""


MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

PRESENT = {"present", "current", "now", "ongoing", "till date", "to date", "date"}

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")


def _parse_date(value: str) -> str | None:
    """Free-text resume date to the ISO-ish form rendercv accepts.

    Returns None when the text cannot be trusted, so the caller can fall back to
    rendercv's free-text ``date`` field rather than emit something wrong.
    """
    text = (value or "").strip().lower().replace(",", " ")
    if not text or text in PRESENT:
        return None

    # 2023-06 / 2023/06
    m = re.match(r"^(\d{4})[-/](\d{1,2})$", text)
    if m:
        return f"{int(m.group(1)):04d}-{int(m.group(2)):02d}"
    # 06/2023 or 6-2023
    m = re.match(r"^(\d{1,2})[-/](\d{4})$", text)
    if m:
        return f"{int(m.group(2)):04d}-{int(m.group(1)):02d}"
    # Jun 2023 / June 2023
    m = re.match(r"^([a-z]{3,9})\.?\s+(\d{4})$", text)
    if m and m.group(1)[:3] in MONTHS:
        return f"{int(m.group(2)):04d}-{MONTHS[m.group(1)[:3]]:02d}"
    # 2023 alone
    m = re.match(r"^(\d{4})$", text)
    if m and 1950 <= int(m.group(1)) <= 2100:
        return m.group(1)
    return None


def _is_present(value: str) -> bool:
    return (value or "").strip().lower() in PRESENT


def _dates_block(start: str, end: str) -> dict[str, object]:
    """Either a structured start/end pair, or the raw text as a fallback.

    Emitting a half-parsed range would silently change the candidate's
    employment dates, which the truth guard treats as a serious violation
    everywhere else. Falling back to the free-text field keeps it honest.
    """
    start_iso = _parse_date(start)
    if start_iso is None:
        raw = " ".join(p for p in (start, "-" if start and end else "", end) if p).strip()
        return {"date": raw} if raw else {}

    block: dict[str, object] = {"start_date": start_iso}
    if _is_present(end) or not end.strip():
        block["end_date"] = "present"
    else:
        end_iso = _parse_date(end)
        if end_iso is None:
            return {"date": f"{start} - {end}".strip()}
        block["end_date"] = end_iso
    return block


def _social_networks(facts: ResumeFacts) -> tuple[list[dict[str, str]], str, list[dict[str, str]]]:
    """Split links into the networks rendercv knows, a website, and the rest.

    rendercv validates the ``network`` name against a fixed list, so anything
    unrecognised has to go elsewhere or the whole render fails.
    """
    known = {
        "linkedin.com/in": "LinkedIn",
        "linkedin.com": "LinkedIn",
        "github.com": "GitHub",
        "gitlab.com": "GitLab",
        "stackoverflow.com": "StackOverflow",
        "x.com": "X",
        "twitter.com": "X",
        "medium.com": "Medium",
        "orcid.org": "ORCID",
        "youtube.com": "YouTube",
        "instagram.com": "Instagram",
        "researchgate.net": "ResearchGate",
        "scholar.google.com": "GoogleScholar",
    }

    networks: list[dict[str, str]] = []
    custom: list[dict[str, str]] = []
    website = ""
    seen: set[str] = set()

    for link in facts.contact.links:
        url = (link.url or "").strip()
        if not url:
            continue
        bare = re.sub(r"^https?://(www\.)?", "", url).rstrip("/")
        matched = False
        for host, name in known.items():
            if bare.lower().startswith(host):
                username = bare[len(host) :].strip("/")
                if username and name not in seen:
                    networks.append({"network": name, "username": username})
                    seen.add(name)
                matched = True
                break
        if matched:
            continue
        if not website:
            website = url if url.startswith("http") else f"https://{bare}"
        else:
            custom.append(
                {"fontawesome_icon": "fa-solid fa-link", "placeholder": bare, "url": url}
            )

    return networks, website, custom


def _phone(raw: str) -> str:
    """rendercv runs real phone validation; anything it would reject is dropped.

    A dropped number is recoverable — the candidate sees it missing and fixes
    the input. A failed render is not.
    """
    text = (raw or "").strip()
    if not text:
        return ""
    digits = re.sub(r"[^\d+]", "", text)
    if digits.startswith("+") and len(re.sub(r"\D", "", digits)) >= 10:
        return f"tel:{digits}"
    bare = re.sub(r"\D", "", digits)
    if len(bare) == 10:  # assume the resume's own country; India is the default market
        return f"tel:+91{bare}"
    return ""


def _markdown_safe(text: str) -> str:
    """Neutralise characters that would be read as markup rather than text."""
    return (text or "").replace("\\", "/").replace("<", "\\<").replace(">", "\\>").strip()


SECTION_TITLES = {
    "summary": "Summary",
    "skills": "Technical Skills",
    "experience": "Experience",
    "projects": "Projects",
    "education": "Education",
    "certifications": "Certifications",
}


def build_cv_dict(tailored: TailoredResume, facts: ResumeFacts) -> dict:
    contact = facts.contact
    networks, website, custom = _social_networks(facts)

    cv: dict[str, object] = {"name": contact.name.strip() or "Candidate"}
    if tailored.headline.strip():
        cv["headline"] = _markdown_safe(tailored.headline)
    if contact.location.strip():
        cv["location"] = contact.location.strip()
    if contact.email.strip() and _EMAIL.match(contact.email.strip()):
        cv["email"] = contact.email.strip()
    phone = _phone(contact.phone)
    if phone:
        cv["phone"] = phone
    if website:
        cv["website"] = website
    if networks:
        cv["social_networks"] = networks
    if custom:
        cv["custom_connections"] = custom

    sections: dict[str, list] = {}

    def add(key: str) -> None:
        title = SECTION_TITLES.get(key, key.title())
        if key == "summary" and tailored.summary.text.strip():
            sections[title] = [_markdown_safe(tailored.summary.text)]

        elif key == "skills" and tailored.skills:
            sections[title] = [
                {
                    "label": _markdown_safe(group.category),
                    "details": _markdown_safe(", ".join(group.items)),
                }
                for group in tailored.skills
                if group.items
            ]

        elif key == "experience" and tailored.experience:
            sections[title] = [
                {
                    "company": _markdown_safe(exp.company),
                    "position": _markdown_safe(exp.title),
                    **({"location": exp.location.strip()} if exp.location.strip() else {}),
                    **_dates_block(exp.start_date, exp.end_date),
                    "highlights": [_markdown_safe(b.text) for b in exp.bullets if b.text.strip()],
                }
                for exp in tailored.experience
            ]

        elif key == "projects" and tailored.projects:
            entries = []
            for proj in tailored.projects:
                entry: dict[str, object] = {
                    "name": _markdown_safe(proj.name),
                    "highlights": [
                        _markdown_safe(b.text) for b in proj.bullets if b.text.strip()
                    ],
                }
                if proj.url.strip():
                    bare = re.sub(r"^https?://(www\.)?", "", proj.url.strip())
                    entry["summary"] = f"[{bare}]({proj.url.strip()})"
                entries.append(entry)
            sections[title] = entries

        elif key == "education" and tailored.education:
            entries = []
            for edu in tailored.education:
                degree, _, area = edu.degree.partition(" in ")
                entry: dict[str, object] = {
                    "institution": _markdown_safe(edu.institution),
                    "area": _markdown_safe(area or edu.degree),
                    "degree": _markdown_safe(degree if area else ""),
                }
                if edu.dates.strip():
                    entry["date"] = edu.dates.strip()
                entries.append({k: v for k, v in entry.items() if v})
            sections[title] = entries

        elif key == "certifications" and tailored.certifications:
            sections[title] = [_markdown_safe(c.text) for c in tailored.certifications if c.text]

    order = [k for k in tailored.section_order if k in SECTION_TITLES]
    for key in SECTION_TITLES:
        if key not in order:
            order.append(key)
    for key in order:
        add(key)

    for section in tailored.other_sections:
        bullets = [_markdown_safe(b.text) for b in section.bullets if b.text.strip()]
        if bullets and section.heading.strip():
            sections[section.heading.strip()] = bullets

    cv["sections"] = sections
    return cv


@dataclass
class RenderResult:
    pdf: bytes
    filename: str
    warnings: list[str] = field(default_factory=list)


def render_pdf(
    tailored: TailoredResume,
    facts: ResumeFacts,
    company: str = "",
    theme: str | None = None,
) -> RenderResult:
    settings = get_settings()
    warnings: list[str] = []

    if not _phone(facts.contact.phone) and facts.contact.phone.strip():
        warnings.append(
            f"The phone number '{facts.contact.phone.strip()}' is not in a form the renderer "
            "accepts and was left off. Write it in international form, e.g. +91 98765 43210."
        )
    if facts.contact.email.strip() and not _EMAIL.match(facts.contact.email.strip()):
        warnings.append(
            f"'{facts.contact.email.strip()}' did not parse as an email address and was left off."
        )

    document = {
        "cv": build_cv_dict(tailored, facts),
        "design": {"theme": theme or settings.rendercv_theme},
        "settings": {"render_command": {"dont_generate_png": True, "dont_generate_markdown": True}},
    }

    workdir = Path(tempfile.mkdtemp(prefix="atsresume-render-"))
    try:
        source = workdir / "cv.yaml"
        source.write_text(
            yaml.safe_dump(document, allow_unicode=True, sort_keys=False), encoding="utf-8"
        )

        binary = Path(__import__("sys").executable).parent / "rendercv"
        command = [str(binary) if binary.exists() else "rendercv", "render", str(source)]

        try:
            proc = subprocess.run(
                command,
                cwd=workdir,
                capture_output=True,
                text=True,
                timeout=settings.render_timeout_s,
            )
        except FileNotFoundError as exc:
            raise RenderError(
                "rendercv is not installed in this environment. Run: pip install 'rendercv[full]'"
            ) from exc
        except subprocess.TimeoutExpired as exc:
            raise RenderError("Rendering timed out.") from exc

        pdfs = sorted((workdir / "rendercv_output").glob("*.pdf")) if (
            workdir / "rendercv_output"
        ).exists() else []

        if proc.returncode != 0 or not pdfs:
            detail = (proc.stderr or proc.stdout or "").strip()
            logger.error("rendercv failed: %s", detail[:2000])
            raise RenderError(_explain_render_failure(detail))

        pdf_bytes = pdfs[0].read_bytes()
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    stem = re.sub(r"[^A-Za-z0-9]+", "-", facts.contact.name).strip("-") or "Resume"
    slug = re.sub(r"[^A-Za-z0-9]+", "-", company).strip("-")
    if slug.lower() in {"unspecified", "not-specified", "unknown", "n-a", "none", ""}:
        slug = ""
    filename = "-".join(p for p in (stem, "Resume", slug) if p) + ".pdf"

    return RenderResult(pdf=pdf_bytes, filename=filename, warnings=warnings)


def _explain_render_failure(detail: str) -> str:
    """Turn rendercv's validation output into something the candidate can act on."""
    lowered = detail.lower()
    if "phone" in lowered:
        return "The phone number was rejected by the renderer. Use international form, e.g. +91 98765 43210."
    if "email" in lowered:
        return "The email address was rejected by the renderer."
    if "date" in lowered:
        return "A date could not be understood. Use forms like 'Jun 2023', '2023-06' or 'Present'."
    if "network" in lowered:
        return "A social link was not recognised. Remove it or use a linkedin.com / github.com URL."
    snippet = detail.splitlines()[-1][:300] if detail else "no output"
    return f"The renderer rejected this resume: {snippet}"
